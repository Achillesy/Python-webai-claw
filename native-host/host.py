#!/usr/bin/env python3
# webai-claw local host (Chrome Native Messaging)
#
# Chrome spawns it over stdio: incoming messages are a 4-byte little-endian
# length prefix + UTF-8 JSON, and replies use the same format. The host
# never listens on any network port.
#
# Security: only allowlisted extension IDs can wake it (see install.py's
# allowed_origins). The host does not prompt for credentials. Elevation is
# handled by the operating system (for example, a UAC prompt); the host does
# not store credentials. Never put secrets in a command.
#
# Layout: the host lives in ~/.webai-claw/ (installed by install.py).
# Runtime state goes under log/, reusable scripts under skill/.
# All paths below are relative to this file, so the host works wherever
# it is installed from.

import base64
import hashlib
import json
import mimetypes
import os
import shutil
import signal
import socket
import stat
import struct
import subprocess
import sys
import threading
import time
import uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST_VERSION = "1.2.2"
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
HEARTBEAT_INTERVAL = 5.0  # seconds
LEASE_STALE_SECONDS = 30.0  # host heartbeat age before another browser may take over
LEASE_LOCK_STALE = 10  # seconds; a crashed holder's lock file is removable after this
DEFAULT_TIMEOUT = 120  # seconds; default for ordinary commands
AUTO_TIMEOUT_MAX = 1200  # seconds; AI may set up to 20 min without explicit user approval
APPROVED_TIMEOUT_MAX = 7200  # seconds; hard ceiling after the user explicitly approves
HOST_CWD = os.path.expanduser("~")  # fixed cwd: predictable, idempotent
HISTORY_PATH = os.path.join(LOG_DIR, "exec_history.jsonl")
HISTORY_LOCK = os.path.join(LOG_DIR, "exec_history.lock")
HISTORY_LIMIT = 500  # keep the most recent 500 (session,id) execution records
HISTORY_MAX_BYTES = 1 * 1024 * 1024  # compact when the JSONL file grows past 1MB
HISTORY_LOCK_STALE = 10  # seconds; a crashed holder's lock file is removable after this
# Privacy note (2026-11-01): HISTORY is a key table for idempotent dedup,
# not an audit archive. It stores metadata only: id, session fingerprint,
# AI type, exit code, duration, timestamp, and lengths. Command text and
# output text are never persisted; full output is filled back into the page.
MAX_FILE_SIZE = 25 * 1024 * 1024  # single-file cap 25MB
MAX_CMD_BYTES = 512 * 1024  # single-command cap 512KB (Chrome native message hard limit is 1MB; keep margin; matches the extension side)
MAX_WRITE_BYTES = 512 * 1024  # write_file raw payload cap; larger files need a future chunked writer
CHUNK_B64 = 500 * 1024  # base64 chars per chunk (raw ~375KB; keep margin under the 1MB message limit)
FILE_DENY = (
    "/.ssh/", "/.aws/", "/.gnupg/", "/.config/gcloud/",
    "id_rsa", "id_ed25519", "id_ecdsa", ".pem", ".key", ".p12",
    "/.env", "credentials", "keychain", "cookies", "login data",
    "/etc/shadow", "/etc/sudoers", ".netrc", ".pgpass",
)
# Machine identity: install-time only. install.py creates machine.json
# once (first-writer-wins); host.py is read-only and fails fast if it is
# missing. Runtime generation is intentionally gone: a swallowed write
# error used to produce a fresh UUID per host process.
MACHINE_ID_PATH = os.path.join(BASE_DIR, "machine.json")


LOG_LOCK = threading.Lock()


def log(line):
    try:
        with LOG_LOCK:
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + line + "\n")
    except OSError:
        pass


def _session_key(session):
    """One-way session fingerprint for persisted logs/history (never the URL)."""
    s = str(session or "")
    if not s:
        return ""
    return hashlib.sha256(s.encode("utf-8", "ignore")).hexdigest()[:16]


def _byte_len(v):
    try:
        return len(str(v or "").encode("utf-8", "ignore"))
    except Exception:
        return 0


def slim_entry(key, v):
    """History is metadata only: no command text and no output text."""
    v = v if isinstance(v, dict) else {}
    return {
        "id": v.get("id", key),
        "ok": v.get("ok"),
        "exit_code": v.get("exit_code"),
        "duration_ms": v.get("duration_ms", 0),
        "ts": v.get("ts", 0),
        "session_key": v.get("session_key") or "",
        "ai": v.get("ai", ""),
        "cmd_len": int(v.get("cmd_len") or 0),
        "stdout_len": int(v.get("stdout_len") or 0),
        "stderr_len": int(v.get("stderr_len") or 0),
    }


def _history_key(v):
    """Dedup key: session fingerprint + id (never the raw session URL)."""
    v = v if isinstance(v, dict) else {}
    return "%s|%s" % (v.get("session_key") or "", v.get("id") or "")


def _iter_history(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict) and obj.get("id"):
                    yield obj
    except OSError:
        return


def _trim_history(hist):
    items = sorted(hist.items(), key=lambda kv: kv[1].get("ts", 0), reverse=True)
    return dict(items[:HISTORY_LIMIT])


def _acquire_lock(path, timeout=5.0, stale=HISTORY_LOCK_STALE):
    """Best-effort cross-process lock. Returns an fd, or None on timeout."""
    deadline = time.time() + timeout
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                os.write(fd, str(os.getpid()).encode("ascii"))
            except OSError:
                pass
            return fd
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(path) > stale:
                    os.remove(path)
                    continue
            except OSError:
                pass
            if time.time() >= deadline:
                return None
            time.sleep(0.05)
        except OSError:
            return None


def _release_lock(fd, path):
    try:
        os.close(fd)
    except OSError:
        pass
    try:
        os.remove(path)
    except OSError:
        pass


def load_history():
    """Read the append-only JSONL history; last writer for (session,id) wins."""
    hist = {}
    for obj in _iter_history(HISTORY_PATH):
        key = _history_key(obj)
        hist[key] = slim_entry(str(obj.get("id") or ""), obj)
    return _trim_history(hist)


def refresh_history():
    """Re-read from disk before dedup checks so two hosts see each other."""
    global HISTORY
    HISTORY = load_history()
    return HISTORY


def _compact_history_locked():
    try:
        if os.path.getsize(HISTORY_PATH) <= HISTORY_MAX_BYTES:
            return
    except OSError:
        return
    hist = {}
    for obj in _iter_history(HISTORY_PATH):
        key = _history_key(obj)
        hist[key] = slim_entry(str(obj.get("id") or ""), obj)
    hist = _trim_history(hist)
    tmp = HISTORY_PATH + ".tmp.%d" % os.getpid()
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            for v in sorted(hist.values(), key=lambda x: x.get("ts", 0)):
                f.write(json.dumps(v, ensure_ascii=False,
                                   separators=(",", ":")) + "\n")
        os.replace(tmp, HISTORY_PATH)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass


def append_history(entry):
    """Append one JSON line. The lock also protects occasional compaction."""
    line = json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n"
    lock_fd = _acquire_lock(HISTORY_LOCK, 5.0)
    try:
        with open(HISTORY_PATH, "a", encoding="utf-8") as f:
            f.write(line)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        if lock_fd is not None:
            _compact_history_locked()
    except OSError:
        pass
    finally:
        if lock_fd is not None:
            _release_lock(lock_fd, HISTORY_LOCK)


def _pid_alive(pid):
    if not pid:
        return False
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if sys.platform == "win32":
        try:
            import ctypes
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                return False
            code = ctypes.c_ulong()
            ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            kernel32.CloseHandle(handle)
            return bool(ok) and code.value == STILL_ACTIVE
        except Exception:
            return True  # uncertain: do not declare a live task stale
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def _terminate_tree(pid, pgid=None, grace=3.0):
    """Terminate a command's process tree. Best-effort cross-platform."""
    if not pid:
        return
    if sys.platform == "win32":
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=10)
        except Exception:
            pass
        return
    try:
        target = int(pgid or pid)
    except (TypeError, ValueError):
        target = int(pid)
    try:
        os.killpg(target, signal.SIGTERM)
    except OSError:
        try:
            os.kill(int(pid), signal.SIGTERM)
        except OSError:
            return
    deadline = time.time() + grace
    while time.time() < deadline:
        if not _pid_alive(pid):
            return
        time.sleep(0.1)
    try:
        os.killpg(target, signal.SIGKILL)
    except OSError:
        try:
            os.kill(int(pid), signal.SIGKILL)
        except OSError:
            pass


def _lease_read():
    try:
        with open(LEASE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _lease_write(lease):
    os.makedirs(RUNTIME_DIR, exist_ok=True)
    tmp = LEASE_PATH + ".tmp.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(lease, f, ensure_ascii=False, indent=2)
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    last_error = None
    for _ in range(5):
        try:
            os.replace(tmp, LEASE_PATH)
            return
        except OSError as e:
            last_error = e
            time.sleep(0.02)
    if last_error is not None:
        raise last_error


def _lease_is_stale(lease):
    if not lease:
        return True
    if lease.get("browser_alive") is False:
        return True
    if not _pid_alive(lease.get("host_pid")):
        return True
    try:
        age = time.time() - float(lease.get("last_heartbeat") or 0)
    except (TypeError, ValueError):
        return True
    return age > LEASE_STALE_SECONDS


def _lease_owner(lease):
    return (lease or {}).get("owner") or {}


def _lease_owner_binding(lease):
    return _lease_owner(lease).get("binding_id")


def _lease_cleanup_orphan(lease):
    child_pid = (lease or {}).get("child_pid")
    if child_pid and _pid_alive(child_pid):
        log("lease: terminating orphan child pid=%s pgid=%s" % (
            child_pid, (lease or {}).get("child_pgid")))
        _terminate_tree(child_pid, (lease or {}).get("child_pgid"))


def _lease_busy_result(lease, reason=None, stale=False):
    owner = _lease_owner(lease)
    state = (lease or {}).get("state", "connected")
    if reason is None:
        reason = "owner_running" if state == "running" else "owner_connected"
    elapsed = 0
    try:
        if state == "running":
            elapsed = int(time.time() - float((lease or {}).get("started_at") or 0))
    except (TypeError, ValueError):
        elapsed = 0
    return {
        "ok": False,
        "reason": reason,
        "owner": owner,
        "state": state,
        "elapsed_s": elapsed,
        "stale": stale,
    }


def lease_acquire(binding_id, session, ai, page_url="", page_title="", browser="", extension_id=""):
    if not (isinstance(binding_id, str) and binding_id and
            isinstance(session, str) and session and
            isinstance(ai, str) and ai):
        return {"ok": False, "reason": "invalid",
                "error": "binding_id/session/ai must be non-empty strings"}
    fd = _acquire_lock(LEASE_LOCK, 5.0, stale=LEASE_LOCK_STALE)
    if fd is None:
        return {"ok": False, "reason": "lock_timeout",
                "error": "could not acquire the machine lease lock"}
    try:
        lease = _lease_read()
        now = time.time()
        if lease and not _lease_is_stale(lease):
            owner = _lease_owner(lease)
            if owner.get("binding_id") == binding_id:
                owner.update({"session": session, "ai": ai,
                              "page_url": page_url, "page_title": page_title,
                              "browser": browser, "extension_id": extension_id})
                lease.update({
                    "owner": owner,
                    "host_pid": os.getpid(),
                    "browser_alive": True,
                    "last_heartbeat": now,
                    "last_binding_heartbeat": now,
                })
                _lease_write(lease)
                return {"ok": True, "lease": lease, "refreshed": True}
            return _lease_busy_result(lease)
        stale = bool(lease)
        if stale:
            _lease_cleanup_orphan(lease)
        new = {
            "schema": LEASE_SCHEMA,
            "owner": {
                "binding_id": binding_id,
                "session": session,
                "ai": ai,
                "page_url": page_url,
                "page_title": page_title,
                "extension_id": extension_id,
                "browser": browser,
            },
            "state": "connected",
            "host_pid": os.getpid(),
            "browser_alive": True,
            "child_pid": None,
            "child_pgid": None,
            "task_id": None,
            "cmd": "",
            "started_at": 0,
            "last_heartbeat": now,
            "last_progress": 0,
            "last_binding_heartbeat": now,
            "cancel_requested": False,
        }
        _lease_write(new)
        return {"ok": True, "lease": new, "took_over_stale": stale}
    finally:
        _release_lock(fd, LEASE_LOCK)


def lease_release(binding_id=None):
    fd = _acquire_lock(LEASE_LOCK, 5.0, stale=LEASE_LOCK_STALE)
    if fd is None:
        return False
    try:
        lease = _lease_read()
        if not lease:
            return True
        if binding_id and _lease_owner_binding(lease) != binding_id:
            return False
        try:
            os.remove(LEASE_PATH)
        except OSError:
            pass
        return True
    finally:
        _release_lock(fd, LEASE_LOCK)


def lease_update_owned(binding_id, **fields):
    if not binding_id:
        return None
    fd = _acquire_lock(LEASE_LOCK, 5.0, stale=LEASE_LOCK_STALE)
    if fd is None:
        return None
    try:
        lease = _lease_read()
        if not lease or _lease_owner_binding(lease) != binding_id:
            return None
        lease.update(fields)
        lease["host_pid"] = os.getpid()
        if "browser_alive" not in fields:
            lease["browser_alive"] = True
        lease["last_heartbeat"] = time.time()
        _lease_write(lease)
        return lease
    finally:
        _release_lock(fd, LEASE_LOCK)


def lease_touch(binding_id=None):
    binding_id = binding_id or LEASE_BINDING
    if not binding_id:
        return None
    return lease_update_owned(binding_id, last_heartbeat=time.time(),
                              browser_alive=BROWSER_ALIVE)


def lease_request_cancel(binding_id=None, foreign=False):
    fd = _acquire_lock(LEASE_LOCK, 5.0, stale=LEASE_LOCK_STALE)
    if fd is None:
        return False
    try:
        lease = _lease_read()
        if not lease:
            return False
        if not foreign and binding_id and _lease_owner_binding(lease) != binding_id:
            return False
        lease["cancel_requested"] = True
        _lease_write(lease)
        return True
    finally:
        _release_lock(fd, LEASE_LOCK)


def lease_cancel_requested(binding_id=None):
    lease = _lease_read()
    if not lease:
        return False
    if binding_id and _lease_owner_binding(lease) != binding_id:
        return False
    return bool(lease.get("cancel_requested"))


def lease_status():
    lease = _lease_read()
    if not lease:
        return {"state": "idle", "stale": True, "owner": None}
    elapsed = 0
    try:
        if lease.get("state") == "running":
            elapsed = int(time.time() - float(lease.get("started_at") or 0))
    except (TypeError, ValueError):
        elapsed = 0
    return {
        "state": lease.get("state", "connected"),
        "owner": _lease_owner(lease),
        "stale": _lease_is_stale(lease),
        "host_pid": lease.get("host_pid"),
        "task_id": lease.get("task_id"),
        "cmd": lease.get("cmd", ""),
        "started_at": lease.get("started_at", 0),
        "elapsed_s": elapsed,
        "cancel_requested": bool(lease.get("cancel_requested")),
    }


def get_machine_id():
    """Read install-time identity. Never generate at runtime."""
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


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len:
        return None
    (length,) = struct.unpack("<I", raw_len)
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    with SEND_LOCK:
        sys.stdout.buffer.write(struct.pack("<I", len(data)))
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def decode_output(raw):
    if not raw:
        return ""
    for enc in ("utf-8", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def shell_argv(cmd):
    if sys.platform == "win32":
        return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd]
    if os.path.exists("/bin/zsh"):
        return ["/bin/zsh", "-lc", cmd]
    return ["/bin/bash", "-lc", cmd]


def shell_name():
    return "powershell" if sys.platform == "win32" else "zsh"


def run_exec(msg, cancel_event=None):
    rid = msg.get("id")
    binding_id = msg.get("binding_id") or ""
    # Two host processes (Chrome/Edge) share the home dir: re-read before
    # dedup so a just-finished command in the other browser is visible.
    refresh_history()
    session = msg.get("session") or ""
    hkey = _history_key({"id": rid, "session_key": _session_key(session)})
    if hkey in HISTORY:
        log("duplicate id=%s session_key=%s, returning cached" %
            (rid, _session_key(session)))
        h = HISTORY[hkey]
        # dedup hit: honestly report "this is cached"; output is summary only (full output was filled back into the page at the time)
        return {
            "type": "result",
            "id": rid,
            "hostname": socket.gethostname(),
            "machine_id": MACHINE_ID,
            "session": session,
            "ai": msg.get("ai") or h.get("ai", ""),
            "ok": h.get("ok"),
            "exit_code": h.get("exit_code"),
            "stdout": "…(dedup hit: this id was already executed; output is not retained for privacy)",
            "stderr": "",
            "duration_ms": h.get("duration_ms", 0),
            "duplicate": True,
            "ts": h.get("ts", 0),
        }
    cmd = msg.get("cmd", "")
    # defense in depth: the extension already rejects oversized blocks; block again here (unusual path of talking to the host directly)
    if len(cmd.encode("utf-8", "ignore")) > MAX_CMD_BYTES:
        log("exec id=%s oversize cmd, rejected" % rid)
        return {
            "type": "error",
            "id": rid,
            "error": "Command too large (512KB per-command limit); rejected. Split it into smaller chunks, or send large files via the attach channel.",
        }
    try:
        timeout = int(msg.get("timeout") or DEFAULT_TIMEOUT)
    except (TypeError, ValueError):
        timeout = DEFAULT_TIMEOUT
    approved = (msg.get("approved") is True)
    if timeout < 1:
        timeout = 1
    hard_limit = APPROVED_TIMEOUT_MAX if approved else AUTO_TIMEOUT_MAX
    if timeout > hard_limit:
        if approved:
            return {
                "type": "error",
                "id": rid,
                "error": "timeout %ss exceeds the hard limit %ss; split the command or run it manually" % (timeout, hard_limit),
            }
        return {
            "type": "error",
            "id": rid,
            "error": "timeout %ss requires explicit user approval (max %ss without approval); ask the user, then resend with approved=true" % (timeout, hard_limit),
        }
    rid = msg.get("id")
    started = time.time()
    lease_update_owned(binding_id, state="running", task_id=rid,
                       cmd=cmd[:200], started_at=started,
                       last_progress=started, cancel_requested=False)
    error = None
    popen_kwargs = {}
    if sys.platform != "win32":
        popen_kwargs["start_new_session"] = True
    else:
        popen_kwargs["creationflags"] = getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    proc = subprocess.Popen(
        shell_argv(cmd), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=HOST_CWD, **popen_kwargs
    )
    pgid = None
    if sys.platform != "win32":
        try:
            pgid = os.getpgid(proc.pid)
        except OSError:
            pgid = None
    lease_update_owned(binding_id, child_pid=proc.pid, child_pgid=pgid)
    box = {}

    def wait():
        try:
            box["out"], box["err"] = proc.communicate()
        except Exception:
            box["out"], box["err"] = b"", b""

    t = threading.Thread(target=wait, daemon=True)
    t.start()
    last_progress_at = started
    while t.is_alive():
        now = time.time()
        if cancel_event is not None and cancel_event.is_set():
            _terminate_tree(proc.pid, pgid)
            t.join(5)
            error = "killed by user"
            break
        if binding_id and lease_cancel_requested(binding_id):
            _terminate_tree(proc.pid, pgid)
            t.join(5)
            error = "killed by user (interrupt requested)"
            break
        remaining = timeout - (now - started)
        if remaining <= 0:
            _terminate_tree(proc.pid, pgid)
            t.join(5)
            error = "timeout after %ss" % timeout
            break
        t.join(min(1.0, remaining))
        if t.is_alive() and time.time() - last_progress_at >= 20:
            last_progress_at = time.time()
            lease_update_owned(binding_id, last_progress=last_progress_at)
            # heartbeat roughly every 20s so the upper long-lived connection isn't killed as idle
            try:
                send_message(
                    {
                        "type": "progress",
                        "id": rid,
                        "elapsed_ms": int((time.time() - started) * 1000),
                    }
                )
            except Exception as e:
                log("progress send failed id=%s: %r" % (rid, e))
    if t.is_alive():
        # Last-resort pipe close: an orphan may hold stdout/stderr open.
        for pipe in (proc.stdout, proc.stderr):
            try:
                pipe.close()
            except Exception:
                pass
        t.join(2)
    exit_code = proc.returncode if proc.returncode is not None else -1
    stdout = decode_output(box.get("out"))
    stderr = decode_output(box.get("err"))
    duration_ms = int((time.time() - started) * 1000)
    log("exec id=%s session_key=%s exit=%s ms=%s cmd_len=%d" % (
        msg.get("id"), _session_key(session) or "-", exit_code, duration_ms,
        _byte_len(cmd)))
    res = {
        "type": "result",
        "id": msg.get("id"),
        "hostname": socket.gethostname(),
        "machine_id": MACHINE_ID,
        "session": msg.get("session") or "",
        "ai": msg.get("ai") or "",
        "ok": exit_code == 0 and error is None,
        "exit_code": exit_code,
        "stdout": stdout,
        "stderr": stderr,
        "duration_ms": duration_ms,
    }
    if error:
        res["error"] = error
        res["killed"] = error.startswith("killed")
    res["timeout"] = timeout
    res["approved"] = approved
    res["ts"] = int(time.time())
    # History entry: metadata and lengths only.
    HISTORY[hkey] = {
        "id": rid,
        "ok": res["ok"],
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "ts": res["ts"],
        "session_key": _session_key(session),
        "ai": msg.get("ai") or "",
        "cmd_len": _byte_len(cmd),
        "stdout_len": _byte_len(stdout),
        "stderr_len": _byte_len(stderr),
    }
    append_history(HISTORY[hkey])
    lease_update_owned(binding_id, state="connected", child_pid=None,
                       child_pgid=None, task_id=None, cmd="", started_at=0,
                       last_progress=time.time(), cancel_requested=False)
    return res


def _inside_dir(path, directory):
    try:
        path = os.path.abspath(path)
        directory = os.path.abspath(directory)
        return os.path.commonpath([path, directory]) == directory
    except ValueError:
        return False


def _custom_skill_error(data):
    """Return an error string for an invalid custom skill, or None."""
    if len(data) > MAX_SKILL_BYTES:
        return "custom skill too large: %d bytes (cap %d)" % (len(data), MAX_SKILL_BYTES)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return "custom skill must be UTF-8 text"
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return "custom skill needs frontmatter with name and description"
    meta = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower()
        if key in ("name", "description"):
            meta[key] = value.strip().strip('"').strip("'")
    if not meta.get("name") or not meta.get("description"):
        return "custom skill frontmatter needs non-empty name and description"
    return None


def _preset_skill_name(target):
    return (os.path.dirname(os.path.abspath(target)) == os.path.abspath(SKILLS_DIR) and
            os.path.basename(target) in ("AI-AGENT.md", "AI-BLENDER.md",
                                         "AI-MACOS.md", "AI-WIN.md"))


def run_write_file(msg):
    """Atomically replace or create one file after validating the request."""
    rid = msg.get("id")
    if not _binding_ok(msg):
        return {"type": "error", "id": rid, "error": "not the bound page"}
    if not _target_ok(msg):
        return {"type": "error", "id": rid, "error": "missing or mismatched host"}
    path = msg.get("path")
    content = msg.get("content")
    if not isinstance(path, str) or not path:
        return {"type": "error", "id": rid, "error": "missing path"}
    if not isinstance(content, str):
        return {"type": "error", "id": rid, "error": "missing content"}
    session = msg.get("session") or ""
    refresh_history()
    hkey = _history_key({"id": rid, "session_key": _session_key(session)})
    if hkey in HISTORY:
        h = HISTORY[hkey]
        return {
            "type": "result", "id": rid,
            "hostname": socket.gethostname(), "machine_id": MACHINE_ID,
            "session": session, "ai": msg.get("ai") or h.get("ai", ""),
            "ok": h.get("ok"), "exit_code": h.get("exit_code"),
            "stdout": "…(dedup hit: this write id was already executed; no second write)",
            "stderr": "", "duration_ms": h.get("duration_ms", 0),
            "duplicate": True, "ts": h.get("ts", 0),
        }
    started = time.time()
    mode = msg.get("mode") or "replace"
    if mode != "replace":
        return {"type": "error", "id": rid, "error": "unsupported write mode: %s" % mode}
    encoding = msg.get("encoding") or "utf8"
    if encoding not in ("utf8", "base64"):
        return {"type": "error", "id": rid, "error": "unsupported encoding: %s" % encoding}
    try:
        data = (content.encode("utf-8") if encoding == "utf8"
                else base64.b64decode(content, validate=True))
    except Exception as e:
        return {"type": "error", "id": rid, "error": "content decode failed: %r" % (e,)}
    if len(data) > MAX_WRITE_BYTES:
        return {"type": "error", "id": rid,
                "error": "write payload too large: %d bytes (cap %d)" %
                         (len(data), MAX_WRITE_BYTES)}
    target = os.path.abspath(os.path.expanduser(path))
    low = target.lower()
    for pat in FILE_DENY:
        if pat in low:
            log("write_file DENY id=%s path_len=%d pattern=%s" % (rid, len(target), pat))
            return {"type": "error", "id": rid, "error": "refusing to write sensitive path"}
    if os.path.islink(target):
        return {"type": "error", "id": rid, "error": "refusing to write through a symlink"}
    if os.path.exists(target) and not os.path.isfile(target):
        return {"type": "error", "id": rid, "error": "target is not a regular file"}
    parent = os.path.dirname(target)
    if not os.path.isdir(parent):
        return {"type": "error", "id": rid, "error": "parent directory does not exist"}
    if _preset_skill_name(target):
        return {"type": "error", "id": rid,
                "error": "preset skills are installer-managed; copy the skill into custom/"}
    if (_inside_dir(target, CUSTOM_SKILLS_DIR) and target.endswith(".md") and
            os.path.basename(target) != "README.md"):
        skill_error = _custom_skill_error(data)
        if skill_error:
            return {"type": "error", "id": rid, "error": skill_error}
    exists = os.path.exists(target)
    if exists and msg.get("overwrite") is not True:
        return {"type": "error", "id": rid,
                "error": "target exists; resend with overwrite=true after user confirmation"}
    old = b""
    old_sha = None
    if exists:
        try:
            with open(target, "rb") as f:
                old = f.read()
            old_sha = hashlib.sha256(old).hexdigest()
        except OSError as e:
            return {"type": "error", "id": rid, "error": "read existing file failed: %r" % (e,)}
        expected = (msg.get("expected_sha256") or "").strip().lower()
        if expected and expected != old_sha:
            return {"type": "error", "id": rid,
                    "error": "expected_sha256 mismatch; file changed, re-read and retry"}
    new_sha = hashlib.sha256(data).hexdigest()
    backup_path = None
    if exists and msg.get("backup") is not False:
        backup_path = target + ".webai-claw.bak." + time.strftime("%Y%m%d-%H%M%S")
        n = 1
        while os.path.exists(backup_path):
            backup_path = target + ".webai-claw.bak." + time.strftime("%Y%m%d-%H%M%S") + "." + str(n)
            n += 1
        try:
            shutil.copy2(target, backup_path)
        except OSError as e:
            return {"type": "error", "id": rid, "error": "backup failed: %r" % (e,)}
    tmp = target + ".webai-claw.tmp.%d.%s" % (os.getpid(), uuid.uuid4().hex)
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        if exists:
            try:
                os.chmod(tmp, stat.S_IMODE(os.stat(target).st_mode))
            except OSError:
                pass
        os.replace(tmp, target)
    except OSError as e:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return {"type": "error", "id": rid, "error": "write failed: %r" % (e,)}
    summary = ("wrote %s\nsize: %d bytes\nsha256: %s\nbackup: %s" %
               (target, len(data), new_sha, backup_path or "none"))
    result = {
        "type": "result", "id": rid,
        "hostname": socket.gethostname(), "machine_id": MACHINE_ID,
        "session": msg.get("session") or "", "ai": msg.get("ai") or "",
        "ok": True, "exit_code": 0, "stdout": summary, "stderr": "",
        "duration_ms": int((time.time() - started) * 1000),
        "path": target, "size": len(data), "sha256": new_sha,
        "backup": backup_path, "changed": old_sha != new_sha,
    }
    session_key = _session_key(msg.get("session") or "")
    append_history({
        "id": rid, "ok": True, "exit_code": 0,
        "duration_ms": result["duration_ms"], "ts": int(time.time()),
        "session_key": session_key, "ai": msg.get("ai") or "",
        "cmd_len": 0, "stdout_len": len(summary), "stderr_len": 0,
    })
    log("write_file id=%s path_len=%d size=%d backup=%s" %
        (rid, len(target), len(data), bool(backup_path)))
    return result


def run_read_file(msg):
    """Read a local file, return it base64-encoded in chunks. Deny-list + size cap."""
    rid = msg.get("id")
    if not _binding_ok(msg):
        return {"type": "error", "id": rid, "error": "not the bound page"}
    if not _target_ok(msg):
        return {"type": "error", "id": rid, "error": "missing or mismatched host"}
    path = msg.get("path", "")
    if not path:
        return {"type": "error", "id": rid, "error": "missing path"}
    try:
        real = os.path.realpath(os.path.expanduser(path))
    except Exception as e:
        return {"type": "error", "id": rid, "error": "path resolution failed: %r" % (e,)}
    if not os.path.isfile(real):
        return {"type": "error", "id": rid, "error": "file not found: %s" % real}
    low = real.lower()
    for pat in FILE_DENY:
        if pat in low:
            log("read_file DENY id=%s path_len=%d pattern=%s" % (rid, len(real), pat))
            return {"type": "error", "id": rid, "error": "refusing to read sensitive path"}
    try:
        size = os.path.getsize(real)
    except OSError as e:
        return {"type": "error", "id": rid, "error": "cannot read size: %r" % (e,)}
    if size > MAX_FILE_SIZE:
        return {"type": "error", "id": rid,
                "error": "file too large: %d bytes (cap %d)" % (size, MAX_FILE_SIZE)}
    try:
        with open(real, "rb") as f:
            raw = f.read()
    except OSError as e:
        return {"type": "error", "id": rid, "error": "read failed: %r" % (e,)}
    b64 = base64.b64encode(raw).decode("ascii")
    name = os.path.basename(real)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    chunks = [b64[i:i + CHUNK_B64] for i in range(0, len(b64), CHUNK_B64)] or [""]
    total = len(chunks)
    out = []
    for i, ch in enumerate(chunks):
        out.append({
            "type": "file_chunk",
            "id": rid,
            "name": name,
            "mime": mime,
            "size": size,
            "index": i,
            "total": total,
            "data": ch,
        })
    log("read_file id=%s path_len=%d size=%d chunks=%d mime=%s" % (rid, len(real), size, total, mime))
    return out


def _binding_ok(msg):
    """Require a live lease and exact binding/session/AI match."""
    lease = _lease_read()
    if not lease or _lease_is_stale(lease):
        return False
    owner = _lease_owner(lease)
    binding_id = msg.get("binding_id")
    if not isinstance(binding_id, str) or not binding_id:
        return False
    if binding_id != owner.get("binding_id"):
        return False
    if (msg.get("session") or "") != (owner.get("session") or ""):
        return False
    if (msg.get("ai") or "") != (owner.get("ai") or ""):
        return False
    return True


def _target_ok(msg):
    host = msg.get("host")
    if not isinstance(host, str) or not host:
        return False
    return host.strip().lower() == (MACHINE_ID or "").lower()


def _read_text_file(path, limit=512 * 1024):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read(limit)
    except OSError:
        return ""


def _skill_platform():
    if sys.platform == "darwin":
        return "macos"
    if sys.platform == "win32":
        return "windows"
    return "linux"


def _parse_skill(path):
    """Read only the frontmatter and return bounded metadata."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            first = f.readline()
            if first.strip() != "---":
                return None
            meta = {}
            for _ in range(160):
                line = f.readline()
                if not line:
                    break
                if line.strip() == "---":
                    break
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                key = key.strip().lower()
                value = value.strip().strip('"').strip("'")
                if key in ("name", "description", "triggers", "platforms", "version"):
                    meta[key] = value
    except OSError:
        return None
    name = (meta.get("name") or "").strip()
    desc = (meta.get("description") or "").strip()
    if not name or not desc:
        return None
    triggers = []
    for item in (meta.get("triggers") or "").strip("[]").split(","):
        item = item.strip()
        if item and item not in triggers:
            triggers.append(item)
    platforms = []
    for item in (meta.get("platforms") or "any").strip("[]").split(","):
        item = item.strip().lower()
        if item and item not in platforms:
            platforms.append(item)
    if not platforms:
        platforms = ["any"]
    current = _skill_platform()
    if "any" not in platforms and current not in platforms:
        return None
    rel = os.path.relpath(path, SKILLS_DIR).replace(os.sep, "/")
    return {
        "name": name[:80],
        "description": desc[:SKILL_DESC_MAX],
        "triggers": triggers[:8],
        "platforms": platforms[:4],
        "version": (meta.get("version") or "1")[:16],
        "path": "~/webai-claw-skills/" + rel,
        "source": "custom" if rel.startswith("custom/") else "preset",
    }


def _skill_index():
    by_name = {}
    for directory, source in ((SKILLS_DIR, "preset"),
                              (os.path.join(SKILLS_DIR, "custom"), "custom")):
        if not os.path.isdir(directory):
            continue
        try:
            entries = sorted(os.scandir(directory), key=lambda e: e.name.lower())
        except OSError:
            continue
        for entry in entries:
            if not entry.is_file(follow_symlinks=False):
                continue
            if not entry.name.endswith(".md") or entry.name == "AI-AGENT.md":
                continue
            meta = _parse_skill(entry.path)
            if not meta:
                continue
            # The custom directory is scanned second and wins on name conflict.
            by_name[meta["name"]] = meta
            if len(by_name) >= SKILL_INDEX_MAX:
                break
    result = sorted(by_name.values(), key=lambda x: (x["source"] != "preset", x["name"].lower()))
    # Keep the Connect attachment bounded even if descriptions are large.
    while len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > SKILL_INDEX_MAX_BYTES and result:
        result.pop()
    return result


def run_bundle(msg):
    rid = msg.get("id")
    if not _binding_ok(msg):
        return {"type": "error", "id": rid, "error": "not the bound page"}
    guide = ""
    for path in (os.path.join(os.path.expanduser("~/webai-claw-skills"), "AI-AGENT.md"),
                 os.path.join(BASE_DIR, "AI-AGENT.md"),
                 os.path.join(os.path.dirname(BASE_DIR), "AI-AGENT.md")):
        guide = _read_text_file(path)
        if guide:
            break
    handoff = _read_text_file(HANDOFF_PATH)
    return {
        "type": "bundle", "id": rid,
        "machine_id": MACHINE_ID,
        "hostname": socket.gethostname(),
        "platform": sys.platform,
        "shell": shell_name(),
        "host_version": HOST_VERSION,
        "guide": guide,
        "handoff": handoff,
        "skills": _skill_index(),
    }


def run_summary(msg):
    rid = msg.get("id")
    if not _binding_ok(msg):
        return {"type": "error", "id": rid, "error": "not the bound page"}
    if not _target_ok(msg):
        return {"type": "error", "id": rid, "error": "missing or mismatched host"}
    text = msg.get("text", "")
    if not isinstance(text, str) or not text.strip():
        return {"type": "error", "id": rid, "error": "summary text is empty"}
    if len(text.encode("utf-8", "ignore")) > MAX_CMD_BYTES:
        return {"type": "error", "id": rid, "error": "summary too large"}
    try:
        os.makedirs(BASE_DIR, exist_ok=True)
        tmp = HANDOFF_PATH + ".tmp.%d" % os.getpid()
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, HANDOFF_PATH)
    except OSError as e:
        return {"type": "error", "id": rid,
                "error": "failed to write handoff: %r" % (e,)}
    log("summary id=%s bytes=%d -> %s" % (
        rid, len(text.encode("utf-8", "ignore")), HANDOFF_PATH))
    return {
        "type": "result", "kind": "summary", "id": rid,
        "hostname": socket.gethostname(),
        "platform": sys.platform, "machine_id": MACHINE_ID,
        "session": msg.get("session") or "", "ai": msg.get("ai") or "",
        "handoff": HANDOFF_PATH,
        "ok": True, "exit_code": 0,
        "stdout": "summary written to %s" % HANDOFF_PATH,
        "stderr": "", "duration_ms": 0, "ts": int(time.time()),
    }


def run_diag(msg):
    if not _binding_ok(msg):
        return {"type": "error", "id": msg.get("id"), "error": "not the bound page"}
    if not _target_ok(msg):
        return {"type": "error", "id": msg.get("id"), "error": "missing or mismatched host"}
    try:
        refresh_history()
        tail = []
        if os.path.exists(LOG_PATH):
            with open(LOG_PATH, encoding="utf-8", errors="replace") as f:
                tail = f.readlines()[-20:]
        recent = sorted(HISTORY.items(), key=lambda kv: kv[1].get("ts", 0), reverse=True)[:10]
        recent_list = [{"id": v.get("id", k), "ok": v.get("ok"),
                        "ts": v.get("ts"), "session_key": v.get("session_key", "")}
                       for k, v in recent]
        return {
            "type": "result",
            "id": msg.get("id"),
            "hostname": socket.gethostname(),
            "platform": sys.platform,
            "machine_id": MACHINE_ID,
            "session": msg.get("session") or "",
            "ai": msg.get("ai") or "",
            "host_version": HOST_VERSION,
            "lease": lease_status(),
            "pid": os.getpid(),
            "history_size": len(HISTORY),
            "history_limit": HISTORY_LIMIT,
            "recent": recent_list,
            "log_tail": "".join(tail),
            "ok": True,
            "exit_code": 0,
            "duration_ms": 0,
        }
    except Exception as e:
        return {"type": "error", "id": msg.get("id"), "error": "diag failed: %r" % (e,)}


def start_exec(msg):
    global ACTIVE
    rid = msg.get("id")
    if (not isinstance(rid, str) or not rid or
            not isinstance(msg.get("cmd"), str) or not msg.get("cmd")):
        return {"type": "error", "id": rid,
                "error": "id and cmd must be non-empty strings"}
    if not _target_ok(msg):
        return {"type": "error", "id": rid,
                "error": "missing or mismatched host; command not executed"}
    if not _binding_ok(msg):
        return {"type": "error", "id": rid,
                "error": "not the bound page for this machine; reconnect the extension"}
    lease = _lease_read()
    if lease and lease.get("state") == "running":
        return {"type": "error", "id": rid,
                "error": "host busy: %s" % (lease.get("task_id") or "?")}
    with STATE_LOCK:
        if ACTIVE is not None:
            return {"type": "error", "id": rid,
                    "error": "host busy: %s" % (ACTIVE.get("id") or "?")}
        cancel = threading.Event()
        ACTIVE = {"id": rid, "cancel": cancel, "started": time.time()}
    threading.Thread(target=exec_worker, args=(msg, cancel), daemon=True).start()
    return None


def exec_worker(msg, cancel):
    global ACTIVE
    try:
        res = run_exec(msg, cancel_event=cancel)
    except Exception as e:
        log("exec worker error: %r" % (e,))
        res = {"type": "error", "id": msg.get("id"), "error": str(e)}
    finally:
        binding = msg.get("binding_id") or ""
        lease_update_owned(binding, state="connected", child_pid=None,
                           child_pgid=None, task_id=None, cmd="", started_at=0,
                           last_progress=time.time(), cancel_requested=False)
        with STATE_LOCK:
            ACTIVE = None
    try:
        send_message(res)
    except Exception:
        pass


def handle_connect(msg):
    global LEASE_BINDING
    binding = msg.get("binding_id") or ""
    result = lease_acquire(binding, msg.get("session") or "",
                           msg.get("ai") or "", msg.get("page_url") or "",
                           msg.get("page_title") or "",
                           msg.get("browser") or "",
                           msg.get("extension_id") or "")
    if result.get("ok"):
        LEASE_BINDING = binding
        log("connect binding=%s session_key=%s ai=%s%s%s" % (
            binding, _session_key(msg.get("session") or "") or "-",
            msg.get("ai") or "",
            " refreshed" if result.get("refreshed") else "",
            " took_over_stale" if result.get("took_over_stale") else ""))
        return {
            "type": "connected",
            "id": msg.get("id"),
            "binding_id": binding,
            "machine_id": MACHINE_ID,
            "hostname": socket.gethostname(),
            "platform": sys.platform,
            "shell": shell_name(),
            "host_version": HOST_VERSION,
            "session": msg.get("session") or "",
            "ai": msg.get("ai") or "",
            "took_over_stale": bool(result.get("took_over_stale")),
        }
    owner = result.get("owner") or {}
    log("connect busy binding=%s session_key=%s owner_binding=%s state=%s" % (
        binding, _session_key(msg.get("session") or "") or "-",
        owner.get("binding_id") or "", result.get("state") or ""))
    return {"type": "busy", "id": msg.get("id"), **result}


def handle_disconnect(msg):
    global LEASE_BINDING
    binding = msg.get("binding_id") or ""
    if not binding:
        return {"type": "error", "id": msg.get("id"), "error": "missing binding_id"}
    with STATE_LOCK:
        active = ACTIVE
    if active and binding == LEASE_BINDING:
        active["cancel"].set()
    ok = lease_release(binding)
    # Stop the heartbeat even if the lock was momentarily unavailable; a stale
    # lease is safer than a released page continuing to refresh it. But do not
    # let a wrong binding silence the real owner's heartbeat.
    if ok or binding == LEASE_BINDING:
        LEASE_BINDING = None
    log("disconnect binding=%s ok=%s" % (binding, "1" if ok else "0"))
    return {"type": "result", "id": msg.get("id"), "ok": ok,
            "exit_code": 0 if ok else 1,
            "stdout": "disconnected" if ok else "not the lease owner",
            "stderr": "", "duration_ms": 0, "ts": int(time.time())}


def handle_status(msg):
    return {
        "type": "state",
        "id": msg.get("id"),
        "machine_id": MACHINE_ID,
        "hostname": socket.gethostname(),
        "platform": sys.platform,
        "shell": shell_name(),
        "host_version": HOST_VERSION,
        "lease": lease_status(),
    }


def handle_kill(msg):
    rid = msg.get("id")
    if not _binding_ok(msg):
        return {"type": "error", "id": rid, "error": "not the bound page for this machine"}
    with STATE_LOCK:
        active = ACTIVE
    if not active:
        return {"type": "error", "id": rid, "error": "no running task"}
    if rid and rid != active.get("id"):
        return {"type": "error", "id": rid,
                "error": "running task is %s" % active.get("id")}
    active["cancel"].set()
    try:
        lease_request_cancel(msg.get("binding_id"))
    except Exception:
        pass
    return {"type": "progress", "id": active.get("id"),
            "elapsed_ms": int((time.time() - active.get("started", time.time())) * 1000),
            "killing": True}


def handle_cancel(msg):
    binding = msg.get("binding_id") or ""
    if not binding:
        return {"type": "error", "id": msg.get("id"), "error": "missing binding_id"}
    with STATE_LOCK:
        active = ACTIVE
    if active and binding == LEASE_BINDING:
        active["cancel"].set()
        return {"type": "progress", "id": active.get("id"), "killing": True}
    ok = lease_request_cancel(binding, foreign=True)
    return {"type": "result", "id": msg.get("id"), "ok": ok,
            "exit_code": 0 if ok else 1,
            "stdout": "cancel requested" if ok else "no matching task/lease",
            "stderr": "", "duration_ms": 0, "ts": int(time.time())}


def handle(msg):
    t = msg.get("type")
    if t == "ping":
        return {
            "type": "pong",
            "id": msg.get("id"),
            "hostname": socket.gethostname(),
            "platform": sys.platform,
            "machine_id": MACHINE_ID,
            "host_version": HOST_VERSION,
            "shell": shell_name(),
            "lease": lease_status(),
        }
    if t == "connect":
        return handle_connect(msg)
    if t == "disconnect":
        return handle_disconnect(msg)
    if t == "status":
        return handle_status(msg)
    if t == "exec":
        return start_exec(msg)
    if t == "kill":
        return handle_kill(msg)
    if t == "cancel":
        return handle_cancel(msg)
    if t == "bundle":
        return run_bundle(msg)
    if t == "summary":
        return run_summary(msg)
    if t == "diag":
        return run_diag(msg)
    if t == "read_file":
        return run_read_file(msg)
    if t == "write_file":
        return run_write_file(msg)
    return {"type": "error", "id": msg.get("id"), "error": "unknown type: %r" % (t,)}


SEND_LOCK = threading.Lock()
STATE_LOCK = threading.Lock()
ACTIVE = None
BROWSER_ALIVE = True
SHUTDOWN_EVENT = threading.Event()
LEASE_BINDING = None
HISTORY = {}
MACHINE_ID = None


def _on_signal(signum, frame):
    global BROWSER_ALIVE
    BROWSER_ALIVE = False
    SHUTDOWN_EVENT.set()
    with STATE_LOCK:
        active = ACTIVE
    if active:
        active["cancel"].set()
    try:
        sys.stdin.close()
    except Exception:
        pass


def heartbeat_loop():
    while not SHUTDOWN_EVENT.wait(HEARTBEAT_INTERVAL):
        try:
            if BROWSER_ALIVE:
                lease_touch()
        except Exception:
            pass


def main():
    global HISTORY, MACHINE_ID, BROWSER_ALIVE
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        os.makedirs(RUNTIME_DIR, exist_ok=True)
    except OSError:
        pass
    MACHINE_ID = get_machine_id()
    if not MACHINE_ID:
        log("fatal: machine identity missing/invalid at %s; run install.py" % MACHINE_ID_PATH)
        sys.stderr.write("webai-claw: machine identity missing; run native-host/install.py\n")
        return 3
    HISTORY = load_history()
    BROWSER_ALIVE = True
    for sig in (signal.SIGTERM, signal.SIGINT, getattr(signal, "SIGHUP", None)):
        if sig is not None:
            try:
                signal.signal(sig, _on_signal)
            except (OSError, ValueError):
                pass
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    log("host started platform=%s hostname=%s machine_id=%s history=%d version=%s" % (
        sys.platform, socket.gethostname(), MACHINE_ID, len(HISTORY), HOST_VERSION))
    while True:
        try:
            msg = read_message()
        except Exception:
            break
        if msg is None:
            break
        try:
            res = handle(msg)
            if res is None:
                continue
            if isinstance(res, list):
                for item in res:
                    send_message(item)
            else:
                send_message(res)
        except Exception as e:  # one bad message must not take the host down
            log("handle error: %r" % (e,))
            try:
                send_message({"type": "error", "id": msg.get("id"), "error": str(e)})
            except Exception:
                break
    BROWSER_ALIVE = False
    SHUTDOWN_EVENT.set()
    with STATE_LOCK:
        active = ACTIVE
    if active:
        active["cancel"].set()
    deadline = time.time() + 10
    while time.time() < deadline:
        with STATE_LOCK:
            if ACTIVE is None:
                break
        time.sleep(0.1)
    if LEASE_BINDING:
        try:
            lease_update_owned(LEASE_BINDING, browser_alive=False)
        except Exception:
            pass
        try:
            lease_release(LEASE_BINDING)
        except Exception:
            pass
    log("host exit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
