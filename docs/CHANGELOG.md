# Changelog

All notable changes to webai-claw. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.2.6] - 2026-11-07

### Added

- Host build stamp: `scripts/sync_host_build.py` hashes the installed host
  files and maintains a monotonic build number in
  `extension/host-build.json`, decoupled from the store version (which
  stays 1.2.6 across host-only fixes). `install.py` copies the stamp into
  the install directory, the host reports it as `host_build` in every
  response, and the popup/onboarding warn when the installed build is
  older than the extension's bundled one — so a version-unchanged
  reinstall can no longer silently leave a stale host in place. The
  stamp is also checked by `install.py --verify`. A missing stamp reads
  as build 0 (older than any real build). `tests/test_host_build.py`
  fails when the checked-in fingerprint is stale.
- `extension/adapter-check.js`: validates a site adapter's required
  methods at load time; an incomplete adapter disables the content script
  with a named error instead of failing silently later.
- Adapter `isProvisionalSession(url)` hook (implemented for Muse and
  DeepSeek): a new site declares its own new-chat URL pattern, so session
  adoption no longer depends on hardcoded site rules in `session.js`.
- `native-host/skill_check.py`: read-only skill validator for users and
  AIs (`--check <file>`, `--library`, `--json`); exit 1 on any skill error.
- `diag` now reports `skills` and `skill_problems` (additive fields an
  older extension ignores).
- Skill index truncation diagnostics: `skill_index_detailed()` and
  `check_skill_library()` now report `excluded_skills` (name, path,
  `count_limit` / `byte_limit`), `index_truncated`, and
  `truncation_reason`; `skill_check.py --library` prints the excluded
  list, and `diag` reports `skill_excluded` / `index_truncated`.
  Excluded skills are diagnostics, not errors, so the library check
  exit code is unchanged.
- Skill index entries for a custom skill that shadows a preset now record
  the shadowed preset in `overrides`; name conflicts are compared
  case-insensitively.
- `python3 native-host/install.py --verify`: read-only completeness check
  for the installed host, manifests, machine identity, and skill
  directories.
- `docs/ADAPTER-TEMPLATE.md`: skeleton adapter for a new site.
- Installer creates a private virtual environment
  (`~/.webai-claw/.venv`) from the Python that runs it, so the host
  keeps running on that interpreter even if the system Python later
  changes; an existing virtual environment is never replaced on
  reinstall. Creation is best-effort (`--without-pip`, the host is
  stdlib-only): if it fails, the installer warns and continues, and the
  host falls back to the system Python through `host.sh` / `host.bat`.
- Installer enforces a Python 3.9 floor: older interpreters stop with
  install links (a prompt, not a fix). `--verify` stays usable on any
  Python. `README.md` Requirements now says "Python 3.9 or newer".
- "No Python yet?" note in `README.md` and the onboarding page: if the
  terminal says `python3` / `py` is not found, install Python first
  (Windows: Microsoft Store or `winget install Python.Python.3.13`;
  macOS: `xcode-select --install` or python.org), then re-run the
  command.
- Full Chinese docs: `README_zh.md` (install/uninstall one-liners use
  the Gitee mirror) and the Chinese store description
  `store/listing-zh.txt`.
- Sponsor QR codes (`sponsor/wechat.jpg`, `sponsor/alipay.jpg`) and a
  Support section in the READMEs, next to the existing Ko-fi/PayPal
  links.
- `extension/_locales` (en + zh) with `"default_locale": "en"` in the
  manifest, so both stores offer a Chinese listing: the package now
  declares the zh locale instead of shipping English only.

### Changed

- `docs/ARCHITECTURE.md` §4 now states the exact three-part manifest
  checklist for a new site, and that the core does not change for one.
- `docs/PROTOCOL.md` now documents extension/host version compatibility:
  unknown fields are ignored, unknown kinds and non-object messages are
  errors, not crashes.
- `tests/test_install.py` fails if any module under `hostlib/` or `skill/`
  is missing from the installer's file list, and if the installer's and
  uninstaller's guide lists diverge.

### Fixed

- Background service worker no longer throws `ReferenceError:
  normalizeSession is not defined` on every content-script `hello`:
  the 5a2f1af refactor moved `normalizeSession` into `session.js`, but
  `background.js` kept calling the bare name and never imported that
  module, so the page never bound (session stayed empty) and Connect
  could never succeed. `background.js` now loads `session.js` via
  `importScripts` and calls `WebAIClawSession.normalizeSession` at the
  three call sites; `tests/test_background_split.js` now drives the
  `hello` / `session_adopted` / `session_changed` handlers and asserts
  the session is recorded and normalized.
- Popup no longer stuck at "checking…" forever: the efc150c split had
  dropped the background's four scheduler-state declarations
  (`portGen`, `schedQueue`, `hostBusy`, `running`), so the first
  `updateBadge()` call — inside the `get_state` reply path, before
  `sendResponse` — threw `ReferenceError: running is not defined` and
  the popup never rendered. The declarations are restored (as in
  v1.1.8), and the same split had also dropped `browserName()`, which
  broke the Connect handshake; it is restored too.
  `tests/test_background_split.js` now drives `get_state`, `ping_test`,
  `exec`, `connect`, and `disconnect` against a fake native port and
  asserts every step responds; with the declarations removed it fails
  with "get_state never responded", reproducing the reported symptom.
- A non-object native message no longer crashes the host loop; it gets an
  `error` reply and the host keeps listening.
- A JSON `null` frame no longer terminates the host: end-of-input now
  uses a dedicated EOF sentinel, so `null` gets an `error` reply like
  other non-object messages and the host keeps listening; the main
  loop iteration is factored into `_process_one_message()` so this
  behaviour is covered by a framed stdin/stdout test.
- The skill index cap is now enforced after sorting instead of
  mid-scan, so the entry cap and the byte cap are both honoured.
- `skill_check.py --library` no longer fails on a clean install:
  `custom/README.md` is exempt from skill validation, as AI-AGENT.md
  section 2.6.1 and the `write_file` path in `hostlib/files.py` already
  specified. The library check only skipped `AI-AGENT.md`, so the
  installer-created README was reported as a missing-frontmatter error
  and a fresh host exited 1 on its own health check.
- Skill validation no longer reports every skill as a duplicate of
  itself when the library path is not normalized. On Windows the
  default `~/webai-claw-skills` expands to a path mixing `/` and `\`,
  and `os.scandir()` entry paths built from it never equal
  `os.path.abspath()`, so the duplicate scan compared each file with
  itself and warned. Both sides now compare `normcase(abspath(...))`.

### Notes

- Extension and host bumped to 1.2.6; the host build stamp moves to 4
  because `HOST_VERSION` changed in `native-host/hostlib/constants.py`.
  Host-only changes take effect when the user re-runs the installer;
  the extension changes need this store submission before store users
  get them.
- Popup simplification and Test Bridge placement shipped in 1.1.3
  (compact status/action panel; Machine ID and Test Bridge in the
  collapsed Advanced section).
- ChatGPT review follow-ups N2 (adapter `ai`/`name` validation), N3
  (user-visible adapter failure instead of console-only), and N5
  (`--verify` docs overclaiming all-platform manifest checks) remain
  open by decision; N4 is covered by `tests/test_install.py`.

### Versions

- Extension and host bumped to 1.2.6.

## [1.2.5] - 2026-11-04

### Changed

- Moved cross-process locks, metadata-only history/dedup, and file read/write
  operations into `native-host/hostlib/`.
- Moved session normalization/target gating and result formatting into
  `extension/session.js` and `extension/format.js`.
- Added module-specific Node regression tests for session and formatting.
- Updated the installer and architecture documentation for the new modules.
- Extension and host bumped to 1.2.5.

## [1.2.4] - 2026-11-04

### Changed

- Split host constants and skill helpers into `native-host/hostlib/`.
- Added the shared extension parser `extension/protocol.js`; content now uses
  the same v3 kind list and parser as the protocol documentation.
- Added `protocol/v3.schema.json` and stdlib schema regression tests.
- Moved human-facing examples to `docs/AI-AGENT-EXAMPLES.md`; the runtime guide
  remains focused on execution.
- Updated installer file copying for `hostlib/` and documented module layout.
- Extension and host bumped to 1.2.4.

## [1.2.3] - 2026-11-04

### Changed

- `write_file` now requires `expected_sha256` when overwriting an existing
  file. A missing or stale hash rejects the write.
- Large-file errors now tell the AI to write a small local
  generator/transformer script and run it with `exec`, instead of appending in
  chunks.
- Write results now include `old_size`, `new_size`, `old_sha256`, and the new
  `sha256`.
- AI-AGENT now treats `write_file` as a small-file tool and forbids chunked
  append fallbacks for oversized writes.
- No SSH, chunked-write, or large-file patch feature was added.
- Extension and host bumped to 1.2.3.

## [1.2.2] - 2026-11-02

### Added

- AI-assisted custom skill authoring using the existing `write_file` kind.
- Host validation for `~/webai-claw-skills/custom/*.md`: non-empty frontmatter
  `name` and `description`, 32 KB cap, and README exemption.
- Root preset protection: `write_file` cannot overwrite installer-managed
  `AI-AGENT.md`, `AI-BLENDER.md`, `AI-MACOS.md`, or `AI-WIN.md`.
- AI-AGENT guidance to draft, confirm, and save skills under `custom/`.
- Extension and host bumped to 1.2.2.

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
