#!/usr/bin/env python3
# webai-claw local host uninstaller.
#
# Removes:
# 1. The Chrome and Edge Native Messaging registrations (HKCU registry on
#    Windows, the NativeMessagingHosts json on macOS).
# 2. ~/.webai-claw/ (host program, logs, skills, machine identity).
# 3. The installed guide files in ~/webai-claw-skills/ (user files are kept).
#
# Pass --yes to skip the confirmation prompt.

import os
import shutil
import sys

HOST_NAME = "com.webai.claw"
INSTALL_DIR = os.path.expanduser("~/.webai-claw")
DOC_DIR = os.path.expanduser("~/webai-claw-skills")
DOC_FILES = ["AI-AGENT.md", "AI-BLENDER.md", "AI-MACOS.md", "AI-WIN.md"]


def unregister():
    if sys.platform == "win32":
        import winreg

        key_paths = [
            "Software\\Google\\Chrome\\NativeMessagingHosts\\" + HOST_NAME,
            "Software\\Microsoft\\Edge\\NativeMessagingHosts\\" + HOST_NAME,
        ]
        for key_path in key_paths:
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_path)
                print("Removed registry key: HKCU\\%s" % key_path)
            except FileNotFoundError:
                print("Registry key not present, skipping: HKCU\\%s" % key_path)
    elif sys.platform == "darwin":
        manifests = [
            os.path.expanduser(
                "~/Library/Application Support/Google/Chrome/NativeMessagingHosts/%s.json"
                % HOST_NAME
            ),
            os.path.expanduser(
                "~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/%s.json"
                % HOST_NAME
            ),
        ]
        for manifest in manifests:
            if os.path.exists(manifest):
                os.remove(manifest)
                print("Removed host manifest: %s" % manifest)
            else:
                print("Host manifest not present, skipping: %s" % manifest)
    else:
        print("Unsupported platform: %s (Windows and macOS only)" % sys.platform)
        return 1
    return 0


def remove_dirs():
    if os.path.isdir(INSTALL_DIR):
        shutil.rmtree(INSTALL_DIR)
        print("Removed directory: %s" % INSTALL_DIR)
    else:
        print("Directory not present, skipping: %s" % INSTALL_DIR)


def remove_docs():
    if not os.path.isdir(DOC_DIR):
        return
    for name in DOC_FILES:
        path = os.path.join(DOC_DIR, name)
        if os.path.exists(path):
            try:
                os.remove(path)
                print("Removed user guide: %s" % path)
            except OSError:
                pass
    try:
        os.rmdir(DOC_DIR)
        print("Removed directory: %s" % DOC_DIR)
    except OSError:
        print("Kept non-empty user guide directory: %s" % DOC_DIR)


def main():
    print("This will unregister the webai-claw native host and delete:")
    print("  - the Chrome and Edge Native Messaging registrations for %s" % HOST_NAME)
    print("  - %s" % INSTALL_DIR)
    print("  - the installed guide files in %s" % DOC_DIR)
    if "--yes" not in sys.argv:
        try:
            answer = input("Continue? [y/N] ").strip().lower()
        except EOFError:
            # stdin is a pipe (e.g. curl ... | python3): no one can answer.
            print("Aborted (no terminal input; re-run with --yes to skip this prompt).")
            return 0
        if answer not in ("y", "yes"):
            print("Aborted.")
            return 0
    rc = unregister()
    remove_dirs()
    remove_docs()
    print("Done. The store extension can stay installed or be removed from")
    print("chrome://extensions — it will simply have no host to talk to.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
