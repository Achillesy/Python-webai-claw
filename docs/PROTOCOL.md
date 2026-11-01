# webai-claw Protocol v3

The AI-visible protocol is a fenced `claw` block. The header is JSON on the
first line, the action key is `claw`, the execution gate is the number `"v":3`,
and every command names its target machine in `host`.

## 1. Page to extension: the command block

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

- The fence language tag must be `claw`.
- The first line must be a JSON object with `claw`, `id`, `host`, and `v`.
- `v` must be the number `3` exactly. Missing or different values are ignored.
- `host` is required and must be the target machine UUID from the latest
  Connect attachment. Missing, `"*"`, or a mismatched UUID is not executed.
- `id` is unique within a conversation. Content and host deduplicate on
  `(session, id)`. The same ID in another conversation is a different command.
- Do not write `session` or `ai`. The extension stamps them.
- The command is the `cmd` field if present; otherwise it is the remaining body.
- One command per block. Split dependent steps and wait for each result.

### Kinds

| kind | Purpose | Required fields |
|---|---|---|
| `exec` | Run a shell command on the host | `host`, `v`, `cmd` or body |
| `probe` | Read-only page DOM probe; stays in the page, still host-gated | `host`, `v`, `sel` |
| `attach` | Host reads a local file; page uploads it as a chat attachment | `host`, `v`, `path` (optional `text`) |
| `diag` | Host, lease, and history diagnostics | `host`, `v` |
| `summary` | Write `~/.webai-claw/handoff.md` for the next Connect | `host`, `v`, body |

Optional `exec` fields:

- `timeout`: seconds. Default 120; autonomous maximum 1200; approved maximum
  7200.
- `approved`: only `true` after the user explicitly says "continue
  automatically" or "run it for me".

The `attach` kind has no `send` field in v3. Whether an attachment auto-sends is
controlled only by the user's popup setting.

## 2. Connect flow

1. The user opens the extension popup and clicks **Connect**.
2. The extension sends
   `{type:"connect", binding_id, session, ai, page_url, page_title}` to the
   native host.
3. The host writes the machine lease `~/.webai-claw/runtime/active.json`.
   Only one page per machine may own the lease.
4. The host replies `{type:"connected", ...}`, or `{type:"busy", owner, ...}`
   when another tab or browser owns the lease.
5. The extension sends `{type:"bound", bound:true, session, ai}` to the page,
   then requests `{type:"bundle"}` from the host.
6. The host returns `AI-AGENT.md` plus `handoff.md`. The extension uploads them
   as `webai-claw-connect.txt` and fills a short note containing `host:<UUID>`.
7. If auto-send is on, the note is sent; otherwise the user sends it.
8. The AI replies in normal text:
   > Connected to `<hostname>` (`<platform>`). I will run subsequent commands
   > on this machine with `host:<UUID>`.
9. Every subsequent `claw` block must include that `host`. If another Connect
   attachment appears in the same conversation, the AI uses the newest one. The
   user may name another UUID to switch machines.

New chats may not have a session ID at Connect time. The extension treats the
placeholder URL as provisional and adopts the first real session for the same
`binding_id`:

- Muse `/thread/new` (or the bare origin) becomes `/thread/<uuid>`;
- DeepSeek bare origin or `/a/chat` becomes `/a/chat/s/<uuid>`.

`binding_id` is a random per-page value, not the URL. Tabs and browsers with the
same URL cannot steal the lease. Session URL and AI type are metadata and are
re-checked on every command and result.

Stale leases (dead host, missing browser, heartbeat older than 30 seconds) are
cleaned on Connect. An orphan child process is terminated first.

## 3. Extension to host: native messages

Messages are JSON over Chrome Native Messaging: 4-byte little-endian
length-prefixed UTF-8.

| To host | Host replies |
|---|---|
| `{type:"ping", id}` | `{type:"pong", machine_id, hostname, platform, shell, host_version, lease}` |
| `{type:"connect", id, binding_id, session, ai, page_url, page_title, browser?, extension_id?}` | `{type:"connected", ...}` / `{type:"busy", owner, state, stale}` |
| `{type:"disconnect", id, binding_id}` | `{type:"result", ok}` |
| `{type:"status", id}` | `{type:"state", machine_id, ..., lease}` |
| `{type:"bundle", id, binding_id, session, ai}` | `{type:"bundle", guide, handoff, ...}` |
| `{type:"exec", id, host, cmd, binding_id, session, ai, timeout?, approved?}` | `{type:"result", ...}` / `{type:"error", ...}` / `{type:"progress", ...}` |
| `{type:"kill", id, binding_id}` | Progress ack, then a terminal result |
| `{type:"cancel", id, binding_id}` | `{type:"result", ok}` for a foreign lease |
| `{type:"summary", id, host, text, binding_id, session, ai}` | `{type:"result", kind:"summary", ...}` |
| `{type:"read_file", id, host, path, binding_id, session, ai}` | `{type:"file_chunk", ...}` chunks / `error` |
| `{type:"diag", id, host, binding_id, session, ai}` | `{type:"result", ...}` |

Exec result fields: `id`, `ok`, `exit_code`, `stdout`, `stderr`, `duration_ms`,
`machine_id`, `session`, `ai`, `hostname`, `platform`, `timeout`, `approved`,
and `killed`.

Binding and context matching is strict. A command, file read, summary, or diag
request with a missing or mismatched `binding_id`, `session`, or `ai` is
rejected. There is no unbound execution path.

## 4. Host to page: results

The extension writes results into the AI input box as plain text. Results are
never wrapped in a `claw` block.

```text
[claw:result] id=... ok=true exit=0 duration=0.4s machine=... session=... ai=... platform=darwin host=...
cmd: ...
stdout...
```

Errors use `[claw:error] id=... error=...`; diagnostics use `[claw:diag] ...`.
Summary uses:

```text
[claw:summary] id=... ok=true
handoff: ~/.webai-claw/handoff.md
Next: open a new chat and click Connect; the attachment will include handoff.md.
```

Routing uses the originating page port and `binding_id`. The content script
re-checks that the page session and AI type still match before filling. Results
are never guessed into another tab.

## 5. Timeouts, auto-send, and pause

- Default timeout: 120 seconds.
- Autonomous maximum: 1200 seconds.
- Explicitly approved maximum: 7200 seconds.
- If the AI estimates more than 1200 seconds, it must stop and ask in normal
  chat first. Only after the user explicitly approves may it resend with
  `"approved":true` and a larger `timeout`.
- `Auto-send command results` is on by default and can be turned off in the
  popup.
- `Auto-send attachments` is off by default. When off, attachments wait in the
  input box for the user to press Send. The popup setting is authoritative.
- After 10 consecutive automatic sends the extension pauses and posts
  `[claw:paused] ...`. The user chooses **Continue** or **Stop** in the popup.
- Automatic sends have a two-second minimum interval and a 20-per-minute limit.
