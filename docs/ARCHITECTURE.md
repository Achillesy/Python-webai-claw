# webai-claw Architecture

> The system design. Protocol details: [`PROTOCOL.md`](PROTOCOL.md).
> Planned changes: [`ROADMAP.md`](ROADMAP.md). Past decisions: [`DECISIONS.md`](DECISIONS.md).

## 1. What it is

webai-claw lets web AIs run commands on the user's own computer. The user chats
with a web AI (DeepSeek, Claude, …) as usual; when the AI needs to *do*
something, it writes a `claw-exec` code block. A Chrome extension picks the
block up, a local Python host executes it, and the result is written back into
the chat. No API keys — the web AI is the brain, the user's machine is its
hands.

## 2. Components

Three parts, deliberately small:

```
AI chat page
    │  ```claw-exec block
    ▼
extension/                      Chrome MV3
  ├─ adapters/<site>.js         per-site page scraping (findBlocks, fillResult, …)
  ├─ content.js                 block pickup, warmup, dedup, result fill-back
  ├─ background.js              service worker: queue / router / scheduler
  └─ popup.html/js              bridge test, machine UUID display
    │  native messaging (4-byte LE length-prefixed JSON)
    ▼
native-host/host.py             Python (stdlib only)
  ├─ command executor           shell subprocess, timeout, output capture
  ├─ machine identity           ~/.webai-claw/machine.json  (planned: install-time)
  └─ execution history          ~/.webai-claw/exec_history.json  (planned: JSONL)

native-host/install.py          per-machine installer (idempotent)
native-host/uninstall.py        symmetric removal
```

## 3. Data flow

1. AI writes ```` ```claw-exec ```` with a JSON header
   (`{"claw":"exec","id":"…","v":3,"host":"<uuid>","cmd":"…"}`).
2. `content.js` (via the site adapter) spots the block, parses the header,
   checks the `v:3` gate and the block-id dedup set.
3. `background.js` routes it to the native host (planned: one queue per
   normalized source URL, fairly pumped into the serial host).
4. `host.py` runs the command, streams `progress` heartbeats on long runs,
   replies `result` / `error`.
5. `content.js` writes the result back into the chat input as **plain text**
   (never as a new block — results can't self-trigger).

## 4. Adapter registry

One file per site: `extension/adapters/<site>.js`, self-registering on
`window.__webaiClawAdapters[hostname]` with:

- `findBlocks()` — locate candidate code elements
- `blockText(el)` — extract block text (default: `el.innerText`)
- `fillResult(text)` — write a result into the chat input
- `uploadFile({name, mime, bytes})` — optional, for `attach` blocks
- `isActive()` — optional, page-applicability check

Adding a new web AI = new adapter file + one `manifest.json` content-script
entry. Core `content.js` never changes.
Currently wired: `muse.ai`, `chat.deepseek.com`
(unwired adapter files exist for `aimode`, `chatgpt`, `gemini`).

## 5. Identity model

- Identity answers "which machine": a uuid4 in `~/.webai-claw/machine.json`.
- A block's `host` field addresses a machine; omitted = "this machine".
- Planned: generation moves to `install.py` (install-time); `host.py` becomes
  read-only and fails fast when identity is missing — never silently mints one
  at runtime (see [`DECISIONS.md`](DECISIONS.md) §4).
- One home always: `~/.webai-claw/` holds identity, logs, skills, history,
  regardless of where `host.py` is launched from.

## 6. Execution model

- The host executes commands **serially** (one at a time per host process).
- Planned: per-URL queues in the extension instead of the old 5-second
  cross-session busy rejection; `kill` message type terminating the process
  tree; AI-supplied timeout cap; background watchdog recreating a wedged
  native port (see [`ROADMAP.md`](ROADMAP.md)).
- `~/.webai-claw/` is intentionally **shared** between browsers on one
  machine — the bug class is unsafe concurrent state handling, not sharing
  itself. History must be append-only (JSONL); identity creation must be
  atomic-first-writer-wins.

## 7. Trust model

- The extension talks to the host only via native messaging; the host never
  listens on any network port.
- The host manifest allowlists extension IDs (`allowed_origins`).
- A block's `host` must match the machine UUID (strict addressing).
- Execution history gives idempotent dedup: a block id never executes twice.
- Open: command allowlist / dangerous-command confirmation / audit log
  (see [`ROADMAP.md`](ROADMAP.md) — product-level decision, not settled).

## 8. Naming map (v2 → v3)

| webai-hands (v2)      | webai-claw (v3)          |
|-----------------------|--------------------------|
| `com.webai.hands`     | `com.webai.claw`         |
| `~/.webai-hands/`     | `~/.webai-claw/`         |
| ` ```muse-exec `      | ` ```claw-exec `         |
| `{"muse":"exec",…}`   | `{"claw":"exec",…}`      |
| `"v":2`               | `"v":3`                  |
| `__museHandsAdapters` | `__webaiClawAdapters`    |

The v3 fence keeps the two products fully separable: old blocks never trigger
the new extension and vice versa, so both can be installed side by side.
