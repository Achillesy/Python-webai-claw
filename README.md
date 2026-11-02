# webai-claw

Give a web AI hands on your own computer. webai-claw turns a chat request into
a local command, runs it on your machine, and returns the result to the chat.

Supported AI chat sites: **DeepSeek** (`chat.deepseek.com`) and **Muse**
(`muse.ai`).

## What it does

- Run shell commands on macOS or Windows from a web AI chat.
- Return command output to the same conversation.
- Upload local files as real chat attachments when the AI asks.
- Create or replace local files atomically with `write_file`, with backup
  and hash validation.
- Drive local applications such as Blender through their local APIs.
- Discover user-extensible skills from `~/webai-claw-skills/` without changing
  the extension.
- Keep the execution target explicit when the same conversation is open on
  more than one computer.

No API keys and no developer-operated relay server. The extension talks to a
local Python host through Chrome Native Messaging. The host never listens on a
network port.

## Requirements

- Google Chrome (desktop).
- macOS or Windows.
- Python 3 on the machine that will run commands.
- One-time installation of the local host.

The Chrome extension is only the browser half. The local host must be installed
on each machine separately.

### macOS permissions

macOS protects Desktop, Documents, and Downloads with TCC. The host is launched
by the browser, not by Terminal, so when those folders are needed, grant
**Full Disk Access** to Google Chrome or Microsoft Edge. Quit and reopen the
browser after changing the setting.
Terminal permission alone does not apply to the browser-launched host, and
`sudo`/`chmod` cannot bypass TCC.

## Install

### 1. Install the local host

macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Achillesy/Python-webai-claw/master/native-host/install.py | python3
```

Windows PowerShell:

```powershell
py -3 -c "import urllib.request; exec(urllib.request.urlopen('https://raw.githubusercontent.com/Achillesy/Python-webai-claw/master/native-host/install.py').read())"
```

The installer creates `~/.webai-claw/` for the host and runtime files, and
`~/webai-claw-skills/` for user-facing guides. It registers the Native
Messaging host with Chrome. It is idempotent; re-run it to update the host
and guides.

### Extending skills

`~/webai-claw-skills/` is a visible skill library. Root presets include
`AI-BLENDER.md`, `AI-MACOS.md`, and `AI-WIN.md`; user skills belong in
`custom/`. The host generates a metadata-only skill index at Connect time, and
the AI reads the matching skill with `exec` only when needed. No extension
change or manual upload is required.

### 2. Install the extension

Install the Chrome Web Store build when available, or load the unpacked
extension for development:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension/` directory.

### 3. Connect

1. Open a supported AI chat.
2. Click the webai-claw toolbar icon.
3. Click **Connect**.
4. The extension uploads `AI-AGENT.md` and the local configuration into the
   chat.

The AI will confirm the target machine. Every command block must include the
machine UUID and exact `"v":3`.

## Popup options

- **Auto-send command results** (default on): send command output back to the
  chat automatically.
- **Auto-send attachments** (default off): send AI-requested files automatically.
  When off, those files wait in the input box for you to press Send.
- The **Connect** handshake is always sent automatically because it is the
  explicit action that establishes the connection; the two settings above do
  not apply to it.
- Automatic result sends are paced by at least 500 ms. There is no fixed round
  limit; the AI operator is responsible for stopping when the task is done.
- **Interrupt** stops the current command and active chain. **Disconnect** releases the machine binding.
- **Advanced** contains the machine UUID (for multi-machine switching) and **Test Bridge** diagnostics.

The toolbar badge is intentionally minimal:

- no mark: not connected;
- `✓`: connected;
- `...`: the native host has been running a command for 5 seconds.

## Protocol and design

- [Protocol v3](docs/PROTOCOL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Interaction diagrams (Mermaid)](docs/UML.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Privacy](PRIVACY.md)
- [Changelog](docs/CHANGELOG.md)
- [1.2 roadmap](docs/ROADMAP-1.2.md)

The AI operator guide is [AI-AGENT.md](AI-AGENT.md). The installed copies are
in `~/webai-claw-skills/`; Connect attaches `AI-AGENT.md` and a skill index
automatically. The folder is also a user-extensible skill library: add a `.md`
skill under `custom/` and it appears in the next Connect index, without changing
the extension. For Blender workflows, ask the AI to use the Blender skill.

## Security

- The host runs commands only for the connected page and the matching machine
  UUID.
- Sensitive paths such as `.ssh`, `.aws`, `.env`, private keys, and browser
  cookies are refused for file uploads.
- The AI operator guide requires explicit user confirmation before destructive commands.
- The host does not prompt for, store, or fill passwords. Do not put passwords in commands.
- Command output and uploaded files still go to the AI site you are using.
  Review them before sending sensitive content.

See [PRIVACY.md](PRIVACY.md) for the data flow.

## License

webai-claw Noncommercial License. See [LICENSE](LICENSE).
