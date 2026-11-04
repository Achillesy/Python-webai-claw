"""Small cross-process lock helpers shared by history and lease storage."""

import os
import time

from .constants import HISTORY_LOCK_STALE


def acquire_lock(path, timeout=5.0, stale=HISTORY_LOCK_STALE):
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


def release_lock(fd, path):
    try:
        os.close(fd)
    except OSError:
        pass
    try:
        os.remove(path)
    except OSError:
        pass
