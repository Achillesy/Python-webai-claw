#!/usr/bin/env python3
"""Regenerate extension/host-build.json from the native-host/ tree.

The host build is a monotonic counter, decoupled from the store version:
HOST_VERSION stays 1.2.5 across host-only fixes so they need no store
resubmission, which also means the version can never tell the extension
whether the installed host is current. The build counter fills that gap:
it only moves when the installed host files actually change.

The script hashes native-host/HOST_FILES (CRLF-normalized, so the
fingerprint is identical on every platform) and bumps the build when the
hash differs from the checked-in file. Run it after any host change:

    python3 scripts/sync_host_build.py

tests/test_host_build.py fails when the checked-in fingerprint is stale,
so a forgotten run breaks the suite instead of silently shipping an
outdated build number. --check does the same comparison without writing.
"""

import hashlib
import importlib.util
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
HOST_DIR = os.path.join(ROOT, "native-host")
BUILD_FILE = os.path.join(ROOT, "extension", "host-build.json")


def _load_install(host_dir=None):
    """Load install.py as a module to reuse its HOST_FILES list."""
    path = os.path.join(host_dir or HOST_DIR, "install.py")
    spec = importlib.util.spec_from_file_location("webai_claw_install", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fingerprint(host_dir, host_files):
    """SHA-256 over the installed host files.

    Each entry is the relative path, a NUL, the file bytes with CRLF
    folded to LF, and a NUL. Paths are sorted so the result does not
    depend on list order; line endings are folded so a Windows checkout
    hashes the same as a Unix one.
    """
    h = hashlib.sha256()
    for name in sorted(host_files):
        path = os.path.join(host_dir, name)
        with open(path, "rb") as f:
            data = f.read().replace(b"\r\n", b"\n")
        h.update(name.encode("utf-8"))
        h.update(b"\0")
        h.update(data)
        h.update(b"\0")
    return h.hexdigest()


def load_build_file(path=BUILD_FILE):
    """Return (build, sha256) from a host-build.json, or (0, None)."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        build = data.get("build")
        sha = data.get("sha256")
        if isinstance(build, int) and build >= 0 and isinstance(sha, str):
            return build, sha
    except (OSError, ValueError, AttributeError):
        pass
    return 0, None


def sync(host_dir=None, build_file=None, check_only=False):
    """Recompute the fingerprint; bump the build when it changed.

    Returns 0 when the checked-in file is current, 1 when it was stale
    (and, unless check_only, rewritten with build + 1).
    """
    host_dir = host_dir or HOST_DIR
    build_file = build_file or BUILD_FILE
    install = _load_install(host_dir)
    current = fingerprint(host_dir, install.HOST_FILES)
    build, stored = load_build_file(build_file)
    if stored == current:
        print("host-build.json is up to date (build %d)" % build)
        return 0
    new_build = build + 1 if stored is not None else 1
    if check_only:
        print("host-build.json is stale: run python3 scripts/sync_host_build.py "
              "(stored build %d, current files would be build %d)" % (build, new_build))
        return 1
    with open(build_file, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"build": new_build, "sha256": current}, f, indent=2)
        f.write("\n")
    print("host-build.json updated: build %d -> %d" % (build, new_build))
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    check_only = "--check" in argv
    return sync(check_only=check_only)


if __name__ == "__main__":
    sys.exit(main())
