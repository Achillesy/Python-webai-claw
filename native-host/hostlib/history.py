"""Metadata-only execution history and cross-process dedup helpers."""

import hashlib
import json
import os

from .constants import (
    HISTORY_LIMIT,
    HISTORY_LOCK,
    HISTORY_MAX_BYTES,
    HISTORY_PATH,
)
from .locks import acquire_lock, release_lock

# Last writer for (session_key, id) wins. This is a small dedup table, not an
# audit archive; it never stores command text or output text.
HISTORY = {}


def session_key(session):
    """One-way session fingerprint for persisted logs/history (never the URL)."""
    text = str(session or "")
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()[:16]


def byte_len(value):
    try:
        return len(str(value or "").encode("utf-8", "ignore"))
    except Exception:
        return 0


def slim_entry(key, value):
    """History is metadata only: no command text and no output text."""
    value = value if isinstance(value, dict) else {}
    return {
        "id": value.get("id", key),
        "ok": value.get("ok"),
        "exit_code": value.get("exit_code"),
        "duration_ms": value.get("duration_ms", 0),
        "ts": value.get("ts", 0),
        "session_key": value.get("session_key") or "",
        "ai": value.get("ai", ""),
        "cmd_len": int(value.get("cmd_len") or 0),
        "stdout_len": int(value.get("stdout_len") or 0),
        "stderr_len": int(value.get("stderr_len") or 0),
    }


def history_key(value):
    """Dedup key: session fingerprint + id (never the raw session URL)."""
    value = value if isinstance(value, dict) else {}
    return "%s|%s" % (value.get("session_key") or "", value.get("id") or "")


def iter_history(path):
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


def trim_history(history):
    items = sorted(history.items(), key=lambda kv: kv[1].get("ts", 0), reverse=True)
    return dict(items[:HISTORY_LIMIT])


def load_history():
    """Read the append-only JSONL history; last writer for (session,id) wins."""
    history = {}
    for obj in iter_history(HISTORY_PATH):
        key = history_key(obj)
        history[key] = slim_entry(str(obj.get("id") or ""), obj)
    return trim_history(history)


def refresh_history():
    """Re-read from disk before dedup checks so two hosts see each other."""
    global HISTORY
    HISTORY = load_history()
    return HISTORY


def compact_history_locked():
    try:
        if os.path.getsize(HISTORY_PATH) <= HISTORY_MAX_BYTES:
            return
    except OSError:
        return
    history = {}
    for obj in iter_history(HISTORY_PATH):
        key = history_key(obj)
        history[key] = slim_entry(str(obj.get("id") or ""), obj)
    history = trim_history(history)
    tmp = HISTORY_PATH + ".tmp.%d" % os.getpid()
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            for value in sorted(history.values(), key=lambda x: x.get("ts", 0)):
                f.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        os.replace(tmp, HISTORY_PATH)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass


def append_history(entry):
    """Append one JSON line. The lock also protects occasional compaction."""
    line = json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n"
    lock_fd = acquire_lock(HISTORY_LOCK, 5.0)
    try:
        with open(HISTORY_PATH, "a", encoding="utf-8") as f:
            f.write(line)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        if lock_fd is not None:
            compact_history_locked()
    except OSError:
        pass
    finally:
        if lock_fd is not None:
            release_lock(lock_fd, HISTORY_LOCK)
