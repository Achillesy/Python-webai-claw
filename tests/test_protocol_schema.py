import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(ROOT, "protocol", "v3.schema.json")


def _resolve_ref(root, ref):
    if not ref.startswith("#/"):
        raise ValueError("only local $ref values are supported: %s" % ref)
    node = root
    for part in ref[2:].split("/"):
        node = node[part.replace("~1", "/").replace("~0", "~")]
    return node


def _matches_type(value, expected):
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate(schema, value, root=None):
    """Small JSON-Schema subset used by the v3 regression test."""
    if root is None:
        root = schema

    if "$ref" in schema:
        return validate(_resolve_ref(root, schema["$ref"]), value, root)

    if "allOf" in schema:
        return all(validate(part, value, root) for part in schema["allOf"])

    if "oneOf" in schema:
        return sum(1 for part in schema["oneOf"] if validate(part, value, root)) == 1

    if "const" in schema and value != schema["const"]:
        return False

    if "enum" in schema and value not in schema["enum"]:
        return False

    if "type" in schema and not _matches_type(value, schema["type"]):
        return False

    if "required" in schema:
        if not isinstance(value, dict):
            return False
        if any(key not in value for key in schema["required"]):
            return False

    if isinstance(value, dict) and "properties" in schema:
        for key, part in schema["properties"].items():
            if key in value and not validate(part, value[key], root):
                return False

    if "pattern" in schema and isinstance(value, str):
        if re.search(schema["pattern"], value) is None:
            return False

    if "minLength" in schema and isinstance(value, str):
        if len(value) < schema["minLength"]:
            return False

    if "maxLength" in schema and isinstance(value, str):
        if len(value) > schema["maxLength"]:
            return False

    if "minimum" in schema and isinstance(value, (int, float)):
        if value < schema["minimum"]:
            return False

    if "maximum" in schema and isinstance(value, (int, float)):
        if value > schema["maximum"]:
            return False

    return True


class ProtocolSchemaTests(unittest.TestCase):
    def setUp(self):
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            self.schema = json.load(f)

    def test_schema_has_expected_definitions(self):
        defs = self.schema["$defs"]
        for name in ("exec", "probe", "attach", "diag", "summary", "writeFile"):
            self.assertIn(name, defs)
        self.assertIn("expected_sha256", defs["writeFile"]["allOf"][1]["properties"])

    def test_valid_command_blocks(self):
        host = "12345678-1234-1234-1234-123456789abc"
        samples = [
            {"claw": "exec", "id": "e1", "host": host, "v": 3, "cmd": "pwd"},
            {"claw": "probe", "id": "p1", "host": host, "v": 3, "sel": "textarea"},
            {"claw": "attach", "id": "a1", "host": host, "v": 3, "path": "/tmp/a.txt"},
            {"claw": "diag", "id": "d1", "host": host, "v": 3},
            {"claw": "summary", "id": "s1", "host": host, "v": 3},
            {
                "claw": "write_file",
                "id": "w1",
                "host": host,
                "v": 3,
                "path": "/tmp/a.txt",
                "content": "hello",
                "overwrite": True,
                "expected_sha256": "a" * 64,
            },
        ]
        for sample in samples:
            self.assertTrue(validate(self.schema, sample), sample)

    def test_unknown_fields_are_tolerated_but_unknown_kinds_are_not(self):
        # Forward compatibility: a newer writer may add a header field an
        # older reader does not know. That must not invalidate the block.
        host = "12345678-1234-1234-1234-123456789abc"
        self.assertTrue(validate(self.schema, {
            "claw": "exec", "id": "e9", "host": host, "v": 3,
            "cmd": "pwd", "future_field": 123,
        }))
        self.assertFalse(validate(self.schema, {
            "claw": "future_kind", "id": "e10", "host": host, "v": 3, "cmd": "pwd",
        }))

    def test_invalid_blocks_are_rejected(self):
        host = "12345678-1234-1234-1234-123456789abc"
        invalid = [
            {"claw": "exec", "id": "e1", "host": host, "v": 2, "cmd": "pwd"},
            {"claw": "exec", "id": "e1", "v": 3, "cmd": "pwd"},
            {"claw": "exec", "id": "e1", "host": "not-a-uuid", "v": 3, "cmd": "pwd"},
            {"claw": "write_file", "id": "w1", "host": host, "v": 3, "path": "/tmp/a"},
            {"claw": "unknown", "id": "u1", "host": host, "v": 3},
        ]
        for sample in invalid:
            self.assertFalse(validate(self.schema, sample), sample)


if __name__ == "__main__":
    unittest.main()
