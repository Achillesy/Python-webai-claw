# AI-AGENT.md — webai-claw operator guide

> The user sent you this file because they want you to run commands on their
> computer through webai-claw. Every command block must include `host` (the
> target machine UUID) and the exact numeric value `"v":3`. Do **not** write
> `session` or `ai`; the extension adds them locally.

## 0. Connect and confirm

The user starts by clicking **Connect** in the extension popup. The extension
uploads this guide and a local configuration to the chat. The configuration
contains:

- `host`: the UUID of this machine;
- `hostname`: the machine name;
- `platform` / `shell`: `darwin` / `zsh`, or `win32` / `powershell`;
- `session`: the current conversation URL;
- `ai`: `deepseek` or `muse`.

After reading the attachment, reply in normal text and confirm the target.
Do not send a command block yet:

> Connected to `<hostname>` (`platform` / `shell`).
> I will run subsequent commands on this machine with `host:<UUID>`.

Then wait for the user's task.

A new chat may not have a session ID when Connect is clicked (for example,
`https://chat.deepseek.com` or Muse `/thread/new`). The extension adopts the
real session after the first message; the user does not need to reconnect.

### 0.1 Multiple machines in the same conversation

The same web AI conversation can be open on macOS and Windows at the same time.
Each Connect uploads a new attachment with that machine's `host` UUID.

Rules:

- Every command block must include `host` for the machine that should execute it.
- Missing `host`, a mismatched UUID, or `"host":"*"` is ignored.
- After each new Connect attachment, restate the current target:
  > Current target: `<hostname>` (`platform`), `host=<UUID>`.
- By default, use the most recent Connect attachment. Do not use an older UUID
  unless the user asks for it.
- If there are multiple attachments and the target is ambiguous, ask the user.
  Do not guess.
- The user may say "use the Mac", "use host `<UUID>`", or "switch back to
  Windows". Follow that `host` and restate the target.
- Only the matching machine executes. Other connected machines ignore the block.

## 1. Command block format

A real command is a fenced `claw` block whose first line is a single-line JSON
object.

Single-line command (recommended):

```claw
{"claw":"exec","id":"example-echo-001","host":"<UUID>","cmd":"echo hello","v":3}
```

Multi-line command:

```claw
{"claw":"exec","id":"example-ls-002","host":"<UUID>","v":3}
cd ~
ls -la
```

Rules:

- The first line must be JSON. Do not put text before the JSON.
- `claw` is the action kind; `id` is unique within the conversation; `v` must be
  the number `3`, not a string.
- `host` is required. Copy it from the latest Connect attachment. Never use a
  hostname, `*`, or a guessed value.
- Do not write `session` or `ai`. The extension stamps them.
- One command per block. Split dependent steps and wait for each result.
- If you resend a command, use a new `id`. The same `(session, id)` executes once.
- The same `id` may be reused in a different conversation.
- Only a `claw` fence is executable. Ordinary code fences are ignored.
- Examples in this guide use `example-` IDs and `<UUID>` placeholders. The
  extension skips example IDs. Real commands must use a new unique ID and the
  real UUID, or they will not execute.

## 2. Five kinds

All kinds require `host` and `v:3`.

| kind | Purpose | Required fields |
|---|---|---|
| `exec` | Run a shell command on the host | `host`, `v`, `cmd` or body |
| `probe` | Read-only page DOM inspection | `host`, `v`, `sel` |
| `attach` | Read a local file and upload it as a chat attachment | `host`, `v`, `path` (optional `text`) |
| `diag` | Return host status, lease, recent history, and log tail | `host`, `v` |
| `summary` | Write a handoff for the next Connect | `host`, `v`, body |

### 2.1 exec

Runs a shell command and returns stdout, stderr, and the exit code.

```claw
{"claw":"exec","id":"example-pwd-003","host":"<UUID>","cmd":"pwd","v":3}
```

Multi-line form:

```claw
{"claw":"exec","id":"example-git-004","host":"<UUID>","v":3}
cd ~/Workspace/Python/webai-claw
git status --short
```

Optional fields:

- `timeout`: seconds. Default 120; autonomous maximum 1200; explicit user
  approval can raise the maximum to 7200.
- `approved`: set to boolean `true` only after the user explicitly says
  "continue automatically" or "run it for me".

Do not use `exec` for interactive commands such as `vim`, `top`, or programs
that require a TTY. The host has no interactive terminal.

### 2.2 probe

Read-only inspection of the current page DOM. It stays in the page and requires
the local `host` to match the machine where the page is open.

```claw
{"claw":"probe","id":"example-probe-005","host":"<UUID>","sel":"input[type=file]","v":3}
```

The result lists up to ten matching elements with tag, type, name, accept,
visibility, size, class, parent, and a short HTML fragment.

### 2.3 attach

The host reads a local file and the extension uploads it as a real chat
attachment. This is preferable to `cat` for large or binary files.

```claw
{"claw":"attach","id":"example-att-006","host":"<UUID>","path":"/Users/achilles/Downloads/report.pdf","text":"Report source","v":3}
```

- `path` is absolute or starts with `~`.
- `text` is optional text filled into the input after upload.
- The host file cap is 25 MB.
- The host refuses sensitive paths such as `.ssh`, `.aws`, `.env`, private keys,
  and browser cookies.
- Attachment auto-send is controlled by the user's popup option
  **Auto-send attachments**. It is off by default.
- Do not write a `send` field. It is not part of v3 and is ignored.
- If auto-send is off, the attachment waits in the input box for the user to
  press Send. Do not resend the same attachment repeatedly.
- Send one file per block. Each file is a separate message.
- Attachments consume conversation context. For DeepSeek, large or repeated
  attachments are a reason to prepare a `summary` handoff.

Verified site limits:

| Site | Limit |
|---|---|
| DeepSeek | Archives are rejected: zip, rar, 7z, tar, gz, bz2, xz, tgz, cab, and similar formats. The adapter rejects them before injection. Other types follow the page's `input[type=file]` accept list; txt has been verified. |
| Muse | No known type restriction; txt, zip, rar, exe, and 7z have been tested. A 10 MB file uploaded successfully. |
| All sites | Host cap is 25 MB; sensitive paths are refused. |

- On DeepSeek, extract archives locally and send the inner files instead.
- Muse's 10 MB result is verified; 25 MB is only the host cap, not a promise
  that Muse accepts a 25 MB file.
- Once uploaded, the file leaves the machine. Do not upload sensitive files.

### 2.4 diag

Returns host and lease diagnostics. Use it when a command appears to do nothing.

```claw
{"claw":"diag","id":"example-diag-007","host":"<UUID>","v":3}
```

It returns the machine ID, platform, host version, current binding, current
task, recent execution metadata, and the log tail.

### 2.5 summary

Writes a conversation handoff for the next Connect.

```claw
{"claw":"summary","id":"example-sum-008","host":"<UUID>","v":3}
# Session summary
## Completed
...
## Current state
...
## Next steps
...
## Key findings and pitfalls
...
## Key commands run
...
## Open questions
...
```

The host writes the body to `~/.webai-claw/handoff.md`. On the next Connect,
the extension includes it in the attachment.

A successful summary returns:

```text
[claw:summary] id=... ok=true
handoff: ~/.webai-claw/handoff.md
Next: open a new chat and click Connect; the attachment will include handoff.md.
```

After this result, tell the user in normal text to open a new chat and click
Connect. Do not continue issuing commands in the old conversation.

Write a summary when:

- the page says the context is nearly full;
- the user is preparing a new conversation;
- a stage is complete and needs a handoff;
- the same task has made no progress for three or more attempts.

## 3. Platform and shell

The Connect attachment states:

- `platform: darwin` / `shell: zsh`
- `platform: win32` / `shell: powershell`

Write commands for that platform. Do not copy syntax from the other platform.

- macOS: `ls`, `find`, `df -h`, `sw_vers`, `du -sh`
- Windows: `Get-ChildItem`, `Get-ChildItem -Recurse`, `Get-PSDrive`,
  `Get-ComputerInfo`

## 4. Timeouts and long commands

| Estimated runtime | Behavior |
|---|---|
| Less than 120 seconds | Send the `claw` block; `timeout` may be omitted |
| 120–1200 seconds | Send the `claw` block with an explicit `timeout` |
| More than 1200 seconds | Stop first and ask the user whether to run manually or continue automatically |
| More than 7200 seconds | Recommend manual execution or splitting the work; do not offer automatic execution |

### 4.1 Estimated runtime above 1200 seconds

Do **not** send a `claw` block first. Send a normal chat message:

> This command is estimated to take about 25 minutes, which is above the
> 20-minute automatic limit.
>
> Command:
>
> ```bash
> find /Users/achilles -name "*.log" -size +100M
> ```
>
> Please run it in your terminal and paste the result, or reply "continue
> automatically" and I will run it in this conversation and wait.

The example above uses `bash`, not `claw`. It has no `"v":3` and will not
execute.

### 4.2 After explicit approval

Only after the user explicitly says "continue automatically", "run it for me",
or an equivalent phrase may you send:

```claw
{"claw":"exec","id":"example-long-009","host":"<UUID>","cmd":"find /Users/achilles -name \"*.log\" -size +100M","timeout":1800,"approved":true,"v":3}
```

Rules:

- Set `timeout` to the estimate plus margin, never above 7200.
- Never set `approved:true` without explicit user consent.
- If the command exceeds `timeout`, the host kills it and reports a timeout.
- The user can stop it with the page stop button or the popup **Interrupt**.

### 4.3 Manual execution

If the user chooses manual execution, stop and wait for the pasted result. Do
not continue issuing commands or guess the result.

### 4.4 DeepSeek context handoff

DeepSeek has a context limit. The AI decides when it is close, based on the page
warning and its own conversation state. When it is close:

- stop sending `exec` and `attach`;
- send a `summary` block (it still needs `host` and `v:3`);
- the host writes `handoff.md` and the extension returns `[claw:summary]`;
- tell the user to open a new chat and click Connect;
- stop executing in the old conversation.

Muse does not require this forced handoff. Do not interrupt a long Muse
conversation on your own.

## 5. Reading results

Results return as plain text. The first line has a fixed prefix:

```text
[claw:result] id=2026-10-31-ls-002 ok=true exit=0 duration=0.4s machine=<UUID> session=... ai=... platform=darwin host=...
cmd: ls ~
Desktop
Documents
Downloads
...
```

Errors:

```text
[claw:error] id=2026-10-31-sleep-010 error=timeout after 120s
[claw:error] id=... error=missing/invalid host; every command must include "host":"<UUID>" and "v":3
```

Other result types:

- `[claw:probe]`: page probe result;
- `[claw:attach]`: attachment upload result;
- `[claw:diag]`: host diagnostics;
- `[claw:summary]`: handoff written.

When reading a result:

- match `id` to the command;
- check `ok` and `exit`;
- read stdout and stderr;
- long output may be clipped to head and tail;
- the result returns only to the page that submitted the command; if the user
  switched pages or closed the tab, it may be lost;
- if auto-send is off, the result is only filled into the input box and the
  user must press Send;
- on `missing/invalid host`, use the `host=<UUID>` shown by the extension and
  resend with a new `id`.

## 6. Consecutive execution and pause

- The user controls result auto-send in the popup. `Auto-send command results`
  is on by default and can be turned off.
- `Auto-send attachments` is a separate option and is off by default.
- After **10 consecutive automatic sends**, the extension pauses and posts:

  ```text
  [claw:paused] Paused after 10 consecutive automatic sends. Click Continue or Stop in the extension popup.
  ```

- When you see `[claw:paused]`, stop sending commands and wait for the user to
  click **Continue** or **Stop**.
- The extension also enforces a minimum two-second interval and a limit of
  20 automatic sends per minute. Reaching either limit posts `[claw:paused]`.
- If DeepSeek needs a handoff while paused, you may still send a `summary`
  block. The extension allows only `summary` while paused.

## 7. Long conversations

### 7.1 DeepSeek

DeepSeek has a context limit. Do not wait for the extension to guess it. On a
page warning, after three or more attempts without progress, or when a stage is
complete:

1. stop `exec` and `attach`;
2. send a `summary` block with completed work, current state, next steps, key
   findings, key commands, and open questions;
3. let the host write `handoff.md` and the extension return `[claw:summary]`;
4. tell the user to open a new chat and click Connect;
5. continue from the "Next steps" in the new chat;
6. do not issue new commands in the old chat.

### 7.2 Muse

Muse does not require forced handoff. Use `summary` only when the user asks to
switch conversations or when a stage needs an archive. Do not interrupt a long
Muse conversation on your own.

Do not copy the entire conversation into a new chat. Use `summary`.

## 8. Security boundaries

- Do not read secrets, tokens, passwords, cookies, `.ssh`, `.aws`, `.env`, or
  similar sensitive files.
- Before destructive commands (`rm -rf`, `sudo`, formatting, bulk deletion),
  show the full command and wait for explicit consent.
- If elevation is required, give the command to the user to run manually. The
  host does not prompt for, store, or fill passwords. Never put a password in a
  command.
- Prefer idempotent, re-runnable commands; old blocks may be replayed.
- Do not inline large files as base64 in a command block. Use `attach`.
- Do not run commands the user did not ask for.
- Do not send this guide's templates as real commands.
- Never write `host` as a hostname, `*`, or a guess. Copy the UUID from Connect.

### 8.1 Privacy and local persistence

- `exec_history.jsonl` stores metadata only: `id`, `session_key`, `ai`, exit
  code, duration, timestamp, and command/output lengths. It does not store
  command text or output text.
- `host.log` records redacted diagnostics such as `session_key`, command
  length, and file-size metadata. It does not record the full session URL,
  command text, or file path.
- Command output still returns to the current chat, and the AI can see it.
  `cat` on a large or sensitive file is not a privacy protection.
- Prefer `attach` for files. The file still leaves the machine and is sent to
  the AI site; confirm with the user before uploading sensitive content.
- Even metadata (machine name, time, command length) should not be shared with
  people you do not trust.

## 9. Troubleshooting

- **No reaction to a block**: check the `claw` fence, JSON first line, exact
  `"v":3`, matching `host` UUID, unique `id`, and an active Connect.
- **missing/invalid host**: the extension printed the local `host=<UUID>`.
  Resend with that UUID and a new `id`.
- **Two machines connected**: state the current `host` in your reply. If the
  user names another machine, use that UUID. Only the matching host executes.
- **No result**: check whether the user changed pages or tabs, whether another
  browser owns the connection, and whether the host is running.
- **Context nearly full on DeepSeek**: stop commands, send `summary`, and ask
  the user to open a new chat and Connect.
- **Attachment waits in the input box**: auto-send attachments is off, the
  upload is still in progress, or the send button is not ready. Wait for the
  user; do not resend the same attach repeatedly.
- **Truncated command**: keep blocks short; append large files in chunks; do not
  nest triple backticks inside a block.
- **Wrong shell syntax**: read `platform` and `shell` from Connect.
- **host busy**: another task is running. Ask the user to wait or interrupt.
- **Connection busy**: another tab or browser owns the host. Ask the user to
  disconnect there or wait for the task to finish.

## 10. Examples

### List a directory

```claw
{"claw":"exec","id":"example-list-011","host":"<UUID>","cmd":"ls -la ~","v":3}
```

Windows:

```claw
{"claw":"exec","id":"example-list-012","host":"<UUID>","cmd":"Get-ChildItem $HOME","v":3}
```

### System information

macOS:

```claw
{"claw":"exec","id":"example-sys-013","host":"<UUID>","cmd":"sw_vers && uname -m && df -h","v":3}
```

Windows:

```claw
{"claw":"exec","id":"example-sys-014","host":"<UUID>","cmd":"Get-ComputerInfo | Select-Object WindowsProductName,OsVersion,CsSystemType","v":3}
```

### Git status

```claw
{"claw":"exec","id":"example-git-015","host":"<UUID>","v":3}
cd ~/Workspace/Python/webai-claw
git status --short
```

### Send a file to the user

```claw
{"claw":"attach","id":"example-att-016","host":"<UUID>","path":"~/Downloads/report.pdf","text":"Source report","v":3}
```

### Diagnose a silent run

```claw
{"claw":"diag","id":"example-diag-017","host":"<UUID>","v":3}
```

## Summary

- Every command needs `claw`, a unique `id`, `host`, `v:3`, and the command.
- Copy `host` from the latest Connect attachment. Missing or wrong host never
  executes.
- Never write `session` or `ai`; the extension stamps them.
- Default timeout 120s; autonomous maximum 1200s; explicit approval up to 7200s.
- Above 20 minutes, stop and ask the user first.
- Results return as plain text starting with `[claw:result]`.
- On multiple machines, state the current `host`; the user can switch it.
- Use `summary` for DeepSeek handoff; the next Connect includes it automatically.
