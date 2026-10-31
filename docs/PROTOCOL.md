# webai-claw Protocol v3

> v3 is a clean break from webai-hands v2: the fence tag is `claw`, the header
> key is `"claw"`, the execution gate is the number `"v":3` exactly, and every
> command must name its target machine in `host`. Old blocks never trigger the
> new extension and vice versa.

## 1. Page → extension: the command block

The AI writes a fenced `claw` code block in its reply. The content script
parses the first line as JSON and forwards it to the native host.

```claw
{"claw":"exec","id":"2026-10-31-ls-001","host":"<UUID>","cmd":"ls ~","v":3}
```

Multi-line form (command body starts on the second line):

```claw
{"claw":"exec","id":"2026-10-31-git-002","host":"<UUID>","v":3}
cd ~/project
git status --short
```

Rules:

- Fence language tag MUST be `claw`.
- First line MUST be a JSON object with `claw`, `id`, `host`, and `v`.
- `v` MUST be the number `3` exactly. Missing or different → ignored.
- **`host` is required** and must be the target machine UUID from the latest
  Connect attachment. Missing, `"*"`, or a mismatched UUID → not executed.
- `id` is unique. The host dedups on it; the same id never runs twice.
- **Do not write `session` or `ai`.** The extension stamps them.
- The command is the `cmd` field if present, else the remaining body text.
- One command per block. Split dependent steps and wait for each result.

### Kinds (`"claw"` field)

| kind | purpose | required fields |
|---|---|---|
| `exec` | run a shell command on the host | `host`, `v`, `cmd` or body |
| `probe` | read-only page DOM probe (page-local, still host-gated) | `host`, `v`, `sel` |
| `attach` | host reads a local file, page uploads it as a chat attachment | `host`, `v`, `path` (optional `text`) |
| `diag` | host/lease/history diagnostics | `host`, `v` |
| `summary` | write `~/.webai-claw/handoff.md` for the next Connect | `host`, `v`, body |

Optional `exec` fields:

- `timeout`: seconds. Default 120; autonomous max 1200; approved max 7200.
- `approved`: only `true` after the user explicitly says “继续自动执行” or
  “你帮我执行”.

## 2. Connect flow (machine binding)

1. The user opens the extension popup and clicks **Connect**.
2. The extension sends `{type:"connect", binding_id, session, ai, page_url,
   page_title}` to its native host.
3. The host writes the machine lease `~/.webai-claw/runtime/active.json`.
   Only one page per machine may own the lease.
4. The host replies `{type:"connected", ...}` (or `{type:"busy", owner, ...}` if
   another tab/browser already owns it).
5. The extension sends `{type:"bound", bound:true, session, ai}` to the page,
   then `{type:"bundle"}` to the host.
6. The host returns `AI-AGENT.md` plus `handoff.md`; the extension uploads them
   as a `webai-claw-connect.txt` attachment and fills a short note containing
   `host: <UUID>`.
7. If auto-send is on, the note is sent; otherwise the user sends it.
8. The AI must reply in normal text with the target confirmation:
   “已连接 <hostname>（<platform>）。后续命令将以 host:<UUID> 在 <platform>
   上执行。” Every subsequent `claw` block must include that `host`.
9. If another Connect attachment appears in the same conversation (e.g. the
   same chat opened on Windows), the AI restates the newest `host`. The user
   may name another UUID to switch back.

Muse new chats start at `/thread/new` (or the bare origin) and get a real
`/thread/<uuid>` after the first message. The extension adopts that real
session for the same `binding_id` instead of disconnecting.

`binding_id` is a random per-page value, not the URL. Tabs and browsers with
the same URL therefore cannot steal the lease. Session URL and AI type are
stored as metadata and re-checked on every command/result.

Stale leases (host process dead, browser gone, heartbeat older than 30s) are
cleaned on Connect; an orphan child process is terminated first.

## 3. Extension → host: native messages

JSON objects over the native-messaging pipe (4-byte little-endian
length-prefixed UTF-8), Chrome MV3 `chrome.runtime.connectNative`.

| → host | host replies |
|---|---|
| `{type:"ping", id}` | `{type:"pong", machine_id, hostname, platform, shell, host_version, lease}` |
| `{type:"connect", id, binding_id, session, ai, page_url, page_title, browser?, extension_id?}` | `{type:"connected", ...}` / `{type:"busy", owner, state, stale}` |
| `{type:"disconnect", id, binding_id}` | `{type:"result", ok}` |
| `{type:"status", id}` | `{type:"state", machine_id, ..., lease}` |
| `{type:"bundle", id, binding_id, session, ai}` | `{type:"bundle", guide, handoff, ...}` |
| `{type:"exec", id, host, cmd, binding_id, session, ai, timeout?, approved?}` | `{type:"result", ...}` / `{type:"error", ...}` / `{type:"progress", ...}` |
| `{type:"kill", id, binding_id}` | progress ack, then terminal result |
| `{type:"cancel", id, binding_id}` | `{type:"result", ok}` (foreign lease) |
| `{type:"summary", id, host, text, binding_id, session, ai}` | `{type:"result", ok}` |
| `{type:"read_file", id, host, path, binding_id, session, ai}` | `{type:"file_chunk", ...}` chunks / `error` |
| `{type:"diag", id, host, binding_id, session, ai}` | `{type:"result", ...}` |

Exec result fields: `id`, `ok`, `exit_code`, `stdout`, `stderr`,
`duration_ms`, `machine_id`, `session`, `ai`, `hostname`, `platform`,
`timeout`, `approved`, `killed`.

Binding/context matching is strict: if a lease exists, a message with a
missing/mismatched `binding_id`, `session`, or `ai` is rejected.

## 4. Host → page: results

The extension writes results back into the AI input box as plain text. Results
are never wrapped in a `claw` block, so they cannot self-trigger.

Format:

```text
[claw:result] id=... ok=true exit=0 duration=0.4s machine=... session=... ai=... platform=darwin host=...
cmd: ...
stdout...
```

Errors use `[claw:error] id=... error=...`; diag uses `[claw:diag] ...`.

Routing uses the originating page port **and** `binding_id`; the content script
re-checks that the page session/AI still match before filling. A result is never
guessed into another tab.

## 5. Timeouts, auto-send, pause

- Default timeout: 120s.
- Autonomous maximum: 1200s.
- Explicitly approved maximum: 7200s.
- If the AI estimates >1200s, it must stop and ask in normal chat first. Only
  after the user says “继续自动执行/你帮我执行” may it resend with
  `"approved":true` and a larger `timeout`.
- Auto-send is on by default and can be turned off in the popup.
- After 10 consecutive automatic sends the extension pauses and posts
  `[claw:paused] ...`; the user chooses **Continue** or **Stop** in the popup.

## 6. Version history

- v2: webai-hands (`muse-exec`, `"muse"`, `"v":2`).
- v3: webai-claw (`claw`, `"claw"`, `"v":3`). Incompatible by design.
