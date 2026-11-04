#!/usr/bin/env python3
"""Check webai-claw skills without changing the extension.

This is a host-side, read-only helper for the self-extension loop in
AI-AGENT.md section 2.6: a user (with a web AI) drafts a skill, runs this
check, fixes what it reports, and only then relies on the next Connect
index. It never executes skill content and never writes a skill file.

Usage (after install, or from a checkout):

    python3 ~/.webai-claw/skill_check.py --library
    python3 ~/.webai-claw/skill_check.py --check ~/webai-claw-skills/custom/my-skill.md
    python3 ~/.webai-claw/skill_check.py --library --json

Exit code: 0 when no skill has an error (warnings are allowed), 1 when any
skill has an error, 2 on a usage error. ``--skills-dir`` exists for tests
and for a relocated library; the default is ~/webai-claw-skills.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hostlib.skills import check_skill_library, validate_skill_file


def _print_report(report, as_json):
    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    if "skills" in report:
        print("skills in index: %d" % len(report["skills"]))
        for skill in report["skills"]:
            line = "- %s (%s)" % (skill["name"], skill["source"])
            if skill.get("overrides"):
                line += " overrides %s" % skill["overrides"]
            if skill.get("version"):
                line += " v%s" % skill["version"]
            print(line)
        if report["problems"]:
            print("problems:")
            for problem in report["problems"]:
                print("- [%s] %s: %s" % (problem["severity"], problem["path"], problem["problem"]))
        else:
            print("problems: none")
        return
    print("file: %s" % report["path"])
    if report["name"]:
        print("name: %s" % report["name"])
    if report["meta"]:
        print("in index: yes (source %s)" % report["meta"]["source"])
    else:
        print("in index: no")
    for error in report["errors"]:
        print("error: %s" % error)
    for warning in report["warnings"]:
        print("warning: %s" % warning)
    if not report["errors"] and not report["warnings"]:
        print("ok")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check webai-claw skill files.")
    parser.add_argument("--check", metavar="PATH", help="validate one skill file")
    parser.add_argument("--library", action="store_true", help="check the whole skill library")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--skills-dir", default=os.path.expanduser("~/webai-claw-skills"),
                        help="skill library directory (default ~/webai-claw-skills)")
    args = parser.parse_args(argv)
    if bool(args.check) == bool(args.library):
        parser.error("exactly one of --check and --library is required")
    if args.check:
        report = validate_skill_file(os.path.expanduser(args.check), args.skills_dir)
        _print_report(report, args.json)
        return 1 if report["errors"] else 0
    report = check_skill_library(args.skills_dir)
    _print_report(report, args.json)
    return 1 if any(p["severity"] == "error" for p in report["problems"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
