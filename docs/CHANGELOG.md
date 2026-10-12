# Changelog

All notable changes to webai-claw. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] - 2026-10-12

Initial scaffold. Hard fork by copy of `Achillesy/Python-webai-hands @ c2b6f08`
with fresh git history (see `docs/ORIGIN.md`).

### Added
- Renamed codebase: `com.webai.claw`, `~/.webai-claw/`, `__webaiClawAdapters`.
- Protocol v3: `` `claw-exec `` fence, `"claw"` header key, `"v":3` execution
  gate (`docs/PROTOCOL.md`). Fully separable from v2 blocks.
- New extension key → dev extension ID `feifgnelfehkjlimiolepkmffgbjcong`;
  single-ID allowlist from day one.
- Docs: `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md`, `OPERATIONS.md`,
  `PROTOCOL.md`, `ORIGIN.md`, `README.md` (en/zh).
- Reference copies of the v2 design handoffs under `docs/ref/`.

### Planned (see `docs/ROADMAP.md`)
- Install-time machine identity, append-only JSONL history.
- URL-keyed command queues, host-side kill, timeout cap, watchdog.
