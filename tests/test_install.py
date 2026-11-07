"""Tests for installer completeness and idempotency guards.

The installer copies host files by an explicit list. If a developer adds a
module under hostlib/ or skill/ and forgets that list, the installed host
imports a file that was never copied and will not start. This test fails
on that omission before it can reach a user's machine.
"""

import ast
import importlib.util
import json
import os
import sys
import tempfile
import unittest
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST_DIR = os.path.join(ROOT, "native-host")
INSTALL_PATH = os.path.join(HOST_DIR, "install.py")
UNINSTALL_PATH = os.path.join(HOST_DIR, "uninstall.py")


def _string_list(path, name):
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    value = ast.literal_eval(node.value)
                    if isinstance(value, list):
                        return value
    raise AssertionError("%s not found in %s" % (name, path))


def _load_install():
    spec = importlib.util.spec_from_file_location("webai_claw_install", INSTALL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InstallCompletenessTests(unittest.TestCase):
    def test_host_file_list_covers_every_module(self):
        listed = _string_list(INSTALL_PATH, "HOST_FILES")
        on_disk = []
        for sub in ("hostlib", "skill"):
            directory = os.path.join(HOST_DIR, sub)
            for entry in sorted(os.listdir(directory)):
                if entry.endswith(".py"):
                    on_disk.append("%s/%s" % (sub, entry))
        for name in on_disk:
            self.assertIn(name, listed, "host module %s is not copied by install.py" % name)
        for name in listed:
            self.assertTrue(os.path.isfile(os.path.join(HOST_DIR, name)),
                            "install.py lists a missing file: %s" % name)

    def test_guide_lists_match_between_install_and_uninstall(self):
        self.assertEqual(_string_list(INSTALL_PATH, "DOC_FILES"),
                         _string_list(UNINSTALL_PATH, "DOC_FILES"))

    def test_manifest_allowlists_the_known_extension_ids(self):
        install = _load_install()
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "com.webai.claw.json")
            install.write_manifest(target)
            with open(target, encoding="utf-8") as f:
                manifest = json.load(f)
        self.assertEqual(manifest["name"], "com.webai.claw")
        self.assertEqual(manifest["type"], "stdio")
        self.assertEqual(manifest["allowed_origins"],
                         ["chrome-extension://%s/" % eid for eid in install.EXTENSION_IDS])

    def test_machine_id_is_preserved_and_corrupt_is_backed_up(self):
        install = _load_install()
        with tempfile.TemporaryDirectory() as tmp:
            install.INSTALL_DIR = tmp
            install.MACHINE_ID_PATH = os.path.join(tmp, "machine.json")
            first = install.ensure_machine_id()
            uuid.UUID(first)
            self.assertEqual(install.ensure_machine_id(), first)
            with open(install.MACHINE_ID_PATH, "w", encoding="utf-8") as f:
                f.write("{not json")
            second = install.ensure_machine_id()
            uuid.UUID(second)
            self.assertNotEqual(second, first)
            backups = [n for n in os.listdir(tmp) if ".corrupt." in n]
            self.assertEqual(len(backups), 1)

    def test_verify_install_detects_a_missing_host_file(self):
        install = _load_install()
        with tempfile.TemporaryDirectory() as tmp:
            install_dir = os.path.join(tmp, "install")
            doc_dir = os.path.join(tmp, "skills")
            os.makedirs(os.path.join(install_dir, "hostlib"))
            os.makedirs(os.path.join(install_dir, "skill"))
            os.makedirs(os.path.join(doc_dir, "custom"))
            for name in install.HOST_FILES:
                path = os.path.join(install_dir, name)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    f.write("# stub\n")
            with open(os.path.join(install_dir, "host-build.json"), "w", encoding="utf-8") as f:
                json.dump({"build": 1, "sha256": "x" * 64}, f)
            with open(os.path.join(install_dir, "machine.json"), "w", encoding="utf-8") as f:
                json.dump({"machine_id": str(uuid.uuid4())}, f)
            ok, _lines = install.verify_install(install_dir, doc_dir)
            self.assertTrue(ok)
            os.remove(os.path.join(install_dir, "hostlib", "skills.py"))
            ok, lines = install.verify_install(install_dir, doc_dir)
            self.assertFalse(ok)
            self.assertTrue(any("skills.py" in line and line.startswith("FAIL") for line in lines))


if __name__ == "__main__":
    unittest.main()
