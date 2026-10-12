# webai-claw Roadmap

> Planned work, roughly in priority order. Rationale for each item lives in
> [`DECISIONS.md`](DECISIONS.md); incident background in [`OPERATIONS.md`](OPERATIONS.md).

## P0 — correctness

- [ ] **Install-time machine identity.** Move UUID generation from `host.py`
  runtime to `install.py`: generate only if `~/.webai-claw/machine.json` is
  absent (reinstalls preserve it); atomic write (tmp + replace), mode `0o600`.
  `host.py` becomes read-only — log + exit when identity is missing, never
  silently mint one at runtime. (Fixes the UUID flapping seen in v2, where a
  swallowed `OSError` on write produced a fresh UUID per host process.)
- [ ] **Append-only execution history.** `exec_history.json` → JSONL:
  one line per execution, `open(...,"a")`. Readers take last-writer-wins per
  id, trimmed to ~500 entries / 1MB. Eliminates whole-file clobbering and lost
  dedup state under concurrent hosts.

## P1 — routing & robustness

- [ ] **URL-keyed command queues.** Registry key = normalized source URL
  (`origin + path`, strip query/fragment). One auto-executing queue per URL;
  different URLs queue independently and are fairly pumped into the serial
  host; same-URL second-tab submissions are deduped by block id and dropped
  silently. Retires the 5-second cross-session busy rejection.
- [ ] **Host-side kill.** New `{type:"kill", id}` message terminating the
  running command's **process tree** (Windows: Job Object). Page-side stop
  must actually stop the subprocess.
- [ ] **Timeout cap.** Clamp AI-supplied timeouts to a sane maximum (a huge
  AI-set timeout once wedged the single lane for ~1 hour).
- [ ] **Background watchdog.** If `hostBusy` with no message (not even a
  `progress` heartbeat) for ~60s → force-recreate the native port.
- [ ] **Popup "reconnect".** One-click lane reset, no task-manager archaeology.

## P2 — polish

- [ ] **Guide bootstrap.** `install.py` renders `webai-claw-guide.md`
  (`{{INSTALL_DIR}}` → real path) into `~/Documents/`; `uninstall.py`
  removes it. (Inherited pattern from webai-hands `6b0f300`.)
- [ ] **Host version in `pong`.** Lets the extension detect a stale host after
  reinstall and prompt for a browser restart.
- [ ] **Data-driven extension-ID allowlist.** Read IDs from
  `native-host/extension_ids.json` instead of hardcoding; single store entry
  reuses the file's GitHub/Gitee mirror fallback.

## Parked

- **Edge support.** Chromium fallback registry reads make this likely to work
  with an explicit Edge registry entry + Edge store ID; deferred until asked.
- **Guide injection UX.** Popup button or in-page affordance to inject guide
  content into the chat; sub-guide loading modes (per-guide buttons vs
  all-at-once vs AI-requested). Open questions from the v2 design sessions.
- **Machine-global host registry.** File lock + heartbeat under
  `~/.webai-claw/` for cross-profile coordination; reserved future upgrade.

## Open product decisions

- **Security model.** v2 runs whatever the AI writes. Options: command
  allowlist, second-confirm for dangerous commands, audit log. Not settled —
  needs an explicit product call before implementation.
