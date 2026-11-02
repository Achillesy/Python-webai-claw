# Changelog

All notable changes to webai-claw. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.2.1] - 2026-11-02

### Added

- `write_file` protocol kind for complete local file creation or replacement.
- Atomic same-directory temporary writes, optional `expected_sha256`
  validation, backups by default, and a 512 KB raw payload cap.
- Host protection against sensitive paths, symlinks, directories, and writes
  without explicit `overwrite:true`.
- Extension/background routing and result reporting for `write_file`.
- AI-AGENT guidance to prefer `write_file` over shell append/replace loops for
  complete file changes.
- Extension and host bumped to 1.2.1.

## [1.2.0] - 2026-11-02

### Added

- Host-generated metadata-only skill index in the Connect bundle.
- Built-in `AI-MACOS.md` and `AI-WIN.md` presets with frontmatter.
- `custom/` skill directory with an installer-created README; the installer
  never overwrites custom files.
- Skill index in the Connect attachment, or in the Connect note when no
  attachment is needed.
- AI-AGENT now prefers the index, loads full skill text on demand, and supports
  custom precedence over presets.
- Extension and host bumped to 1.2.0.

## [1.1.8] - 2026-11-02

### Added

- `~/webai-claw-skills/` is now documented and used as a user-extensible skill
  library. `AI-AGENT.md` explains dynamic discovery, frontmatter, loading with
  `exec`, and security rules.
- `AI-BLENDER.md` is loadable as a skill; users no longer need to upload it
  manually.
- Adding a skill only requires a new `.md` file in the skill library; no
  extension change is needed.
- Onboarding and README explain the Blender skill flow.
- Extension and host bumped to 1.1.8.

## [1.1.7] - 2026-11-02

### Changed

- User-facing guides now install to the visible `~/webai-claw-skills/`
  directory instead of the hidden `~/.webai-claw/` directory.
- `AI-AGENT.md` and `AI-BLENDER.md` are installed there; Connect reads the
  visible guide first, with hidden-directory fallbacks for older installs.
- The installer and onboarding now tell users where to find
  `AI-BLENDER.md` for manual upload.
- The uninstaller removes the two installed guide files and only removes the
  guide directory when no user files remain.
- Extension and host bumped to 1.1.7.

## [1.1.6] - 2026-11-02

### Changed

- The macOS installer now explains the TCC permission needed for Desktop,
  Documents, and Downloads, including the correct browser target and the
  required browser restart.
- `AI-AGENT.md` now tells the AI to stop retrying on `Operation not permitted`
  and guide the user through Full Disk Access instead of attempting `sudo`,
  `chmod`, or folder copying.
- Host version bumped to 1.1.6; extension code remains 1.1.5.

## [1.1.5] - 2026-11-02

### Changed

- Removed the fixed 10-send pause and 20-per-minute auto-send limit.
- Removed the `[claw:paused]` chat message, Pause state, and Continue/Stop
  controls. A pause is no longer part of the conversation flow.
- Automatic sends now use a 500 ms minimum interval. The AI operator is
  responsible for loop discipline and must stop when the task is complete.
- Interrupt now aborts the active content chain and kills the current host
  command. Disconnect remains the full stop/release path.

### Versions

- Extension and host bumped to 1.1.5.

## [1.1.4] - 2026-11-02

### Fixed

- DeepSeek Connect now waits for an enabled send control instead of falling
  through to the Enter shortcut, and confirms that the composer was cleared
  before reporting the handshake as sent. This prevents the attachment from
  remaining in the input while the popup reports connected.
- Muse caches `AI-AGENT.md` by host version. The first Connect sends the guide;
  later Connects send only the machine configuration and handoff, because Muse
  retains the protocol in conversation memory. A host upgrade sends it again.
- Muse Connects without a guide or handoff skip the upload entirely and send
  the short connection note directly.

### Versions

- Extension and host bumped to 1.1.4.

## [1.1.3] - 2026-11-01

### Changed

- Popup reduced to a compact status/action panel: Host, State, contextual
  detail, relevant actions, two auto-send preferences, and an collapsed
  Advanced section.
- State text now carries the status color; the badge legend and static
  pause/attachment explanations were removed.
- Continue/Stop appear only while paused. Pause detail distinguishes the
  ten-send limit from the per-minute rate limit via `mh_pause_reason`.
- Machine ID and Test Bridge moved into Advanced. Machine ID is populated from
  host status/connect state and no longer depends on running Test Bridge.
- Connect/Disconnect/Interrupt are shown only when relevant.

### Versions

- Extension and host bumped to 1.1.3.

## [1.1.2] - 2026-11-01

### Fixed

- Restored localized send-button selectors for DeepSeek and Muse as Unicode
  escapes, added a visible-label/text fallback for alternate layouts, and
  replaced offsetParent visibility checks with getClientRects so fixed-position
  composer buttons are detected.
- Connect now retries the handshake send for up to 45 seconds, covering slower
  attachment uploads. This fixes the case where the attachment remained in the
  input box until the previous 25-second retry window expired.

### Versions

- Extension and host bumped to 1.1.2.

## [1.1.1] - 2026-11-01

### Fixed

- Connect is now a forced handshake: the extension always auto-sends the
  `AI-AGENT.md` attachment and connection note, independent of the
  `Auto-send command results` and `Auto-send attachments` preferences. Those
  preferences apply only to command results and AI-requested files.
- The popup shows `connecting (sending handshake)` until the content script
  confirms the handshake was sent. It no longer reports connected while the
  Connect attachment is still waiting in the input box.
- A failed or timed-out handshake releases the binding and returns a clear
  error instead of leaving a false connected state.

### Versions

- Extension and host bumped to 1.1.1.

## [1.1.0] - 2026-11-01

### Changed

- Public code, comments, UI strings, AI guides, and store metadata are
  English-only for the international Chrome Web Store release.
- Removed unused ChatGPT, Gemini, and Google AI Mode adapters. Supported sites
  are DeepSeek and Muse.
- Removed legacy host command aliases, unbound file reads, and unbound command
  execution. Every host operation now requires a live lease and an exact
  binding, session, and AI match.
- Removed the arbitrary 150k-character context warning. DeepSeek handoff is
  driven by the AI through the `summary` block.
- Removed unused page-level adapter hooks and historical/internal documents.
- Added a privacy policy and a current store submission checklist.
- Simplified the store build and listing to the supported feature set.

### Versions

- Extension and host bumped to 1.1.0.

## [1.0.1] - 2026-11-01

### Changed

- Removed the `Connected to <site>` notification. Connect is initiated from the
  foreground popup, so the notification could only appear in a rare tab-switch
  race. Notifications now cover unexpected disconnects and waiting for the
  user's next command.

## [1.0.0] - 2026-11-01

### Changed

- Global badge: blank when not connected, `✓` when connected, and `...` when the
  native host has run a command for 5 seconds.
- Separate `Auto-send command results` (default on) and `Auto-send attachments`
  (default off) options.
- Attachment auto-send is controlled only by the popup.
- System notifications for unexpected disconnects and waiting for user input.
- Notifications show only the site hostname, never the session URL.
