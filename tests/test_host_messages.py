"""Tests for the native-host message boundary (no browser needed)."""

import io
import json
import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "native-host"))

import host  # noqa: E402


def _frame(obj):
    data = json.dumps(obj).encode("utf-8")
    return struct.pack("<I", len(data)) + data


def _read_frames(raw):
    frames = []
    pos = 0
    while pos < len(raw):
        (length,) = struct.unpack_from("<I", raw, pos)
        pos += 4
        frames.append(json.loads(raw[pos:pos + length].decode("utf-8")))
        pos += length
    return frames


class _FakeStdio:
    def __init__(self, data):
        self.buffer = io.BytesIO(data)


class _FakeStdout:
    def __init__(self):
        self.buffer = io.BytesIO()


class HostMessageTests(unittest.TestCase):
    def test_non_object_message_is_an_error_not_a_crash(self):
        for bad in ([], "exec", 42, None):
            result = host.handle(bad)
            self.assertEqual(result["type"], "error")
            self.assertIn("JSON object", result["error"])

    def test_unknown_type_is_an_error_with_id(self):
        result = host.handle({"type": "skill", "id": "x1"})
        self.assertEqual(result["type"], "error")
        self.assertEqual(result["id"], "x1")

    def test_ping_does_not_require_a_lease(self):
        result = host.handle({"type": "ping", "id": "p1"})
        self.assertEqual(result["type"], "pong")
        self.assertEqual(result["id"], "p1")

    def test_read_message_distinguishes_eof_from_json_null(self):
        # EOF (no bytes) is the sentinel; a JSON null frame decodes to
        # None and must not be mistaken for EOF (B1).
        old_stdin = sys.stdin
        try:
            sys.stdin = _FakeStdio(b"")
            self.assertIs(host.read_message(), host.EOF_SENTINEL)
            sys.stdin = _FakeStdio(_frame(None))
            self.assertIsNone(host.read_message())
        finally:
            sys.stdin = old_stdin

    def test_json_null_frame_gets_error_then_ping_still_works(self):
        # Regression test for B1: null, then a valid ping, then EOF.
        # The loop must return True after the null (error sent) and
        # after the ping (pong sent), and False only at EOF.
        old_stdin, old_stdout, old_log = sys.stdin, sys.stdout, host.log
        stdin = _FakeStdio(_frame(None) + _frame({"type": "ping", "id": "p1"}))
        stdout = _FakeStdout()
        try:
            sys.stdin, sys.stdout = stdin, stdout
            host.log = lambda line: None
            self.assertTrue(host._process_one_message())
            self.assertTrue(host._process_one_message())
            self.assertFalse(host._process_one_message())
        finally:
            sys.stdin, sys.stdout, host.log = old_stdin, old_stdout, old_log
        frames = _read_frames(stdout.buffer.getvalue())
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0]["type"], "error")
        self.assertIn("JSON object", frames[0]["error"])
        self.assertEqual(frames[1]["type"], "pong")
        self.assertEqual(frames[1]["id"], "p1")


if __name__ == "__main__":
    unittest.main()
