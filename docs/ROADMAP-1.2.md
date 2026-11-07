# webai-claw 1.2 Roadmap: Skill Library

Status: implementation started. The 1.1.8 release is tagged; keep that tag
available for rollback while 1.2 is developed on master.

Target version: `1.2.6`

## 1. Goals

1. Make the extension installable and understandable by a non-technical user.
2. Keep the one-command native-host installation.
3. Make macOS and Windows permission setup explicit and hard to miss.
4. Turn `AI-AGENT.md` into a small, stable runtime guide.
5. Turn `~/webai-claw-skills/` into a visible, user-extensible skill library.
6. Let the AI discover and load a skill on demand, without a manual upload.
7. Let users create or refine skills through the AI, without changing the
   extension for every new skill.

## 2. Non-goals

- No automatic TCC or UAC permission grant.
- No `sudo` or `chmod` workaround for macOS privacy controls.
- No remote skill marketplace or automatic skill download.
- No execution of untrusted skill code.
- No per-skill extension code.
- No change to the 1.1 store submission while 1.1 is under review.

## 3. Responsibility split

```text
AI-AGENT.md
  Runtime protocol, current machine state, interaction rules, skill
  discovery, safety, timeouts, result handling.

webai-claw-skills/
  Domain playbooks and user-authored capabilities.

Connect attachment
  Machine profile + AI-AGENT.md + skill index + handoff.
```

`AI-AGENT.md` must not grow into a collection of application tutorials. Blender,
macOS, Windows, and user workflows belong in skill files.

## 4. Skill directory layout

Keep the visible directory name introduced in 1.1.8:

```text
~/webai-claw-skills/
  AI-AGENT.md          runtime guide, not a skill
  AI-BLENDER.md        built-in Blender skill
  AI-MACOS.md          built-in macOS skill
  AI-WIN.md            built-in Windows skill
  custom/
    README.md          short format guide
    <user-skill>.md
```

- Root preset files are installer-managed and refreshed on upgrade.
- `custom/` is user-managed; the installer must never overwrite it.
- The AI searches both root and `custom/`.
- A custom skill with the same `name` takes precedence over a preset.
- Users who want to change a preset should copy it into `custom/` with a new
  file name and a new `name`.

## 5. Skill format

Every skill starts with frontmatter:

```markdown
---
name: blender
description: Build, animate, or render a Blender scene through the local MCP bridge.
triggers: blender, 3d, model, render, scene
platforms: macos, windows
version: 1
---

# Blender skill
...
```

Fields:

| Field | Required | Purpose |
| --- | --- | --- |
| `name` | yes | Stable skill identifier |
| `description` | yes | Short matching text for the AI |
| `triggers` | recommended | User phrases or keywords |
| `platforms` | recommended | `macos`, `windows`, or `any` |
| `version` | recommended | Skill revision |

Rules:

- Prefer files under 8 KB.
- A skill is guidance, not a command block to execute blindly.
- Every command generated from a skill still needs a fresh `id`, the matching
  `host`, and `"v":3`.
- Normal timeout, approval, privacy, and security rules still apply.
- Invalid frontmatter is ignored and does not block other skills.

## 6. Skill index and loading

### 6.1 Index in the Connect attachment

The host should generate an index at Connect time:

```json
{
  "skills": [
    {
      "name": "blender",
      "description": "Build, animate, or render a Blender scene.",
      "platforms": ["macos", "windows"],
      "path": "~/webai-claw-skills/AI-BLENDER.md",
      "source": "preset"
    }
  ]
}
```

The index contains metadata only, never full skill bodies. It should:

- scan root `*.md` files and `custom/*.md`;
- exclude `AI-AGENT.md`;
- respect `platforms`;
- cap the number of entries and the total index size;
- sort presets before custom, then custom overrides matching names;
- tolerate missing or invalid files.

This removes the need for the AI to run `ls` before every skill match.

### 6.2 Loading

When a request matches a skill:

1. Select the best match from the index.
2. Read the selected file with `exec`:
   - macOS/Linux: `sed -n '1,260p' <path>`
   - Windows PowerShell: `Get-Content -TotalCount 260 <path>`
3. Follow the skill.
4. Do not ask the user to upload the skill file.

If several skills match, ask the user which one to use.

## 7. Preset skills

### 7.1 `AI-BLENDER.md`

Keep the existing Blender MCP bridge guide. It is loaded on demand; manual
upload is optional.

### 7.2 `AI-MACOS.md`

Cover macOS-specific workflows:

- TCC and Full Disk Access guidance;
- Finder, `open`, screenshots, clipboard;
- Homebrew and package installation;
- AppleScript and `osascript`;
- process and window inspection;
- safe handling of protected folders;
- common macOS path differences.

### 7.3 `AI-WIN.md`

Cover Windows-specific workflows:

- PowerShell syntax and paths;
- execution policy and UAC expectations;
- registry, services, startup items;
- installed application discovery;
- screenshots and clipboard;
- process and window inspection;
- safe handling of protected folders.

Preset skills must be platform-scoped. The index should not offer `AI-WIN.md`
on macOS or `AI-MACOS.md` on Windows.

## 8. AI-assisted skill authoring

Target flow:

1. The user completes a workflow with the AI.
2. The user says: "Save this workflow as a skill."
3. The AI drafts a skill with frontmatter and steps.
4. The AI shows the draft and asks for confirmation.
5. The host writes the confirmed file under `custom/`.
6. The next Connect includes it in the skill index.
7. The AI loads it on demand in later sessions.

### 8.1 Write safety

Do not use raw `exec` shell redirection for skill writes. Add a restricted
write path instead:

- write only under `~/webai-claw-skills/custom/`;
- allow only `.md` files;
- reject path traversal and symlinks;
- cap file size;
- write atomically;
- back up an existing file before overwrite;
- require explicit user confirmation for overwrite or delete;
- never store secrets, tokens, passwords, or private keys in a skill.

### 8.2 Protocol decision

Preferred: add a narrow `skill` operation (for example, `write`) in a 1.2
protocol revision. This is a one-time capability, not a change required for
each new skill.

Fallback: provide a fixed local helper that the AI invokes through `exec`.
This avoids a new kind but needs very careful argument handling and is less
auditable.

Decision should be made before implementation. The `skill` operation must not
allow arbitrary filesystem writes.

## 9. Onboarding for non-technical users

The goal is one command, then clear setup.

```text
1. Install the extension.
2. Copy one command from onboarding into the terminal.
3. Follow the detailed permission steps if Desktop, Documents, or Downloads
   are needed.
4. Open the AI chat and click Connect.
5. Ask the first task in natural language.
```

Add:

- one copy button for the install command;
- visible host version and machine UUID;
- clear macOS Full Disk Access steps;
- clear Windows PowerShell/UAC steps;
- a short explanation of the visible skill directory;
- a "next step" checklist after installation.

Do not make the user search hidden folders. Do not make manual skill upload the
default path.

## 10. Migration and compatibility

- Keep `~/webai-claw-skills/` as the public path.
- Existing 1.1 root skills remain readable.
- Add `custom/README.md`; never move or delete unknown user files silently.
- Preset updates must not overwrite a user-modified preset; recommend a custom
  copy with a new name.
- 1.2 must keep the 1.1 Connect, command, result, timeout, and lease behavior.
- A 1.1 extension should safely ignore a newer `skill` kind if introduced.

## 11. Security

- Skills are local instructions, not trusted code.
- The AI must inspect a skill before running any command it suggests.
- No automatic skill download from the internet.
- Skill index parsing must not execute content.
- Skill content may contain prompt-injection attempts; user review is required.
- Skill writes are restricted, confirmed, backed up, and auditable.
- Sensitive data must not be written into skills or logs.

## 12. Testing plan

### Skill discovery

- preset skill appears in the Connect index;
- custom skill appears without an extension change;
- `AI-AGENT.md` is excluded from the skill list;
- invalid frontmatter is skipped;
- platform filtering works;
- custom `name` overrides a preset;
- many skills still produce a bounded index.

### Loading

- Blender request reads `AI-BLENDER.md` without manual upload;
- macOS request reads `AI-MACOS.md`;
- Windows request reads `AI-WIN.md`;
- missing skill produces a clear, non-looping response;
- skill commands still enforce `host`, `v:3`, timeouts, and approvals.

### Authoring

- AI drafts and confirms a custom skill;
- write is limited to `custom/*.md`;
- path traversal and symlinks are rejected;
- overwrite creates a backup;
- secrets are not persisted;
- next Connect sees the new skill.

### Compatibility

- 1.1.8 behavior remains intact;
- existing root skills still load;
- no hidden-directory regression;
- uninstall removes presets but preserves user files.

## 13. Implementation phases

### Phase 1.2.0: skill library core

1. Add `AI-MACOS.md` and `AI-WIN.md` presets.
2. Add `custom/` and its README.
3. Generate the skill index in the host Connect bundle.
4. Pass the index in the extension Connect attachment.
5. Update AI-AGENT to use the index and load skills on demand.
6. Update onboarding, README, protocol, architecture, and tests.

### Phase 1.2.1: AI-assisted authoring

1. Decide between a narrow `skill` operation and a fixed helper.
2. Implement restricted custom skill writes.
3. Add confirmation, backup, size, and path validation.
4. Add tests and documentation.
5. Update the store listing only if user-facing behavior changes materially.

## 14. Acceptance criteria

1. A user can add a `.md` skill and the AI discovers it on the next Connect.
2. Blender works without uploading `AI-BLENDER.md`.
3. macOS and Windows presets load only on their platform.
4. The AI can save a confirmed custom skill and load it later.
5. No new skill requires an extension rebuild.
6. 1.1 store users can upgrade without losing custom files.
7. The default install remains one command.
8. Permission steps are explicit for macOS and Windows.

## 15. Open decisions

1. Keep the plural public path `~/webai-claw-skills/`? Recommended: yes.
2. Put presets in the root and user skills in `custom/`? Recommended: yes.
3. Include a generated skill index in Connect? Recommended: yes.
4. Add a restricted `skill` operation for writes? Recommended: yes, before
   automatic authoring.
5. Should custom skills be allowed to override presets by `name`? Recommended:
   yes, with a visible source marker in the index.
