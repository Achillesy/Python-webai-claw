# Changelog

All notable changes to webai-claw. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
- Muse `/thread/new` → `/thread/<uuid>` session adoption for the same binding.
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
