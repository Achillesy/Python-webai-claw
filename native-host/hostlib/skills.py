"""Skill discovery and validation helpers.

These functions are pure/local-file helpers. They do not execute skill content
and do not know about the native-messaging protocol.

Discovery rules (see docs/ROADMAP-1.2.md and AI-AGENT.md section 2.6):

- Root ``*.md`` files are installer-managed presets; ``custom/*.md`` files
  are user-managed. A custom skill wins over a preset with the same ``name``,
  compared case-insensitively, and the winning index entry records the
  preset it shadows in ``overrides`` so the AI can see the conflict.
- ``AI-AGENT.md`` is the runtime guide, never a skill.
- Invalid files are skipped by the index, never fatal to other skills. Use
  :func:`validate_skill_file` / :func:`check_skill_library` (or the
  ``skill_check.py`` wrapper) to see *why* a skill is missing instead of
  guessing from a missing index entry.
- ``version`` is advisory metadata, not a compatibility gate: an
  unrecognised version is a warning, never a reason to drop a skill.
"""

import json
import os
import re
import sys

from .constants import (
    CUSTOM_SKILLS_DIR,
    MAX_SKILL_BYTES,
    SKILL_DESC_MAX,
    SKILL_INDEX_MAX,
    SKILL_INDEX_MAX_BYTES,
    SKILLS_DIR,
)

RECOMMENDED_SKILL_BYTES = 8 * 1024
RECOGNIZED_PLATFORMS = ("macos", "windows", "linux", "any")
_VERSION_RE = re.compile(r"^\d+(\.\d+){0,2}$")
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")


def inside_dir(path, directory):
    try:
        path = os.path.abspath(path)
        directory = os.path.abspath(directory)
        return os.path.commonpath([path, directory]) == directory
    except ValueError:
        return False


def _same_path(a, b):
    """Compare two paths after normalizing case and separators.

    os.scandir() builds each entry path from the directory string it was
    given, so a directory like ~/webai-claw-skills (which expanduser
    renders with mixed separators on Windows) yields entry paths that
    never equal os.path.abspath() output. Without normalization the
    duplicate scan sees every skill as a duplicate of itself.
    """
    try:
        return (os.path.normcase(os.path.abspath(a))
                == os.path.normcase(os.path.abspath(b)))
    except (OSError, ValueError):
        return False


def custom_skill_error(data):
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


def is_preset_skill_path(target):
    return (
        os.path.dirname(os.path.abspath(target)) == os.path.abspath(SKILLS_DIR)
        and os.path.basename(target)
        in ("AI-AGENT.md", "AI-BLENDER.md", "AI-MACOS.md", "AI-WIN.md")
    )


def read_text_file(path, limit=512 * 1024):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read(limit)
    except OSError:
        return ""


def skill_platform():
    if sys.platform == "darwin":
        return "macos"
    if sys.platform == "win32":
        return "windows"
    return "linux"


def _split_list(value):
    """Split a frontmatter list value, tolerating ``[a, b]`` and quotes."""
    items = []
    for item in (value or "").strip().strip("[]").split(","):
        item = item.strip().strip('"').strip("'")
        if item and item not in items:
            items.append(item)
    return items


def _read_frontmatter(path):
    """Return (meta, closed) for a skill file, or (None, False) if unreadable.

    ``meta`` holds raw ``name``/``description``/``triggers``/``platforms``/
    ``version`` strings. An unclosed frontmatter block is tolerated by the
    index (as before) but reported as a warning by the validator.
    """
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            first = f.readline()
            if first.strip() != "---":
                return None, False
            meta = {}
            closed = False
            for _ in range(160):
                line = f.readline()
                if not line:
                    break
                if line.strip() == "---":
                    closed = True
                    break
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                key = key.strip().lower()
                value = value.strip().strip('"').strip("'")
                if key in ("name", "description", "triggers", "platforms", "version"):
                    meta[key] = value
    except OSError:
        return None, False
    return meta, closed


def parse_skill(path, skills_dir=SKILLS_DIR):
    """Read only the frontmatter and return bounded metadata, or None.

    Returns None for files that must not appear in the index: no
    frontmatter, no name/description, or a platform list that does not
    cover this machine. Everything else is kept, with truncation applied
    the same way the Connect attachment bounds it.
    """
    meta, _closed = _read_frontmatter(path)
    if meta is None:
        return None
    name = (meta.get("name") or "").strip()
    desc = (meta.get("description") or "").strip()
    if not name or not desc:
        return None
    triggers = _split_list(meta.get("triggers") or "")[:8]
    platforms = [item.lower() for item in _split_list(meta.get("platforms") or "any")][:4]
    if not platforms:
        platforms = ["any"]
    current = skill_platform()
    if "any" not in platforms and current not in platforms:
        return None
    rel = os.path.relpath(path, skills_dir).replace(os.sep, "/")
    return {
        "name": name[:80],
        "description": desc[:SKILL_DESC_MAX],
        "triggers": triggers,
        "platforms": platforms,
        "version": (meta.get("version") or "1")[:16],
        "path": "~/webai-claw-skills/" + rel,
        "source": "custom" if rel.startswith("custom/") else "preset",
    }


def skill_index_detailed(skills_dir=SKILLS_DIR):
    """Build the bounded skill index plus its truncation diagnostics.

    Returns ``{"skills", "excluded_skills", "index_truncated",
    "truncation_reason"}``. ``excluded_skills`` lists every otherwise
    valid, parsed skill that did not make the index, in index-priority
    order, each with ``name``, ``path`` and ``reason`` (``count_limit``
    for the entry cap, ``byte_limit`` for the byte cap). A skill that is
    valid but excluded is *not* an error, so it is not reported as a
    validation problem; it is reported here so the user can see exactly
    what the Connect bundle does not contain, instead of guessing from
    a missing index entry.
    """
    by_key = {}
    preset_by_key = {}
    custom_dir = os.path.join(skills_dir, "custom")
    for directory, source in ((skills_dir, "preset"), (custom_dir, "custom")):
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
            meta = parse_skill(entry.path, skills_dir)
            if not meta:
                continue
            key = meta["name"].lower()
            if source == "preset":
                preset_by_key[key] = meta
            elif key in preset_by_key:
                meta["overrides"] = preset_by_key[key]["path"]
            by_key[key] = meta
    result = sorted(
        by_key.values(),
        key=lambda x: (
            0 if x["source"] == "preset" else 1 if "overrides" in x else 2,
            x["name"].lower(),
        ),
    )
    ordered = result
    kept = ordered[:SKILL_INDEX_MAX]
    count_excluded = ordered[SKILL_INDEX_MAX:]
    # Keep the Connect attachment bounded even if descriptions are large.
    while (
        len(json.dumps(kept, ensure_ascii=False).encode("utf-8"))
        > SKILL_INDEX_MAX_BYTES
        and kept
    ):
        kept.pop()
    kept_paths = {entry["path"] for entry in kept}
    count_excluded_paths = {entry["path"] for entry in count_excluded}
    excluded = []
    for entry in ordered:
        if entry["path"] in kept_paths:
            continue
        reason = "count_limit" if entry["path"] in count_excluded_paths else "byte_limit"
        excluded.append({
            "name": entry["name"],
            "path": entry["path"],
            "reason": reason,
        })
    reasons = sorted({item["reason"] for item in excluded})
    return {
        "skills": kept,
        "excluded_skills": excluded,
        "index_truncated": bool(excluded),
        "truncation_reason": ",".join(reasons) if reasons else None,
    }


def skill_index(skills_dir=SKILLS_DIR):
    """Build the bounded, metadata-only skill index for a Connect bundle.

    This is the ``skills`` part of :func:`skill_index_detailed`; use that
    function when the caller also needs to know which valid skills were
    excluded by the entry or byte cap.
    """
    return skill_index_detailed(skills_dir)["skills"]


def validate_skill_file(path, skills_dir=SKILLS_DIR):
    """Validate one skill file without executing it.

    Returns ``{"path", "name", "errors", "warnings", "meta"}``. Errors are
    the reasons a file would not appear in the index (or would be
    rejected by ``write_file`` for custom skills); warnings are things
    that degrade discovery or future compatibility but do not drop the
    skill. ``meta`` is the :func:`parse_skill` result, or None.
    """
    errors = []
    warnings = []
    name = None
    try:
        if os.path.islink(path):
            errors.append("skill must be a regular file, not a symlink (symlinks are skipped by the index)")
    except OSError:
        pass
    try:
        size = os.path.getsize(path)
    except OSError:
        return {"path": path, "name": None, "errors": ["skill file cannot be read"], "warnings": [], "meta": None}
    if size > MAX_SKILL_BYTES:
        errors.append("skill too large: %d bytes (cap %d)" % (size, MAX_SKILL_BYTES))
    elif size > RECOMMENDED_SKILL_BYTES:
        warnings.append(
            "skill is %d bytes, over the recommended %d bytes; the index stays "
            "metadata-only but a full read may clip" % (size, RECOMMENDED_SKILL_BYTES)
        )
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError):
        errors.append("skill must be UTF-8 text")
        return {"path": path, "name": None, "errors": errors, "warnings": warnings, "meta": None}
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        errors.append("skill needs frontmatter starting with --- with name and description")
        return {"path": path, "name": None, "errors": errors, "warnings": warnings, "meta": None}
    meta, closed = _read_frontmatter(path)
    if meta is None:
        errors.append("skill frontmatter cannot be read")
        return {"path": path, "name": None, "errors": errors, "warnings": warnings, "meta": None}
    if not closed:
        warnings.append("frontmatter is not closed with ---; add the closing marker")
    name = (meta.get("name") or "").strip()
    desc = (meta.get("description") or "").strip()
    if not name:
        errors.append("frontmatter needs a non-empty name")
    if not desc:
        errors.append("frontmatter needs a non-empty description")
    if name:
        if len(name) > 80:
            warnings.append("name is over 80 characters; the index truncates it, which can collide with a similar name")
        if not _NAME_RE.match(name):
            warnings.append(
                "name %r uses characters outside [A-Za-z0-9_-]; keep skill names "
                "to letters, digits, _ and - so the index key is unambiguous" % name
            )
    if len(desc) > SKILL_DESC_MAX:
        warnings.append("description is over %d characters; the index truncates it" % SKILL_DESC_MAX)
    version = (meta.get("version") or "").strip()
    if not version:
        warnings.append("version is missing; treated as 1")
    elif not _VERSION_RE.match(version):
        warnings.append("version %r is not numeric (expected e.g. 1 or 1.2); treated as advisory only" % version)
    if not (meta.get("triggers") or "").strip():
        warnings.append("triggers are missing; matching relies on name and description only")
    platforms_raw = _split_list(meta.get("platforms") or "")
    if meta.get("platforms") and platforms_raw:
        unknown = [p for p in platforms_raw if p.lower() not in RECOGNIZED_PLATFORMS]
        if unknown:
            if all(p.lower() not in RECOGNIZED_PLATFORMS for p in platforms_raw):
                errors.append(
                    "platforms %r contain no recognised value (macos, windows, linux, any); "
                    "the skill will not appear in any index" % platforms_raw
                )
            else:
                warnings.append("unknown platform values ignored by the index: %r" % unknown)
    # Conflict / duplicate visibility, resolved against the library on disk.
    # Cross-source shadowing (custom over preset) is the intended override
    # mechanism, so it is a plain warning here and is recorded in the
    # index entry's ``overrides`` field, not repeated as a library
    # problem. A same-source duplicate is a real ambiguity: the index
    # keeps only one entry and the loser is invisible.
    if name:
        key = name.lower()
        own_source = "custom" if inside_dir(path, os.path.join(skills_dir, "custom")) else "preset"
        for directory, source in ((skills_dir, "preset"), (os.path.join(skills_dir, "custom"), "custom")):
            if not os.path.isdir(directory):
                continue
            try:
                entries = sorted(os.scandir(directory), key=lambda e: e.name.lower())
            except OSError:
                continue
            for entry in entries:
                if _same_path(entry.path, path) or not entry.name.endswith(".md"):
                    continue
                if not entry.is_file(follow_symlinks=False):
                    continue
                other, _ = _read_frontmatter(entry.path)
                if other and (other.get("name") or "").strip().lower() == key:
                    other_source = "custom" if directory.endswith("custom") else "preset"
                    rel = os.path.relpath(entry.path, skills_dir).replace(os.sep, "/")
                    if other_source != own_source:
                        warnings.append(
                            "name %r shadows %s skill ~/webai-claw-skills/%s "
                            "(intended override; the index entry records it in overrides)"
                            % (name, other_source, rel)
                        )
                    else:
                        warnings.append(
                            "duplicate name %r also used by %s skill "
                            "~/webai-claw-skills/%s; the index keeps only one entry "
                            "(later filename wins within one directory)"
                            % (name, other_source, rel)
                        )
    meta_result = parse_skill(path, skills_dir)
    return {"path": path, "name": name, "errors": errors, "warnings": warnings, "meta": meta_result}


def check_skill_library(skills_dir=SKILLS_DIR):
    """Check a whole skill library.

    Returns ``{"skills", "problems", "excluded_skills", "index_truncated",
    "truncation_reason"}``. ``skills`` is :func:`skill_index`;
    ``problems`` lists every file the index skips or degrades, as
    ``{"severity", "path", "name", "problem"}``. ``excluded_skills`` lists
    every otherwise valid skill the index caps dropped (see
    :func:`skill_index_detailed`); excluded skills are not problems, so
    they do not change the error exit code, but they are reported here
    so a library check never silently loses a skill.
    Routine custom-over-preset shadowing is reported in the index entry's
    ``overrides`` field, not duplicated here as a problem.
    """
    problems = []
    custom_dir = os.path.join(skills_dir, "custom")
    for directory in (skills_dir, custom_dir):
        if not os.path.isdir(directory):
            continue
        try:
            entries = sorted(os.scandir(directory), key=lambda e: e.name.lower())
        except OSError:
            continue
        for entry in entries:
            if not entry.name.endswith(".md") or entry.name == "AI-AGENT.md":
                continue
            if entry.name == "README.md" and _same_path(directory, custom_dir):
                # custom/README.md documents the folder; it is not a skill
                # (hostlib/files.py exempts it from write-time validation).
                continue
            if not entry.is_file(follow_symlinks=False):
                problems.append({
                    "severity": "error",
                    "path": entry.path,
                    "name": None,
                    "problem": "not a regular file (symlinks are skipped by the index)",
                })
                continue
            report = validate_skill_file(entry.path, skills_dir)
            for problem in report["errors"]:
                problems.append({
                    "severity": "error",
                    "path": entry.path,
                    "name": report["name"],
                    "problem": problem,
                })
            for problem in report["warnings"]:
                # Surface only warnings that change discovery; routine
                # advice (triggers, version, size) and intended
                # custom-over-preset shadowing stay in the per-file
                # report (shadowing is also in the index overrides
                # field) so the library check stays actionable.
                if problem.startswith(("platforms", "unknown platform", "duplicate name")):
                    problems.append({
                        "severity": "warning",
                        "path": entry.path,
                        "name": report["name"],
                        "problem": problem,
                    })
    detailed = skill_index_detailed(skills_dir)
    return {
        "skills": detailed["skills"],
        "problems": problems[:50],
        "excluded_skills": detailed["excluded_skills"],
        "index_truncated": detailed["index_truncated"],
        "truncation_reason": detailed["truncation_reason"],
    }
