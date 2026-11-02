#!/usr/bin/env python3
# webai-claw local host installer (run once per machine; re-run after
# `git pull` to refresh the host).
#
# Does three things:
# 1. Copies the host program into ~/.webai-claw/ (log/ and skill/
#    subdirectories are created) and creates machine.json once if absent;
#    reinstalls preserve the existing machine identity.
# 2. Copies the AI operator guides (AI-AGENT.md / AI-BLENDER.md, from the
#    repo root) into ~/webai-claw-skills/ so users can find and upload them;
#    refreshed on every reinstall.
# 3. Registers com.webai.claw.json with Chrome: HKCU registry on
#    Windows, Chrome's NativeMessagingHosts dir on macOS. The manifest
#    points at the installed copy, never at the repo.
#
# The dev extension ID is allowlisted below. Add the Chrome Web Store
# extension ID after the first store upload.

import json
import os
import shutil
import sys
import time
import uuid

HOST_NAME = "com.webai.claw"
EXTENSION_IDS = [
    "feifgnelfehkjlimiolepkmffgbjcong",  # dev build (unpacked)
    "lfdedknlfjieigbinhilhhkcedadifdl",  # Chrome Web Store build (v1.1.8)
    "aammomamjknhhblplamnipopncbfoeoh",  # Edge Add-ons build (v1.1.8)
]
PROJECT_URL = "https://github.com/Achillesy/Python-webai-claw"
try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    # __file__ is undefined when run via exec() from a string or piped
    # through stdin (the documented one-line installs). That always means
    # standalone mode: fetch the host files from the network.
    HERE = None
INSTALL_DIR = os.path.expanduser("~/.webai-claw")
DOC_DIR = os.path.expanduser("~/webai-claw-skills")
HOST_FILES = ["host.py", "host.sh", "host.bat",
              "skill/mcp_exec.py"]  # Blender MCP socket client
# AI operator guides live at the repo root, not under native-host/.
DOC_FILES = ["AI-AGENT.md", "AI-BLENDER.md"]
# Where to fetch the host program when install.py is downloaded standalone
# (one-line install). Pinned to master; change to a tag if you need a fixed version.
HOST_BASE_URL = "https://raw.githubusercontent.com/Achillesy/Python-webai-claw/master/native-host"
MACHINE_ID_PATH = os.path.join(INSTALL_DIR, "machine.json")

SKILL_README = """\
# skill/

Drop reusable `.py` helper scripts here. The AI calls them through the
host's exec at a fixed path, e.g.:

    python3 ~/.webai-claw/skill/my_helper.py --args...

Conventions:
- Keep each script self-contained (stdlib only if possible).
- Print machine-readable output (JSON lines preferred).
- Never read secrets; the host already refuses sensitive paths.
"""


def host_launcher():
    if sys.platform == "win32":
        return os.path.join(INSTALL_DIR, "host.bat")
    return os.path.join(INSTALL_DIR, "host.sh")


def _download(url, dst, timeout=20):
    import urllib.request
    with urllib.request.urlopen(url, timeout=timeout) as resp, open(dst, "wb") as f:
        shutil.copyfileobj(resp, f)


def _working_base():
    """Return the reachable host-file base (GitHub)."""
    import urllib.request
    probe = "/host.bat"  # smallest file, fast probe
    try:
        with urllib.request.urlopen(HOST_BASE_URL + probe, timeout=8) as r:
            r.read(1)
        return HOST_BASE_URL
    except Exception:
        return None


def _net_base_or_raise():
    base = _working_base()
    if base is None:
        raise RuntimeError("Cannot reach GitHub. Check your network/proxy.")
    return base


def _download_one(name, base, mirrors=None, dst_dir=None):
    """Download one file into dst_dir (INSTALL_DIR by default)."""
    target_dir = dst_dir or INSTALL_DIR
    os.makedirs(target_dir, exist_ok=True)
    dst = os.path.join(target_dir, name)
    for b in [base] + list(mirrors or []):
        url = "%s/%s" % (b, name)
        try:
            print("Downloading %s" % url)
            _download(url, dst)
            return
        except Exception as e:
            print("  failed (%s)" % e)
    raise RuntimeError("Failed to download %s from GitHub" % name)


def fetch_files():
    # Two modes:
    # - Source mode: host files sit next to install.py (git checkout) -> copy.
    # - Standalone mode: install.py was downloaded alone (one-line install)
    #   -> fetch the host files from GitHub.
    net_base = None
    if HERE and all(os.path.exists(os.path.join(HERE, n)) for n in HOST_FILES):
        for name in HOST_FILES:
            shutil.copy2(os.path.join(HERE, name), os.path.join(INSTALL_DIR, name))
        print("Copied host files from %s" % HERE)
    else:
        net_base = _net_base_or_raise()
        print("Using host file source: %s" % net_base)
        for name in HOST_FILES:
            _download_one(name, net_base)
        print("Downloaded host files.")
    # AI operator guides (AI-AGENT.md / AI-BLENDER.md): they live at the repo
    # root, not under native-host/. Store users have no checkout, so ship them
    # into DOC_DIR where users can find and upload them into AI chats.
    # Unlike machine.json they are refreshed on every reinstall.
    repo_root = os.path.dirname(HERE) if HERE else None
    if repo_root and all(os.path.exists(os.path.join(repo_root, n)) for n in DOC_FILES):
        for name in DOC_FILES:
            shutil.copy2(os.path.join(repo_root, name), os.path.join(DOC_DIR, name))
        print("Copied AI guides from %s" % repo_root)
    else:
        # standalone: reuse the already-probed working mirror, but at the repo
        # root instead of native-host/.
        if net_base is None:
            net_base = _net_base_or_raise()
        suffix = "/native-host"
        doc_base = net_base[:-len(suffix)] if net_base.endswith(suffix) else net_base
        for name in DOC_FILES:
            _download_one(name, doc_base, dst_dir=DOC_DIR)
        print("Downloaded AI guides.")


def _read_machine_id():
    try:
        with open(MACHINE_ID_PATH, "r", encoding="utf-8") as f:
            mid = json.load(f).get("machine_id")
    except (OSError, ValueError, AttributeError):
        return None
    if not mid:
        return None
    try:
        uuid.UUID(str(mid))
    except (ValueError, TypeError, AttributeError):
        return None
    return str(mid)


def ensure_machine_id():
    """Create machine.json once; reinstalls preserve the existing identity.

    O_EXCL is the first-writer-wins primitive: concurrent installs cannot
    mint two identities, and the loser reads the winner's value.
    """
    os.makedirs(INSTALL_DIR, exist_ok=True)
    existing = _read_machine_id()
    if existing:
        try:
            os.chmod(MACHINE_ID_PATH, 0o600)
        except OSError:
            pass
        return existing
    if os.path.exists(MACHINE_ID_PATH):
        # Corrupt identity: keep a copy for debugging, then rotate explicitly.
        backup = MACHINE_ID_PATH + ".corrupt." + time.strftime("%Y%m%d-%H%M%S")
        try:
            os.replace(MACHINE_ID_PATH, backup)
            print("WARNING: invalid machine.json backed up to %s" % backup)
        except OSError:
            pass
    mid = str(uuid.uuid4())
    try:
        fd = os.open(MACHINE_ID_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        existing = _read_machine_id()
        if existing:
            return existing
        raise RuntimeError("machine.json was created by another process but is invalid")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"machine_id": mid}, f)
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass
    try:
        os.chmod(MACHINE_ID_PATH, 0o600)
    except OSError:
        pass
    return mid


def install_files():
    os.makedirs(os.path.join(INSTALL_DIR, "log"), exist_ok=True)
    os.makedirs(os.path.join(INSTALL_DIR, "skill"), exist_ok=True)
    os.makedirs(DOC_DIR, exist_ok=True)
    fetch_files()
    # Older installers put the guides inside the hidden install directory.
    # Remove those copies so users have one obvious, visible location.
    for name in DOC_FILES:
        old = os.path.join(INSTALL_DIR, name)
        if os.path.exists(old):
            try:
                os.remove(old)
            except OSError:
                pass
    readme = os.path.join(INSTALL_DIR, "skill", "README.md")
    if not os.path.exists(readme):
        with open(readme, "w", encoding="utf-8") as f:
            f.write(SKILL_README)
    machine_id = ensure_machine_id()
    print("Machine ID: %s" % machine_id)
    if sys.platform != "win32":
        os.chmod(os.path.join(INSTALL_DIR, "host.sh"), 0o755)


def write_manifest(target_path):
    manifest = {
        "name": HOST_NAME,
        "description": "webai-claw local host",
        "path": host_launcher(),
        "type": "stdio",
        "allowed_origins": ["chrome-extension://%s/" % eid for eid in EXTENSION_IDS],
    }
    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return target_path


def print_macos_permission_notes():
    print(
        "\nmacOS file access\n"
        "  The host is launched by the browser, not by Terminal.\n"
        "  If you need ~/Desktop, ~/Documents, or ~/Downloads:\n"
        "    1. Open System Settings > Privacy & Security > Full Disk Access\n"
        "    2. Enable the browser that launches the host: Google Chrome\n"
        "       (or Microsoft Edge after its host registration is added)\n"
        "    3. Quit the browser completely and reopen it\n"
        "    4. Reconnect webai-claw in the AI chat\n"
        "  Terminal permission alone does not apply to the browser-launched host.\n"
        "  No sudo or chmod can bypass this macOS privacy control.\n"
        "  Open the settings pane with:\n"
        "    open \"x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles\""
    )


def main():
    install_files()
    print("Installed host program to %s" % INSTALL_DIR)

    if sys.platform == "win32":
        manifest_path = write_manifest(os.path.join(INSTALL_DIR, HOST_NAME + ".json"))
        import winreg

        key_path = "Software\\Google\\Chrome\\NativeMessagingHosts\\" + HOST_NAME
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            winreg.SetValueEx(key, None, 0, winreg.REG_SZ, manifest_path)
        print("Registered host: HKCU\\%s" % key_path)
    elif sys.platform == "darwin":
        target_dir = os.path.expanduser(
            "~/Library/Application Support/Google/Chrome/NativeMessagingHosts"
        )
        os.makedirs(target_dir, exist_ok=True)
        manifest_path = write_manifest(os.path.join(target_dir, HOST_NAME + ".json"))
        print("Wrote host manifest: %s" % manifest_path)
        print_macos_permission_notes()
    else:
        print("Unsupported platform: %s (Windows and macOS only)" % sys.platform)
        return 1

    print("Host manifest: %s" % manifest_path)
    print("Allowlisted extension IDs: %s" % ", ".join(EXTENSION_IDS))
    print(
        "Next: install the extension from the Chrome Web Store, or load\n"
        "extension/ unpacked for development.\n"
        "Project: %s\n"
        "Open a supported AI chat, click the webai-claw toolbar icon, and click Connect."
        % PROJECT_URL
    )
    print(
        "AI guides installed to %s\n"
        "  AI-AGENT.md: Connect attaches it automatically.\n"
        "  AI-BLENDER.md: the AI reads it as the Blender skill; manual upload is optional.\n"
        "  User-facing files are outside the hidden install directory."
        % DOC_DIR
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
