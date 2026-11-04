"""File read/write operations for the native host.

The protocol checks remain in host.py; this module owns the filesystem-facing
implementation and is exercised directly by tests.
"""

import base64
import hashlib
import mimetypes
import os
import shutil
import socket
import stat
import time
import uuid

from . import history
from .constants import (
    CHUNK_B64,
    CUSTOM_SKILLS_DIR,
    FILE_DENY,
    MAX_FILE_SIZE,
    MAX_WRITE_BYTES,
)
from .skills import custom_skill_error, inside_dir, is_preset_skill_path


def run_write_file(msg, binding_ok, target_ok, log, machine_id):
    """Atomically replace or create one file after validating the request."""
    rid = msg.get("id")
    if not binding_ok(msg):
        return {"type": "error", "id": rid, "error": "not the bound page"}
    if not target_ok(msg):
        return {"type": "error", "id": rid, "error": "missing or mismatched host"}
    path = msg.get("path")
    content = msg.get("content")
    if not isinstance(path, str) or not path:
        return {"type": "error", "id": rid, "error": "missing path"}
    if not isinstance(content, str):
        return {"type": "error", "id": rid, "error": "missing content"}
    session = msg.get("session") or ""
    history.refresh_history()
    hkey = history.history_key({"id": rid, "session_key": history.session_key(session)})
    if hkey in history.HISTORY:
        h = history.HISTORY[hkey]
        return {
            "type": "result", "id": rid,
            "hostname": socket.gethostname(), "machine_id": machine_id,
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
                "error": "write payload too large: %d bytes (cap %d); "
                         "do not append in chunks; create a small local "
                         "generator/transformer script with write_file and run "
                         "it with exec, or use a dedicated editor" %
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
    if is_preset_skill_path(target):
        return {"type": "error", "id": rid,
                "error": "preset skills are installer-managed; copy the skill into custom/"}
    if (inside_dir(target, CUSTOM_SKILLS_DIR) and target.endswith(".md") and
            os.path.basename(target) != "README.md"):
        skill_error = custom_skill_error(data)
        if skill_error:
            return {"type": "error", "id": rid, "error": skill_error}
    exists = os.path.exists(target)
    if exists and msg.get("overwrite") is not True:
        return {"type": "error", "id": rid,
                "error": "target exists; read it first, then resend with "
                         "overwrite=true and the old expected_sha256"}
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
        if not expected:
            return {"type": "error", "id": rid,
                    "error": "overwrite requires expected_sha256; read the file "
                             "first and resend with its current SHA-256"}
        if expected != old_sha:
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
    old_size = len(old) if exists else 0
    summary = ("wrote %s\nold_size: %d bytes\nnew_size: %d bytes\nsha256: %s\nbackup: %s" %
               (target, old_size, len(data), new_sha, backup_path or "none"))
    result = {
        "type": "result", "id": rid,
        "hostname": socket.gethostname(), "machine_id": machine_id,
        "session": msg.get("session") or "", "ai": msg.get("ai") or "",
        "ok": True, "exit_code": 0, "stdout": summary, "stderr": "",
        "duration_ms": int((time.time() - started) * 1000),
        "path": target, "size": len(data), "old_size": old_size,
        "sha256": new_sha, "old_sha256": old_sha,
        "backup": backup_path, "changed": old_sha != new_sha,
    }
    session_key = history.session_key(msg.get("session") or "")
    history.append_history({
        "id": rid, "ok": True, "exit_code": 0,
        "duration_ms": result["duration_ms"], "ts": int(time.time()),
        "session_key": session_key, "ai": msg.get("ai") or "",
        "cmd_len": 0, "stdout_len": len(summary), "stderr_len": 0,
    })
    log("write_file id=%s path_len=%d size=%d backup=%s" %
        (rid, len(target), len(data), bool(backup_path)))
    return result


def run_read_file(msg, binding_ok, target_ok, log, machine_id):
    """Read a local file, return it base64-encoded in chunks. Deny-list + size cap."""
    rid = msg.get("id")
    if not binding_ok(msg):
        return {"type": "error", "id": rid, "error": "not the bound page"}
    if not target_ok(msg):
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


