# webai-claw Protocol v3

> v3 is a clean break from webai-hands v2: the fence tag changed
> (`claw-exec`), the header key changed (`"claw"`), and the version gate
> moved to `"v":3`. The two products coexist: old blocks never trigger
> the new extension and vice versa.

## 1. Page → extension: the command block

The AI writes a fenced code block in its reply. The content script picks it up,
parses the first line as JSON, and forwards it.

        ```claw-exec
        {"claw":"exec","id":"a1b2","v":3,"host":"<machine-uuid>","cmd":"echo hello"}
        echo hello   (or any command body)
        ```

Rules:

- Fence language tag MUST be `claw-exec`.
- First line MUST be a JSON object with `claw`, `id`, `v`.
- `"v":3` is the execution gate: blocks without it are ignored. All examples
  in guides/docs deliberately omit `v`, so they can never self-execute.
- `id`: unique per block. The extension dedups on it (same id is never
  executed twice).
- `host`: target machine UUID. Omitted = the machine the block was seen on.
- Command = `cmd` field if present, else the remaining body text.

### Kinds (`"claw"` field)

| kind     | purpose                                              |
|----------|------------------------------------------------------|
| `exec`   | run a shell command on the host                      |
| `probe`  | page probe: `{"claw":"probe","id":"p-1","v":3,"sel":"input[type=file]"}` |
| `attach` | host reads a local file, page uploads it: `{"claw":"attach","id":"a-1","v":3,"path":"/abs/x.pdf","text":"note"}` |

`exec` optional fields: `shell` (default shell override), `timeout` (seconds;
the host caps it), `send` (auto-send the filled result).

## 2. Extension → host: native messages

JSON objects over the native-messaging pipe (4-byte little-endian
length-prefixed UTF-8), Chrome MV3 `chrome.runtime.connectNative`.

| → host              | host replies                              |
|---------------------|-------------------------------------------|
| `{type:"ping"}`     | `{type:"pong", machine_id, host, platform}` |
| `{type:"exec", id, cmd, timeout?}` | `{type:"result", id, ok, output}` / `{type:"error", id, error}` / `{type:"progress", id, elapsed}` (heartbeats on long runs) |
| `{type:"read_file", id, path}` | `{type:"file_chunk", id, ...}` chunks / `{type:"error"}` |
| `{type:"diag", id}` | `{type:"result", id, ...}` (log tail, recent exec ids) |
| `{type:"kill", id}` | **planned** — terminate the running command tree |

Conventions:

- Every reply carries the originating `id`.
- `progress` messages are heartbeats only; the terminal message is always
  `result` or `error`.
- The host never executes anything it wasn't asked for; unknown `type`
  → `{type:"error", error:"unknown message type"}`.

## 3. Host → page: results

The extension writes the result back into the AI's input box as plain text
(never as a new `claw-exec` block, so results can't self-trigger).

## 4. Version history

- v2: webai-hands (`muse-exec`, `"muse"`, `"v":2`).
- v3: webai-claw (`claw-exec`, `"claw"`, `"v":3`). Incompatible by design.
