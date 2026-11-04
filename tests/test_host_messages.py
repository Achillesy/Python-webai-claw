"""Tests for the native-host message boundary (no browser needed)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "native-host"))

import host  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
