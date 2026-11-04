# webai-claw Architecture

> The system design. Protocol details: [`PROTOCOL.md`](PROTOCOL.md).
> Privacy: [`../PRIVACY.md`](../PRIVACY.md).

## 1. What it is

webai-claw lets a web AI run commands on the user's own computer. The user
chats with DeepSeek or Muse as usual. When the AI needs to do something, it
writes a `claw` code block. A Chrome extension picks up the block, a local
Python host executes it, and the result returns to the chat.

There is no developer-operated server. The extension uses Chrome Native
Messaging to reach a local host. The host never listens on a network port.

## 2. Components

```text
AI chat page
    │  claw block (v3, one JSON header line)
    ▼
extension/                      Chrome MV3
  ├─ protocol.js                shared v3 block parser and kind list
  ├─ session.js                 session normalization and target gate
  ├─ format.js                  plain-text result formatting
  ├─ adapter-check.js           adapter interface validation (required methods)
  ├─ adapters/<site>.js         DeepSeek and Muse adapters
  ├─ content.js                 block pickup, binding, dedup, fill-back
  ├─ background.js              service worker: lease control, queue, router
  ├─ background-ui.js           badge and notification helpers
  └─ popup.html/js              Connect, Disconnect, Interrupt

    │  Native Messaging (4-byte little-endian length-prefixed JSON)
    ▼
native-host/host.py             Python standard library only; entry point
  ├─ hostlib/constants.py       paths, limits, and deny lists
  ├─ hostlib/locks.py           cross-process lock helpers
  ├─ hostlib/history.py         metadata-only history and dedup
  ├─ hostlib/files.py           read_file and write_file operations
  ├─ hostlib/skills.py          skill parsing, validation, index, and library check
  ├─ skill_check.py             read-only skill validator for users and AIs
  ├─ command executor           shell subprocess, timeout, process-tree kill
  ├─ machine identity           ~/.webai-claw/machine.json (install time)
  ├─ machine lease              ~/.webai-claw/runtime/active.json
  └─ execution history          ~/.webai-claw/log/exec_history.jsonl

protocol/v3.schema.json         machine-readable command block schema
tests/                          stdlib unittest regression tests

native-host/install.py          idempotent per-machine installer
native-host/uninstall.py        symmetric removal
```

## 3. Data flow

1. The AI writes a fenced `claw` block. The first line is JSON:
   `{"claw":"exec","id":"...","host":"<UUID>","cmd":"...","v":3}`.
   `host` is required. The AI never writes `session` or `ai`.
2. `content.js` parses the header, checks the exact numeric `v:3`, checks the
   target `host` against this machine, and checks the `(session, id)` dedup set.
3. `background.js` stamps `binding_id`, the normalized session, and the AI type,
   then forwards the command to the native host.
4. `host.py` validates the lease owner, target host, binding, session, and AI
   context. It runs the command, emits progress heartbeats for long runs, and
   returns `result` or `error`.
5. `background.js` routes the result to the originating page port. `content.js`
   re-checks the session and AI type and fills the result into the chat input as
   plain text. Results are never executable blocks.

## 4. Adapter interface

One adapter file per supported site. The core (`content.js`) never changes
for a new site; it only calls the interface below, and
`extension/adapter-check.js` validates it at load time. An adapter missing
a required method disables the content script with one console error naming
the missing methods, instead of failing silently later (for example, a
missing `findBlocks` that makes `scan()` return early, or a missing
`uploadFile` that makes `attach` fail at upload time).

Required:

- `findBlocks()`: locate block-level code elements. Never scan inline `<code>`.
- `sessionKey()`: normalized conversation URL (origin + pathname).
- `ai`: `deepseek` or `muse` (or the new site's AI type).
- `fillResult(text)`: write text into the chat input.
- `clickSend()`: click the site send button.
- `uploadFile({name, mime, bytes})`: inject a chat attachment.

Optional:

- `isStopButton(el)`: detect the site stop/interrupt button.
- `isGenerating()`: wait while the AI is still producing output.
- `isUploading()`: wait while an upload is in progress.
- `isInputEmpty()`: report whether the composer is empty (used to verify
  the Connect handshake was actually sent; without it the core assumes the
  composer was cleared).
- `isProvisionalSession(url)`: report whether a session URL has no real
  conversation id yet (for example a new-chat URL). Without it, session
  adoption falls back to the built-in Muse/DeepSeek rules in `session.js`,
  which a new site must not rely on.

Adding a site requires exactly these edits, all in the extension, and no
core change:

1. One new file `extension/adapters/<site>.js` implementing the interface
   above (see `docs/ADAPTER-TEMPLATE.md`; verify its selectors live with a
   `probe` block before writing them).
2. One line in `extension/manifest.json` `content_scripts[].js` (load order:
   `protocol.js`, `session.js`, `format.js`, `adapter-check.js`, adapters,
   `content.js`).
3. One entry in `manifest.json` `content_scripts[].matches` and the same
   entry in `host_permissions`.

Supported sites in this release: `chat.deepseek.com` and `muse.ai`. A new
site is therefore an extension change and needs a store submission; a new
host skill or host helper is not, and takes effect when the user re-runs
the installer.

## 5. Identity and binding

- The machine identity is a UUID created at install time in
  `~/.webai-claw/machine.json`. `host.py` never creates or rotates it at runtime.
- Connect writes a machine-global lease to
  `~/.webai-claw/runtime/active.json` with the page's random `binding_id`, the
  normalized session, and the AI type.
- Every command carries the target machine UUID in `host`. Only the matching
  machine executes.
- A new chat may lack a real session ID at Connect time. Muse `/thread/new`
  becomes `/thread/<uuid>`, and DeepSeek bare origin or `/a/chat` becomes
  `/a/chat/s/<uuid>`. The same binding adopts the real session.
- Muse caches the guide by host version: the first Connect sends `AI-AGENT.md`,
  later Connects send configuration, skill index, and handoff. DeepSeek sends
  the guide on every Connect.
- The host builds a metadata-only skill index from `~/webai-claw-skills/*.md`
  and `~/webai-claw-skills/custom/*.md`; the extension includes it in the
  Connect attachment or note. A custom skill overrides a preset with the
  same `name` (compared case-insensitively) and the winning entry records
  the shadowed preset in `overrides`. Invalid skills are skipped, never
  fatal to the index; `diag` reports them in `skill_problems`, and
  `native-host/skill_check.py --library` explains each one without
  executing skill content.
- Only the bound page may execute. Other tabs or browsers on the same machine
  receive `busy` and are told which page owns the lease.
- A stale lease (dead host, missing browser, heartbeat older than 30 seconds)
  is cleaned on Connect. An orphan child process is terminated first.

## 6. Execution model

- The native host executes one command at a time. The machine lease ensures a
  single owner.
- `kill` cancels the current task and terminates the process tree (`killpg` on
  POSIX, `taskkill /T /F` on Windows).
- Timeouts: 120 seconds default, 1200 seconds autonomous maximum, 7200 seconds
  after explicit user approval.
- Auto-send enforces a 500 ms minimum interval. There is no fixed round count
  or per-minute message limit; the AI operator owns loop discipline. Interrupt
  aborts the active chain and Disconnect releases the binding.
- `Auto-send command results` defaults on. `Auto-send attachments` defaults off.
  The popup setting is authoritative for results and AI-requested files. The
  Connect handshake is always sent automatically; the popup shows a connecting
  state until the handshake note is sent.
- The toolbar badge is global: blank when not connected, `✓` when connected, and
  `...` when a native-host command has run for 5 seconds. Errors are shown in
  the page and popup, not as a badge.
- OS notifications cover unexpected disconnects and waiting for the user's next
  command. They show only the site hostname, never the session URL.
- `~/.webai-claw/` is shared by browsers on one machine. History is append-only
  JSONL; identity creation is atomic first-writer-wins; lease updates are
  lock-protected.
- Persistence is minimized: execution history stores metadata and lengths only;
  the host log stores a session fingerprint and length metadata, not command
  text, output text, or file paths. Output still returns to the chat.

## 7. Trust model

- The host manifest allowlists extension IDs.
- The extension stamps binding, session, and AI. The host rejects missing or
  mismatched `host`, `binding_id`, `session`, or `ai`.
- Dedup is scoped by `(session, id)`: the same command never executes twice in
  one conversation, while the same ID in another conversation is independent.
- The host refuses sensitive paths for file reads and writes. Writes use a
  same-directory temporary file, atomic replacement, optional hash validation,
  and a backup by default.
- The AI and the user are responsible for the commands they request. The
  extension does not maintain a command allowlist.
