"""Skill discovery and validation helpers.

These functions are pure/local-file helpers. They do not execute skill content
and do not know about the native-messaging protocol.
"""

import json
import os
import sys

from .constants import (
    CUSTOM_SKILLS_DIR,
    MAX_SKILL_BYTES,
    SKILL_DESC_MAX,
    SKILL_INDEX_MAX,
    SKILL_INDEX_MAX_BYTES,
    SKILLS_DIR,
)


def inside_dir(path, directory):
    try:
        path = os.path.abspath(path)
        directory = os.path.abspath(directory)
        return os.path.commonpath([path, directory]) == directory
    except ValueError:
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


def parse_skill(path):
    """Read only the frontmatter and return bounded metadata."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            first = f.readline()
            if first.strip() != "---":
                return None
            meta = {}
            for _ in range(160):
                line = f.readline()
                if not line:
                    break
                if line.strip() == "---":
                    break
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                key = key.strip().lower()
                value = value.strip().strip('"').strip("'")
                if key in ("name", "description", "triggers", "platforms", "version"):
                    meta[key] = value
    except OSError:
        return None
    name = (meta.get("name") or "").strip()
    desc = (meta.get("description") or "").strip()
    if not name or not desc:
        return None
    triggers = []
    for item in (meta.get("triggers") or "").strip("[]").split(","):
        item = item.strip()
        if item and item not in triggers:
            triggers.append(item)
    platforms = []
    for item in (meta.get("platforms") or "any").strip("[]").split(","):
        item = item.strip().lower()
        if item and item not in platforms:
            platforms.append(item)
    if not platforms:
        platforms = ["any"]
    current = skill_platform()
    if "any" not in platforms and current not in platforms:
        return None
    rel = os.path.relpath(path, SKILLS_DIR).replace(os.sep, "/")
    return {
        "name": name[:80],
        "description": desc[:SKILL_DESC_MAX],
        "triggers": triggers[:8],
        "platforms": platforms[:4],
        "version": (meta.get("version") or "1")[:16],
        "path": "~/webai-claw-skills/" + rel,
        "source": "custom" if rel.startswith("custom/") else "preset",
    }


def skill_index():
    by_name = {}
    for directory, source in (
        (SKILLS_DIR, "preset"),
        (os.path.join(SKILLS_DIR, "custom"), "custom"),
    ):
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
            meta = parse_skill(entry.path)
            if not meta:
                continue
            # The custom directory is scanned second and wins on name conflict.
            by_name[meta["name"]] = meta
            if len(by_name) >= SKILL_INDEX_MAX:
                break
    result = sorted(
        by_name.values(), key=lambda x: (x["source"] != "preset", x["name"].lower())
    )
    # Keep the Connect attachment bounded even if descriptions are large.
    while (
        len(json.dumps(result, ensure_ascii=False).encode("utf-8"))
        > SKILL_INDEX_MAX_BYTES
        and result
    ):
        result.pop()
    return result
