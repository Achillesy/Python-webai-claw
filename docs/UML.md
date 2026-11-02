# webai-claw interaction diagrams

These diagrams use **Mermaid**. GitHub renders Mermaid blocks directly. They
also work in VS Code (Mermaid extension) and <https://mermaid.live>.

The diagrams describe the intended 1.2 flow. Installation still uses the
one-command native-host installer; the extension remains the browser half.

## 1. Installation

```mermaid
flowchart TD
    A[Chrome Web Store or Edge Add-ons] --> B[Install extension]
    B --> C[Open onboarding]
    C --> D[Copy the one-command installer]
    D --> E[Terminal on macOS or PowerShell on Windows]
    E --> F[install.py]
    F --> G[Host: ~/.webai-claw]
    F --> H[Skills and guides: ~/webai-claw-skills]
    F --> I[Chrome native-messaging manifest]
    F --> J[Edge native-messaging manifest]
    F --> K[Machine UUID created once if absent]
    G --> L{Protected folders needed?}
    L -- Yes --> M[Grant Full Disk Access to Chrome or Edge]
    L -- No --> N[Quit and reopen the browser]
    M --> N
    N --> O[Open Muse or DeepSeek]
    O --> P[Click Connect in the extension popup]
    P --> Q[Connected]
```

## 2. Connection state

```mermaid
stateDiagram-v2
    [*] --> Unbound
    Unbound --> Connecting: Connect clicked
    Connecting --> Connected: handshake uploaded and sent
    Connecting --> Unbound: timeout or failure
    Connected --> Running: exec or attach submitted
    Running --> Connected: result returned
    Running --> Connected: Interrupt
    Connected --> Unbound: Disconnect
    Running --> Unbound: Disconnect
    Connected --> Unbound: session changed outside adoption
    Running --> Unbound: stale lease or page closed
```

`Interrupt` aborts the current chain and kills the running host command, but
keeps the page bound. `Disconnect` releases the machine binding.

## 3. Connect

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant P as Popup
    participant B as Background service worker
    participant C as Content script
    participant H as Native host
    participant F as Local filesystem
    participant A as AI chat page

    U->>P: Click Connect
    P->>B: connect
    B->>C: get active tab and hello state
    C-->>B: binding_id, session, ai
    B->>H: connect(binding_id, session, ai, browser)
    H->>F: acquire machine lease
    alt Lease belongs to another live page
        H-->>B: busy(owner)
        B-->>P: show owner and "go there"
    else Lease available or stale
        H-->>B: connected(host info)
        B->>C: bound = true
        C->>C: snapshot visible blocks so history cannot execute
        B->>H: bundle
        H->>F: read AI-AGENT, handoff, skill index
        H-->>B: bundle
        B->>C: do_connect(config)
        alt Muse guide cached for this host version
            C->>C: build note + skill index, no guide attachment
        else Guide needed
            C->>A: upload webai-claw-connect.txt
            Note over C,A: machine config + AI-AGENT + skill index + handoff
        end
        C->>A: fill connection note
        C->>A: auto-send after 500 ms
        C-->>B: connect_done(ok)
        B-->>P: connected
        A-->>U: host and platform confirmation
    end
```

## 4. Interrupt

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant P as Popup
    participant B as Background service worker
    participant C as Content script
    participant H as Native host
    participant A as AI chat page

    U->>P: Click Interrupt
    P->>B: interrupt
    B->>C: popup_interrupt
    C->>C: abortChain: clear timers, in-flight IDs, mark blocks, gen++
    C->>B: stop(gen)
    B->>B: discard queued commands from the old generation
    B->>H: kill(running id) or cancel(binding)
    H->>H: terminate the child process tree
    H-->>B: killed result
    B->>C: result for old generation
    C->>C: drop stale-generation result
    opt Something was actually aborted
        C->>A: user interrupt notice
    end
    B-->>P: interrupt accepted
```

## 5. Disconnect

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant P as Popup
    participant B as Background service worker
    participant C as Content script
    participant H as Native host
    participant F as Local filesystem

    U->>P: Click Disconnect
    P->>B: disconnect
    B->>H: disconnect(binding_id)
    H->>F: release machine lease and clear owner
    H-->>B: disconnected
    B->>B: clear active binding and queued work
    B->>C: bound = false
    C->>C: clear page binding state
    B-->>P: disconnected
```

## 6. Muse through the extension and native host

Muse can use a thread URL such as `https://muse.ai/thread/<uuid>` or the main
chat at `https://muse.ai`. The main chat has no unique thread ID, so the page
`binding_id` and background `pagePort` provide uniqueness.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant M as Muse chat page
    participant MB as Muse backend
    participant C as Content script
    participant B as Background service worker
    participant H as Native host
    participant F as Local filesystem

    U->>M: Ask for a local task
    MB-->>M: Render a claw v3 block
    C->>C: Detect a stable block and validate host/v3
    C->>B: exec(host, session, ai, binding_id)
    B->>H: exec
    H->>H: validate lease, session, ai, and host UUID
    H->>F: run command
    H-->>B: result
    B->>C: route by pagePort + binding_id
    C->>M: fill result
    C->>M: auto-send after 500 ms
    M-->>MB: send result
    MB-->>M: explain the result
    M-->>U: answer
```

Muse guide behavior:

- The first Connect for a host version uploads `AI-AGENT.md`.
- Later Connects reuse the guide from Muse conversation memory.
- The skill index is still delivered, in the Connect note if no attachment is
  needed.
- A host upgrade changes the host version and causes the guide to be sent again.

## 7. DeepSeek through the extension and native host

DeepSeek may start with a provisional session such as
`https://chat.deepseek.com`, then adopt the real
`https://chat.deepseek.com/a/chat/s/<uuid>` after the first message. The same
binding is retained; the user does not need to reconnect.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant D as DeepSeek chat page
    participant DB as DeepSeek backend
    participant C as Content script
    participant B as Background service worker
    participant H as Native host
    participant F as Local filesystem

    U->>D: Open a new chat and click Connect
    C->>B: hello(provisional session, binding_id)
    B->>H: connect(provisional session, binding_id)
    H->>F: acquire machine lease
    H-->>B: connected
    B->>C: bound = true
    U->>D: Send the first message
    D->>D: URL becomes /a/chat/s/UUID
    C->>C: detect provisional-to-real session adoption
    C->>B: session_adopted(old, new)
    B->>H: connect(same binding, real session)
    H->>F: refresh lease metadata
    H-->>B: connected
    B->>C: do_connect(config)
    C->>D: upload guide + config + skill index
    C->>D: fill and auto-send connection note
    DB-->>D: AI confirms host and platform
    U->>D: Ask for a local task
    DB-->>D: Render a claw v3 block
    C->>B: exec(host, real session, ai, binding_id)
    B->>H: exec
    H->>F: run command
    H-->>B: result
    B->>C: route to originating pagePort + binding_id
    C->>D: fill result and auto-send after 500 ms
    D-->>DB: send result
    DB-->>D: explain the result
```

DeepSeek sends the guide on Connect rather than relying on long-lived memory.
The machine binding is still tied to the page, not to the URL alone.

## 8. File write

```mermaid
sequenceDiagram
    autonumber
    participant A as AI chat page
    participant C as Content script
    participant B as Background service worker
    participant H as Native host
    participant F as Local filesystem

    A-->>C: render write_file block
    C->>C: validate bound page and host UUID
    C->>B: write_file(path, content, overwrite, expected_sha256)
    B->>H: write_file
    H->>F: read old file and verify expected hash
    H->>F: copy backup, write temporary file, fsync
    H->>F: atomic replace target
    H-->>B: result(path, size, sha256, backup)
    B->>C: route result to the originating page
    C->>A: fill result and auto-send after 500 ms
    A-->>A: verify hash and continue
```

`write_file` is not a shell redirect. It uses a same-directory temporary file,
atomic replacement, optional hash validation, and a backup by default.
