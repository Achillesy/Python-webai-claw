# webai-claw Architecture

> The system design. Protocol details: [`PROTOCOL.md`](PROTOCOL.md).
> Planned changes: [`ROADMAP.md`](ROADMAP.md). Past decisions: [`DECISIONS.md`](DECISIONS.md).

## 1. What it is

webai-claw lets web AIs run commands on the user's own computer. The user chats
with a web AI (DeepSeek, Muse, …) as usual; when the AI needs to *do*
something, it writes a `claw` code block. A Chrome extension picks the block
up, a local Python host executes it, and the result is written back into the
chat. No API keys — the web AI is the brain, the user's machine is its hands.

## 2. Components

Three parts, deliberately small:

```
AI chat page
    │  ```claw block  (v3, minimal JSON)
    ▼
extension/                      Chrome MV3
  ├─ adapters/<site>.js         per-site scraping (findBlocks, sessionKey, ai, …)
  ├─ content.js                 block pickup, warmup, binding, dedup, fill-back
  ├─ background.js              service worker: lease control / queue / router
  └─ popup.html/js              Connect/Disconnect/Interrupt/Continue/Stop, UUID
    │  native messaging (4-byte LE length-prefixed JSON)
    ▼
native-host/host.py             Python (stdlib only)
  ├─ command executor           shell subprocess, timeout, process-tree kill
  ├─ machine identity           ~/.webai-claw/machine.json (install-time)
  ├─ machine lease              ~/.webai-claw/runtime/active.json
  └─ execution history          ~/.webai-claw/log/exec_history.jsonl

native-host/install.py          per-machine installer (idempotent)
native-host/uninstall.py        symmetric removal
```

## 3. Data flow

1. The AI writes a fenced `claw` block with a JSON header
   (`{"claw":"exec","id":"…","host":"<UUID>","cmd":"…","v":3}`).
   `host` is required and names the target machine. `session` and `ai` are
   not written by the AI.
2. `content.js` (via the site adapter) spots the block, parses the header,
   checks the exact `v:3` gate, the `host` UUID against this machine, and the
   `(session, id)` dedup set. Missing/mismatched `host` is not executed.
3. `background.js` stamps `binding_id`, normalized `session`, and `ai`, then
   forwards the command and its target `host` to the native host.
4. `host.py` validates the target `host`, binding, session, and AI context
   against the lease, runs the command, streams `progress` heartbeats on long
   runs, and replies `result` / `error`.
5. `background.js` routes the result back to the originating page port;
   `content.js` re-checks the session/AI and writes it into the chat input as
   **plain text** (never as a new block — results can't self-trigger).

## 4. Adapter registry

One file per site: `extension/adapters/<site>.js`, self-registering on
`window.__webaiClawAdapters[hostname]` with:

- `findBlocks()` — locate block-level code elements (never inline `<code>`)
- `sessionKey()` — normalized conversation URL (origin + pathname)
- `ai` — `deepseek` / `muse`
- `blockText(el)` — optional block text extraction (default: `el.innerText`)
- `fillResult(text)` — write a result into the chat input
- `clickSend()` — click the site's send button
- `isStopButton(el)` — optional, detect the site's stop/interrupt button
- `uploadFile({name, mime, bytes})` — optional, for `attach` and Connect
- `isActive()` — optional, page-applicability check

Adding a new web AI = new adapter file + one `manifest.json` content-script
entry. Core `content.js` never changes.
Currently wired: `muse.ai`, `chat.deepseek.com`
(unwired adapter files exist for `aimode`, `chatgpt`, `gemini`).

## 5. Identity and binding model

- Identity answers "which machine": a uuid4 in `~/.webai-claw/machine.json`,
  created atomically at install time. `host.py` is read-only and fails fast
  when identity is missing.
- The popup **Connect** writes a machine-global lease
  `~/.webai-claw/runtime/active.json` with the page's random `binding_id`,
  normalized `session`, and `ai`.
- Every AI command carries a target `host` UUID from the latest Connect
  attachment. Only the matching machine executes; other connected machines
  ignore the block.
- New chats may not have a session id at Connect time. Muse
  `/thread/new` (or the bare origin) gains `/thread/<uuid>`, and DeepSeek
  bare origin or `/a/chat` gains `/a/chat/s/<uuid>`; the same `binding_id`
  adopts the real session instead of disconnecting.
- Only the bound page may execute. Other tabs/browsers on the same machine
  (even with the same URL) get `busy` and are told to go to the owner.
- A stale lease (dead host PID, browser gone, heartbeat older than 30s) is
  cleaned on Connect; an orphan child process is terminated first.
- One home always: `~/.webai-claw/` holds identity, lease, logs, history, and
  the handoff summary, regardless of where `host.py` is launched from.

## 6. Execution model

- Each native host process executes one command at a time; the machine lease
  ensures only one host process owns execution.
- `kill` cancels the current task and kills the process tree
  (`killpg` on POSIX, `taskkill /T /F` on Windows).
- Timeouts: default 120s, autonomous max 1200s, explicitly approved max 7200s.
- After 10 consecutive auto-sends the page pauses and asks Continue/Stop.
- `Auto-send command results` defaults on; `Auto-send attachments` defaults off.
  Attachments are sent only when the user enables that popup option. The AI-side
  `send` field is ignored.
- The toolbar badge is global: blank when not connected, `✓` when connected,
  and `...` after a native-host command has run for 5 seconds. Errors are shown
  in the page/popup, not as a red badge.
- OS notifications are limited to disconnected and waiting for the user's
  next command; they show only the site hostname, never the session URL.
- `~/.webai-claw/` is intentionally **shared** between browsers on one machine.
  History is append-only JSONL; identity creation is atomic first-writer-wins;
  lease updates are lock-protected.
- Persistence is privacy-minimized: `exec_history.jsonl` keeps only id,
  session fingerprint, AI type, exit code, duration, timestamp, and
  command/output lengths; `host.log` keeps `session_key`/`cmd_len`, not raw
  session URLs or command text. Command output still returns to the chat.

## 7. Trust model

- The extension talks to the host only via native messaging; the host never
  listens on any network port.
- The host manifest allowlists extension IDs (`allowed_origins`).
- The AI block carries the target machine UUID in `host`; the extension
  stamps the local binding/session/AI. The host rejects missing/mismatched
  `host`, `binding_id`, `session`, or `ai`.
- Execution history gives idempotent dedup per conversation: the same
  `(session, id)` never executes twice, while the same id in another chat
  is independent.
- Open: command allowlist / dangerous-command confirmation / audit log
  (see [`ROADMAP.md`](ROADMAP.md) — product-level decision, not settled).

## 8. Naming map (v2 → v3)

| webai-hands (v2)      | webai-claw (v3)          |
|-----------------------|--------------------------|
| `com.webai.hands`     | `com.webai.claw`         |
| `~/.webai-hands/`     | `~/.webai-claw/`         |
| ` ```muse-exec `      | ` ```claw `              |
| `{"muse":"exec",…}`   | `{"claw":"exec",…}`      |
| `"v":2`               | `"v":3`                  |
| `__museHandsAdapters` | `__webaiClawAdapters`    |

The v3 fence keeps the two products fully separable: old blocks never trigger
the new extension and vice versa, so both can be installed side by side.
