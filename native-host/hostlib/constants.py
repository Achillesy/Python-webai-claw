"""Constants shared by the native host modules.

Keep paths relative to the installed host directory so the same code works
from a git checkout and from ~/.webai-claw.
"""

import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST_VERSION = "1.2.5"

# Monotonic host build stamp (extension/host-build.json), decoupled from
# the store version: HOST_VERSION stays 1.2.5 across host-only fixes, so
# the version alone can never tell the extension the installed host is
# outdated. install.py copies the stamp into the install directory; the
# host reports it as host_build in every response. A missing or unreadable
# stamp reads as 0, i.e. older than any real build, so a pre-stamp install
# is correctly reported as outdated.
HOST_BUILD_PATH = os.path.join(BASE_DIR, "host-build.json")


def read_installed_host_build(base_dir=None):
    """Return the installed host build number, or 0 when unknown.

    Reads <base_dir>/host-build.json; in a git checkout the installed
    copy is absent, so it falls back to <repo>/extension/host-build.json
    next to native-host/.
    """
    base = base_dir or BASE_DIR
    candidates = [
        os.path.join(base, "host-build.json"),
        os.path.join(os.path.dirname(base), "extension", "host-build.json"),
    ]
    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8") as f:
                build = json.load(f).get("build")
            if isinstance(build, int) and build >= 0:
                return build
        except (OSError, ValueError, AttributeError):
            continue
    return 0

LOG_DIR = os.path.join(BASE_DIR, "log")
LOG_PATH = os.path.join(LOG_DIR, "host.log")
RUNTIME_DIR = os.path.join(BASE_DIR, "runtime")
LEASE_PATH = os.path.join(RUNTIME_DIR, "active.json")
LEASE_LOCK = os.path.join(RUNTIME_DIR, "active.lock")
HANDOFF_PATH = os.path.join(BASE_DIR, "handoff.md")

SKILLS_DIR = os.path.join(os.path.expanduser("~"), "webai-claw-skills")
CUSTOM_SKILLS_DIR = os.path.join(SKILLS_DIR, "custom")
MAX_SKILL_BYTES = 32 * 1024
SKILL_INDEX_MAX = 50
SKILL_DESC_MAX = 160
SKILL_INDEX_MAX_BYTES = 8 * 1024

LEASE_SCHEMA = 1
HEARTBEAT_INTERVAL = 5.0
LEASE_STALE_SECONDS = 30.0
LEASE_LOCK_STALE = 10

DEFAULT_TIMEOUT = 120
AUTO_TIMEOUT_MAX = 1200
APPROVED_TIMEOUT_MAX = 7200
HOST_CWD = os.path.expanduser("~")

HISTORY_PATH = os.path.join(LOG_DIR, "exec_history.jsonl")
HISTORY_LOCK = os.path.join(LOG_DIR, "exec_history.lock")
HISTORY_LIMIT = 500
HISTORY_MAX_BYTES = 1 * 1024 * 1024
HISTORY_LOCK_STALE = 10

MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_CMD_BYTES = 512 * 1024
MAX_WRITE_BYTES = 512 * 1024
CHUNK_B64 = 500 * 1024

FILE_DENY = (
    "/.ssh/", "/.aws/", "/.gnupg/", "/.config/gcloud/",
    "id_rsa", "id_ed25519", "id_ecdsa", ".pem", ".key", ".p12",
    "/.env", "credentials", "keychain", "cookies", "login data",
    "/etc/shadow", "/etc/sudoers", ".netrc", ".pgpass",
)

MACHINE_ID_PATH = os.path.join(BASE_DIR, "machine.json")
