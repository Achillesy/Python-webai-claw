import base64
import hashlib
import importlib.util
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "native-host"))

SPEC = importlib.util.spec_from_file_location(
    "webai_claw_host", os.path.join(ROOT, "native-host", "host.py")
)
host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(host)


class WriteFileTests(unittest.TestCase):
    def setUp(self):
        host._binding_ok = lambda msg: True
        host._target_ok = lambda msg: True
        host.MACHINE_ID = "test-machine"
        host.history_store.HISTORY = {}
        host.history_store.refresh_history = lambda: None
        host.history_store.append_history = lambda entry: None
        host.log = lambda line: None
        self.root = tempfile.mkdtemp(prefix="webai-claw-write-")
        self.path = os.path.join(self.root, "note.txt")

    def read(self):
        with open(self.path, "rb") as f:
            return f.read()

    def call(self, **overrides):
        msg = {
            "id": overrides.pop("id", "write-1"),
            "path": self.path,
            "content": "hello\n",
            "session": "https://example.test/session",
            "ai": "test",
        }
        msg.update(overrides)
        return host.run_write_file(msg)

    def test_create_and_metadata(self):
        result = self.call()
        self.assertTrue(result["ok"])
        self.assertEqual(self.read(), b"hello\n")
        self.assertEqual(result["sha256"], hashlib.sha256(b"hello\n").hexdigest())
        self.assertIsNone(result["old_sha256"])
        self.assertEqual(result["old_size"], 0)

    def test_overwrite_requires_hash(self):
        self.call()
        result = self.call(id="write-2", content="new\n", overwrite=True)
        self.assertIn("expected_sha256", result["error"])
        self.assertEqual(self.read(), b"hello\n")

    def test_overwrite_with_hash_and_backup(self):
        self.call()
        old_sha = hashlib.sha256(b"hello\n").hexdigest()
        result = self.call(
            id="write-3",
            content="new\n",
            overwrite=True,
            expected_sha256=old_sha,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.read(), b"new\n")
        self.assertTrue(os.path.exists(result["backup"]))
        self.assertEqual(result["old_sha256"], old_sha)

    def test_oversize_points_to_local_script(self):
        result = self.call(
            id="write-4",
            path=os.path.join(self.root, "large.txt"),
            content="x" * (host.MAX_WRITE_BYTES + 1),
        )
        self.assertIn("generator/transformer", result["error"])
        self.assertIn("append", result["error"])

    def test_base64_binary(self):
        body = b"\x00binary\xff"
        result = self.call(
            id="write-5",
            content=base64.b64encode(body).decode("ascii"),
            encoding="base64",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.read(), body)


if __name__ == "__main__":
    unittest.main()
