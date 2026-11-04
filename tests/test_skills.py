"""Tests for host skill discovery, validation, and conflict handling."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "native-host"))

from hostlib.skills import (  # noqa: E402
    check_skill_library,
    parse_skill,
    skill_index,
    skill_index_detailed,
    validate_skill_file,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_CHECK = os.path.join(ROOT, "native-host", "skill_check.py")


def write_skill(directory, filename, frontmatter, body="# Skill\n"):
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write("---\n" + frontmatter + "---\n\n" + body)
    return path


class SkillIndexTests(unittest.TestCase):
    def test_custom_overrides_preset_case_insensitively(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_skill(tmp, "AI-BLENDER.md",
                        "name: Blender\ndescription: Preset blender.\nplatforms: any\nversion: 1\n")
            custom = os.path.join(tmp, "custom")
            write_skill(custom, "my-blender.md",
                        "name: blender\ndescription: My blender.\nplatforms: any\nversion: 2\n")
            index = skill_index(tmp)
            self.assertEqual(len(index), 1)
            self.assertEqual(index[0]["source"], "custom")
            self.assertIn("overrides", index[0])
            self.assertTrue(index[0]["overrides"].endswith("AI-BLENDER.md"))

    def test_platform_filter_and_unknown_platform(self):
        with tempfile.TemporaryDirectory() as tmp:
            # This VM is linux; a windows-only skill must not appear.
            write_skill(tmp, "win.md",
                        "name: winonly\ndescription: Windows only.\nplatforms: windows\n")
            write_skill(tmp, "bad.md",
                        "name: badplat\ndescription: Bad platform.\nplatforms: banana\n")
            self.assertEqual(skill_index(tmp), [])
            report = validate_skill_file(os.path.join(tmp, "bad.md"), tmp)
            self.assertTrue(any("no recognised value" in e for e in report["errors"]))

    def test_index_cap_keeps_overriding_custom(self):
        # 48 presets, one shadowed by a custom skill, plus 5 unrelated
        # customs: 53 distinct names, so the 50-entry cap must drop
        # ordinary customs, never the custom that shadows a preset.
        with tempfile.TemporaryDirectory() as tmp:
            for i in range(48):
                write_skill(tmp, "preset-%02d.md" % i,
                            "name: preset-%02d\ndescription: P\nplatforms: any\n" % i)
            custom = os.path.join(tmp, "custom")
            write_skill(custom, "override.md",
                        "name: preset-47\ndescription: O\nplatforms: any\n")
            for i in range(5):
                write_skill(custom, "extra-%d.md" % i,
                            "name: extra-%d\ndescription: E\nplatforms: any\n" % i)
            index = skill_index(tmp)
            self.assertLessEqual(len(index), 50)
            entry = [s for s in index if s["name"] == "preset-47"]
            self.assertEqual(len(entry), 1)
            self.assertEqual(entry[0]["source"], "custom")

    def test_validate_reports_errors_and_warnings(self):
        with tempfile.TemporaryDirectory() as tmp:
            no_name = write_skill(tmp, "noname.md", "description: Missing name.\n")
            report = validate_skill_file(no_name, tmp)
            self.assertTrue(report["errors"])
            self.assertIsNone(report["meta"])
            bad_version = write_skill(tmp, "badver.md",
                                      "name: badver\ndescription: Bad version.\nversion: someday\n")
            report = validate_skill_file(bad_version, tmp)
            self.assertFalse(report["errors"])
            self.assertTrue(any("version" in w for w in report["warnings"]))
            self.assertIsNotNone(report["meta"])

    def test_check_library_clean_override_has_no_problems(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_skill(tmp, "AI-BLENDER.md",
                        "name: Blender\ndescription: Preset.\nplatforms: any\n")
            write_skill(os.path.join(tmp, "custom"), "my-blender.md",
                        "name: blender\ndescription: Mine.\nplatforms: any\n")
            result = check_skill_library(tmp)
            self.assertEqual(len(result["skills"]), 1)
            self.assertEqual(result["problems"], [])

    def test_check_library_reports_skipped_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_skill(tmp, "good.md", "name: good\ndescription: Good.\nplatforms: any\n")
            write_skill(os.path.join(tmp, "custom"), "broken.md", "description: No name.\n")
            result = check_skill_library(tmp)
            self.assertEqual(len(result["skills"]), 1)
            self.assertTrue(any(p["severity"] == "error" for p in result["problems"]))
            self.assertFalse(any(p["path"].endswith("good.md") for p in result["problems"]))

    def test_index_truncation_reports_excluded_skills_by_count(self):
        # 55 short custom skills: the 50-entry cap drops the last 5 by
        # name order, and the detailed index must name them (N1).
        with tempfile.TemporaryDirectory() as tmp:
            custom = os.path.join(tmp, "custom")
            for i in range(55):
                write_skill(custom, "skill-%02d.md" % i,
                            "name: skill-%02d\ndescription: S\nplatforms: any\n" % i)
            detailed = skill_index_detailed(tmp)
            # The entry cap drops skill-50..54; the byte cap may also
            # drop one more entry, so assert the cap behaviour, not
            # an exact kept count.
            self.assertLessEqual(len(detailed["skills"]), 50)
            self.assertTrue(detailed["index_truncated"])
            self.assertIn("count_limit", detailed["truncation_reason"])
            excluded = {s["name"]: s["reason"] for s in detailed["excluded_skills"]}
            for i in range(50, 55):
                self.assertEqual(excluded["skill-%02d" % i], "count_limit")
            self.assertEqual(
                len(detailed["skills"]) + len(detailed["excluded_skills"]), 55)
            library = check_skill_library(tmp)
            self.assertEqual(library["excluded_skills"], detailed["excluded_skills"])
            self.assertEqual(library["problems"], [])

    def test_index_truncation_reports_excluded_skills_by_bytes(self):
        # Long descriptions push the 8KB byte cap below the entry cap:
        # excluded skills must be reported with reason byte_limit.
        with tempfile.TemporaryDirectory() as tmp:
            custom = os.path.join(tmp, "custom")
            for i in range(40):
                write_skill(custom, "big-%02d.md" % i,
                            "name: big-%02d\ndescription: %s\nplatforms: any\n"
                            % (i, "x" * 160))
            detailed = skill_index_detailed(tmp)
            self.assertLess(len(detailed["skills"]), 40)
            self.assertTrue(detailed["index_truncated"])
            self.assertEqual(detailed["truncation_reason"], "byte_limit")
            self.assertTrue(detailed["excluded_skills"])
            self.assertTrue(all(s["reason"] == "byte_limit" for s in detailed["excluded_skills"]))
            self.assertEqual(
                len(detailed["skills"]) + len(detailed["excluded_skills"]), 40)

    def test_parse_skill_truncates_and_strips_quotes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_skill(tmp, "q.md",
                               'name: quoted\ndescription: "Quoted desc."\n'
                               'triggers: "alpha", beta\nplatforms: any\n')
            meta = parse_skill(path, tmp)
            self.assertEqual(meta["description"], "Quoted desc.")
            self.assertEqual(meta["triggers"], ["alpha", "beta"])


class SkillCheckScriptTests(unittest.TestCase):
    def test_script_library_json_and_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_skill(tmp, "good.md", "name: good\ndescription: Good.\nplatforms: any\n")
            ok = subprocess.run([sys.executable, SKILL_CHECK, "--library", "--json",
                                 "--skills-dir", tmp],
                                capture_output=True, text=True, timeout=30)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
            self.assertEqual(len(json.loads(ok.stdout)["skills"]), 1)
            write_skill(os.path.join(tmp, "custom"), "broken.md", "description: No name.\n")
            bad = subprocess.run([sys.executable, SKILL_CHECK, "--library",
                                  "--skills-dir", tmp],
                                 capture_output=True, text=True, timeout=30)
            self.assertEqual(bad.returncode, 1)
            self.assertIn("problems:", bad.stdout)

    def test_script_library_reports_truncation_without_error_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            custom = os.path.join(tmp, "custom")
            for i in range(55):
                write_skill(custom, "skill-%02d.md" % i,
                            "name: skill-%02d\ndescription: S\nplatforms: any\n" % i)
            run = subprocess.run([sys.executable, SKILL_CHECK, "--library",
                                  "--skills-dir", tmp],
                                 capture_output=True, text=True, timeout=30)
            # Excluded skills are diagnostics, not errors: exit stays 0.
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertIn("excluded from index", run.stdout)
            self.assertIn("skill-54", run.stdout)


if __name__ == "__main__":
    unittest.main()
