# Changelog

All notable changes to webai-claw. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] - 2026-11-01

### Changed
- Badge is now a single global state: blank when not connected, `✓` when
  connected, and `...` when the native host has been running a command for
  5 seconds. Red error badges and the per-tab unsupported state are removed.
- The popup separates `Auto-send command results` (default on) from
  `Auto-send attachments` (default off).
- Attachment auto-send is controlled only by the popup. The AI-side `send`
  field is removed and ignored for compatibility.
- Added OS notifications for: connected to a site, disconnected from a site,
  and waiting for the user's next command. Notifications show only the site
  hostname, never the session URL.

### Fixed
- Successful file reads no longer leave a stale red badge.
- Long-running host commands now show a consistent waiting badge.
- Attachments no longer have two competing auto-send switches.

### Versions
- Extension and host bumped to 1.0.0.

## [0.2.2] - 2026-11-01

### Fixed
- attach auto-send now waits for upload/send-button readiness instead of a
  single 500ms attempt. It respects the auto-send switch, the pause state, and
  counts toward the 10-send pause.
- Connect attachment and pause/stop/warning notices use the same retry path.
- `maybeAutoSend` no longer sends late results after the chain is paused.
- DeepSeek attachment uploads pre-check `input.accept` in addition to the
  existing archive rejection.

### Changed
- Unified auto-send through `sendWithRetry` with per-tag timeouts, 2s minimum
  spacing, a 20/min burst guard, and optional `isGenerating`/`isUploading`
  adapter hooks.
- `summary` is allowed while paused and returns `[claw:summary]` with the
  handoff path plus a new-chat reminder.
- AI-AGENT.md documents DeepSeek-only AI-driven context handoff, Muse's
  no-forced-handoff behavior, and the verified webai-hands attachment limits.

### Versions
- Extension and host bumped to 0.2.2.

## [0.2.1] - 2026-11-01

### Fixed
- Content always opens its background port, even when the machine UUID is
  cached, so the popup recognizes DeepSeek/Muse tabs and Connect is enabled.
- DeepSeek new chats (bare origin or `/a/chat`) adopt the first real
  `/a/chat/s/<uuid>` session for the same binding instead of releasing the lease.
- Command dedup is scoped by `(session, id)` in both content storage and host
  history, so reusing an id in another chat no longer silently skips a command.

### Privacy
- `exec_history.jsonl` stores metadata only: id, session fingerprint, AI type,
  exit code, duration, timestamp, and command/output lengths. Command text and
  output text are no longer persisted; old records are scrubbed on host startup.
- `host.log` records `session_key` and `cmd_len`, not the full session URL or
  command text. Connect/busy/disconnect events are logged for diagnostics.
- `ctx_summary.py` emits metadata-only summaries.
- AI-AGENT.md documents that `exec` output still reaches the chat and that
  `attach` is preferred for sensitive or large files.

### Changed
- Extension and host versions bumped to 0.2.1; the popup shows both versions.

## [0.2.0] - 2026-10-31

### Changed
- Protocol v3 AI-visible block is now a `claw` fence with exact `"v":3`
  and a required target `host` UUID. Missing/mismatched host is not executed;
  `session`/`ai` are stamped by the extension.
- Popup Connect attaches `AI-AGENT.md`, local config, and `handoff.md` to the
  chat; Disconnect/Interrupt/Continue/Stop controls added.
- Machine-global lease with `binding_id`: one bound page per machine, stale and
  orphan cleanup, process-tree kill, foreign cancel.
- Timeouts: 120s default, 1200s autonomous max, 7200s after explicit approval.
- Auto-send defaults on; pause after 10 consecutive automatic sends.
- `AI-GUIDE.md` renamed to `AI-AGENT.md`.

### Added
- Install-time machine identity and append-only JSONL execution history.
- `summary` kind writes `~/.webai-claw/handoff.md` for the next Connect.
- Host `connect`/`disconnect`/`status`/`bundle`/`kill`/`cancel` messages.
- Muse `/thread/new` → `/thread/<uuid>` and DeepSeek new-chat →
  `/a/chat/s/<uuid>` session adoption for the same binding.
- Dedup is scoped by `(session, id)` in both content storage and host history;
  reusing an id in a different chat no longer silently skips the command.

## [0.1.0] - 2026-10-12

Initial scaffold. Hard fork by copy of `Achillesy/Python-webai-hands @ c2b6f08`
with fresh git history (see `docs/ORIGIN.md`).

### Added
- Renamed codebase: `com.webai.claw`, `~/.webai-claw/`, `__webaiClawAdapters`.
- Protocol v3: `"claw"` header key, `"v":3` execution gate
  (`docs/PROTOCOL.md`). The fence spelling was standardized to `claw` in 0.2.0.
  Fully separable from v2 blocks.
- New extension key → dev extension ID `feifgnelfehkjlimiolepkmffgbjcong`;
  single-ID allowlist from day one.
- Docs: `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md`, `OPERATIONS.md`,
  `PROTOCOL.md`, `ORIGIN.md`, `README.md` (en/zh).
- Reference copies of the v2 design handoffs under `docs/ref/`.

### Planned (see `docs/ROADMAP.md`)
- Install-time machine identity, append-only JSONL history.
- URL-keyed command queues, host-side kill, timeout cap, watchdog.
