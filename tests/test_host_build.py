"""Tests for the host-build stamp (option B stale-host guard).

extension/host-build.json carries a monotonic build number the extension
compares against the installed host's reported build. The number only
moves when the installed host files change: scripts/sync_host_build.py
hashes native-host/HOST_FILES and bumps it. These tests fail when a host
change lands without running that script, so the guard cannot silently
go stale the way the frozen 1.2.6 version did.
"""

import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST_DIR = os.path.join(ROOT, "native-host")
BUILD_FILE = os.path.join(ROOT, "extension", "host-build.json")
SCRIPT_PATH = os.path.join(ROOT, "scripts", "sync_host_build.py")

sys.path.insert(0, HOST_DIR)

from hostlib.constants import read_installed_host_build  # noqa: E402


def _load_script():
    spec = importlib.util.spec_from_file_location("webai_claw_sync_host_build", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HostBuildFileTests(unittest.TestCase):
    def test_checked_in_file_is_well_formed(self):
        with open(BUILD_FILE, encoding="utf-8") as f:
            data = json.load(f)
        self.assertIsInstance(data.get("build"), int)
        self.assertGreaterEqual(data["build"], 1)
        self.assertRegex(data.get("sha256") or "", r"^[0-9a-f]{64}$")

    def test_fingerprint_matches_checked_in_file(self):
        script = _load_script()
        install = script._load_install()
        current = script.fingerprint(HOST_DIR, install.HOST_FILES)
        build, stored = script.load_build_file()
        self.assertEqual(stored, current,
                         "host-build.json is stale: run python3 scripts/sync_host_build.py")

    def test_fingerprint_is_line_ending_insensitive(self):
        script = _load_script()
        with tempfile.TemporaryDirectory() as tmp:
            lf_dir = os.path.join(tmp, "lf")
            crlf_dir = os.path.join(tmp, "crlf")
            for d in (lf_dir, crlf_dir):
                os.makedirs(d)
            names = ["host.py", "hostlib/constants.py"]
            for name in names:
                path = os.path.join(lf_dir, name)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as f:
                    f.write(b"line one\nline two\n")
                path = os.path.join(crlf_dir, name)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as f:
                    f.write(b"line one\r\nline two\r\n")
            self.assertEqual(script.fingerprint(lf_dir, names),
                             script.fingerprint(crlf_dir, names))

    def test_sync_bumps_build_only_when_content_changes(self):
        script = _load_script()
        with tempfile.TemporaryDirectory() as tmp:
            host_dir = os.path.join(tmp, "native-host")
            build_file = os.path.join(tmp, "host-build.json")
            shutil.copytree(HOST_DIR, host_dir,
                            ignore=shutil.ignore_patterns("__pycache__"))
            # No build file yet: first run creates build 1.
            self.assertEqual(script.sync(host_dir=host_dir, build_file=build_file), 0)
            with open(build_file, encoding="utf-8") as f:
                first = json.load(f)
            self.assertEqual(first["build"], 1)
            # Second run: nothing changed, build stays.
            self.assertEqual(script.sync(host_dir=host_dir, build_file=build_file), 0)
            with open(build_file, encoding="utf-8") as f:
                self.assertEqual(json.load(f), first)
            # One host file changes: build bumps by exactly one.
            target = os.path.join(host_dir, "host.py")
            with open(target, "a", encoding="utf-8") as f:
                f.write("# bump test\n")
            self.assertEqual(script.sync(host_dir=host_dir, build_file=build_file), 0)
            with open(build_file, encoding="utf-8") as f:
                second = json.load(f)
            self.assertEqual(second["build"], 2)
            self.assertNotEqual(second["sha256"], first["sha256"])
            # --check passes now, and fails after another change.
            self.assertEqual(script.sync(host_dir=host_dir, build_file=build_file,
                                         check_only=True), 0)
            with open(target, "a", encoding="utf-8") as f:
                f.write("# bump test two\n")
            self.assertEqual(script.sync(host_dir=host_dir, build_file=build_file,
                                         check_only=True), 1)


class InstalledBuildReaderTests(unittest.TestCase):
    def test_reads_installed_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "host-build.json"), "w", encoding="utf-8") as f:
                json.dump({"build": 7, "sha256": "x" * 64}, f)
            self.assertEqual(read_installed_host_build(tmp), 7)

    def test_missing_or_malformed_reports_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(read_installed_host_build(tmp), 0)
            with open(os.path.join(tmp, "host-build.json"), "w", encoding="utf-8") as f:
                f.write("not json")
            self.assertEqual(read_installed_host_build(tmp), 0)
            with open(os.path.join(tmp, "host-build.json"), "w", encoding="utf-8") as f:
                json.dump({"build": "three"}, f)
            self.assertEqual(read_installed_host_build(tmp), 0)

    def test_checkout_fallback_reads_repo_extension_copy(self):
        # A checkout run has no installed copy; the reader falls back to
        # <repo>/extension/host-build.json next to native-host/.
        with tempfile.TemporaryDirectory() as tmp:
            host_dir = os.path.join(tmp, "native-host")
            ext_dir = os.path.join(tmp, "extension")
            os.makedirs(host_dir)
            os.makedirs(ext_dir)
            with open(os.path.join(ext_dir, "host-build.json"), "w", encoding="utf-8") as f:
                json.dump({"build": 4, "sha256": "y" * 64}, f)
            self.assertEqual(read_installed_host_build(host_dir), 4)


class InstallCopiesStampTests(unittest.TestCase):
    def _load_install(self):
        spec = importlib.util.spec_from_file_location(
            "webai_claw_install", os.path.join(HOST_DIR, "install.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_fetch_files_copies_build_stamp_in_source_mode(self):
        install = self._load_install()
        with tempfile.TemporaryDirectory() as tmp:
            install_dir = os.path.join(tmp, "install")
            doc_dir = os.path.join(tmp, "docs")
            os.makedirs(doc_dir)
            install.INSTALL_DIR = install_dir
            install.DOC_DIR = doc_dir
            install.fetch_files()
            stamp = os.path.join(install_dir, "host-build.json")
            self.assertTrue(os.path.isfile(stamp), "fetch_files did not copy host-build.json")
            with open(stamp, encoding="utf-8") as f:
                installed = json.load(f)
            with open(BUILD_FILE, encoding="utf-8") as f:
                expected = json.load(f)
            self.assertEqual(installed, expected)

    def test_verify_install_checks_build_stamp(self):
        install = self._load_install()
        with tempfile.TemporaryDirectory() as tmp:
            install_dir = os.path.join(tmp, "install")
            doc_dir = os.path.join(tmp, "docs")
            os.makedirs(os.path.join(doc_dir, "custom"))
            install.INSTALL_DIR = install_dir
            install.DOC_DIR = doc_dir
            install.fetch_files()
            with open(os.path.join(install_dir, "machine.json"), "w", encoding="utf-8") as f:
                json.dump({"machine_id": str(uuid.uuid4())}, f)
            ok, lines = install.verify_install(install_dir=install_dir,
                                               doc_dir=doc_dir, repo_root=ROOT)
            self.assertTrue(ok, lines)
            self.assertTrue(any("build stamp matches repo" in l for l in lines))
            os.remove(os.path.join(install_dir, "host-build.json"))
            ok, lines = install.verify_install(install_dir=install_dir,
                                               doc_dir=doc_dir, repo_root=ROOT)
            self.assertFalse(ok)
            self.assertTrue(any("build stamp present" in l and l.startswith("FAIL")
                                for l in lines))

    def test_standalone_fetch_places_stamp_at_install_root(self):
        # Regression test for the 2026-11-07 one-liner bug: the standalone
        # branch downloaded the stamp as "extension/host-build.json", so
        # _download_one nested it at INSTALL_DIR/extension/host-build.json
        # where the host never looks (it reads INSTALL_DIR/host-build.json)
        # and the host kept reporting build 0 after a successful install.
        install = self._load_install()
        with tempfile.TemporaryDirectory() as tmp:
            install_dir = os.path.join(tmp, "install")
            doc_dir = os.path.join(tmp, "docs")
            install.INSTALL_DIR = install_dir
            install.DOC_DIR = doc_dir
            install.HERE = None
            install._net_base_or_raise = lambda: "https://example.invalid/base"
            downloaded = []

            def fake_download(url, dst, timeout=20):
                downloaded.append((url, dst))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with open(dst, "wb") as f:
                    f.write(b"stub")

            install._download = fake_download
            install.fetch_files()
            stamp = os.path.join(install_dir, "host-build.json")
            self.assertTrue(os.path.isfile(stamp),
                            "standalone fetch did not place host-build.json at install root")
            self.assertFalse(os.path.exists(os.path.join(install_dir, "extension")),
                             "stamp nested under INSTALL_DIR/extension/ (host never reads it there)")
            self.assertTrue(any(url.endswith("/extension/host-build.json")
                                for url, _dst in downloaded),
                            "stamp was not fetched from the extension base: %r" % (downloaded,))

    def test_standalone_fetch_removes_stale_nested_stamp(self):
        # A machine that ran the pre-f3b162f standalone installer has a
        # stale copy at INSTALL_DIR/extension/host-build.json; the next
        # install must remove it so only the real stamp remains.
        install = self._load_install()
        with tempfile.TemporaryDirectory() as tmp:
            install_dir = os.path.join(tmp, "install")
            doc_dir = os.path.join(tmp, "docs")
            nested = os.path.join(install_dir, "extension", "host-build.json")
            os.makedirs(os.path.dirname(nested))
            with open(nested, "w", encoding="utf-8") as f:
                json.dump({"build": 0, "sha256": "z" * 64}, f)
            install.INSTALL_DIR = install_dir
            install.DOC_DIR = doc_dir
            install.HERE = None
            install._net_base_or_raise = lambda: "https://example.invalid/base"

            def fake_download(url, dst, timeout=20):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with open(dst, "wb") as f:
                    f.write(b"stub")

            install._download = fake_download
            install.fetch_files()
            self.assertFalse(os.path.exists(nested))
            self.assertTrue(os.path.isfile(os.path.join(install_dir, "host-build.json")))


if __name__ == "__main__":
    unittest.main()
