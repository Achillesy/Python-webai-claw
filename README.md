# webai-claw

Give web AI claws on your computer — turn Q&A into output.

webai-claw is a Chrome extension plus a local Python host. You chat with a web
AI (ChatGPT, Claude, DeepSeek, …) as usual; when the AI needs to *do*
something on your machine, it writes a `claw-exec` block. The extension picks
the block up, the local host runs the command, and the result lands back in
the chat.

```claw-exec
{"claw":"exec","id":"demo-1","v":3,"host":"<your-machine-uuid>","cmd":"echo hello"}
```

No API keys. The AI you already pay for (or use for free) becomes the brain;
your computer becomes its hands.

## How it works

1. **Extension** — content scripts watch supported AI chat pages for
   `claw-exec` blocks; the background service worker dedups and routes them.
2. **Native host** — a Python program registered with Chrome via Native
   Messaging. It executes commands and streams results back.
3. **Installer** — `native-host/install.py` sets everything up per machine
   (`~/.webai-claw/`, Chrome registration, operator guides).

Protocol: [`docs/PROTOCOL.md`](docs/PROTOCOL.md) (v3).
Design notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick start

```bash
# 1. Install the host (macOS / Windows)
python3 native-host/install.py

# 2. Load the extension
#    chrome://extensions → Developer mode → Load unpacked → extension/

# 3. See the machine UUID in the toolbar popup, then teach an AI:
#    upload ~/.webai-claw/AI-GUIDE.md to any web AI chat and ask it to run "echo hello".
```

To operators (AIs): read `AI-GUIDE.md`. For file-producing workflows
(Blender etc.): `AI-BLENDER.md`.

## Relationship to webai-hands

webai-claw is the rename-upgrade of
[webai-hands](https://github.com/Achillesy/Python-webai-hands), rebuilt from
the ground up (see [`docs/ORIGIN.md`](docs/ORIGIN.md)). The two products
coexist: v2 blocks (`` `muse-exec ``) never trigger webai-claw and v3 blocks
(`` `claw-exec ``) never trigger webai-hands.

## License

webai-claw Noncommercial License — see [LICENSE](LICENSE).
