# webai-claw DESIGN

> Rename-upgrade of webai-hands, rebuilt from the ground up.
> Fork source: `Achillesy/Python-webai-hands @ c2b6f08` (see `ORIGIN.md`).
> Protocol: [`PROTOCOL.md`](PROTOCOL.md) (v3).

## 1. Positioning

webai-claw is webai-hands renamed and rebuilt: a Chrome MV3 extension plus a
Python native-messaging host that lets web AIs run commands on the user's own
computer. The user chats with any web AI as usual; the AI writes
`claw-exec` blocks; the extension picks them up and the local host executes
them, writing results back into the chat.

Why a new name instead of a branch: the old product is already on the Chrome
Web Store, and old/new versions overlap awkwardly during development. The v3
fence (`claw-exec`) keeps the two products fully separable — old blocks never
trigger the new extension and vice versa, so both can be installed side by
side.

## 2. Architecture (unchanged layers)

Three parts, same as before:

- `extension/` — page adapters + content script (block pickup) + background
  service worker (queue/router/scheduler) + popup (bridge test).
- `native-host/` — Python host: command executor, machine identity, execution
  history. Installed per machine under `~/.webai-claw/`, registered with
  Chrome as `com.webai.claw`.
- `install.py` / `uninstall.py` — per-machine installer (idempotent).

## 3. Page adapters

One file per site: `extension/adapters/<site>.js`, registered on
`window.__webaiClawAdapters[hostname]` with `findBlocks / blockText /
fillResult / uploadFile / isActive`. Adding a new web AI = new adapter file +
one manifest entry; the core never changes. (Currently wired: `muse.ai`,
`chat.deepseek.com`; `aimode`, `chatgpt`, `gemini` adapters exist unwired.)

## 4. Machine identity (planned)

Moved from host runtime to install time:

- `install.py` generates `~/.webai-claw/machine.json` (uuid4) only if absent;
  reinstalls preserve it. Atomic write (tmp + replace), mode `0o600`.
- `host.py` is read-only: missing/invalid identity → log + exit, never silently
  mint a new UUID at runtime. (This fixes the UUID flapping seen in v2, where
  a swallowed `OSError` on write produced a fresh UUID per host process.)
- One home always: `~/.webai-claw/` for identity, logs, skills, history —
  no legacy paths, no per-launch-location homes.

## 5. Command routing (planned)

One queue per normalized source URL (`origin + path`, query/fragment stripped):

- Same conversation in two tabs = one stream: one queue auto-executes, the
  second tab's submissions are deduped by block id and dropped silently.
- Different URLs queue independently and are fairly pumped into the still
  serial host. The old 5-second cross-session busy rejection is retired in
  favor of queueing.
- Registry v1 lives in the extension (per browser profile). A machine-global
  host-side registry (file lock + heartbeat) is a reserved future upgrade.

## 6. Execution robustness (planned; from the v2 incident log)

- Host-side `kill`: terminating a page-side stop must kill the running
  process **tree** (Windows: Job Object).
- Cap on AI-supplied timeouts (a huge timeout once wedged the single lane
  for ~1 hour).
- Background watchdog: `hostBusy` with no message (not even a `progress`
  heartbeat) for ~60s → force-recreate the native port.
- Popup "reconnect" action: one-click lane reset.
- Execution history as append-only JSONL (no more whole-file rewrites, no
  lost updates under concurrency).

## 7. Security model (open)

v2 runs whatever the AI writes. Options on the table: command allowlist,
second-confirm for dangerous commands, audit log. Product-level decision —
not settled.

## 8. Naming map

| v2 (webai-hands)              | v3 (webai-claw)              |
|-------------------------------|------------------------------|
| `com.webai.hands`             | `com.webai.claw`             |
| `~/.webai-hands/`             | `~/.webai-claw/`             |
| ` ```muse-exec `              | ` ```claw-exec `             |
| `{"muse":"exec",...}`         | `{"claw":"exec",...}`        |
| `"v":2`                       | `"v":3`                      |
| `__museHandsAdapters`         | `__webaiClawAdapters`        |
| extension IDs (2)             | fresh dev ID; store ID later |
