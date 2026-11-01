# webai-claw Privacy Policy

Effective date: 2026-11-01

webai-claw is a Chrome extension plus a local Python host. The extension has no
developer-operated server, no analytics, no advertising, and no tracking. It
does not sell or share personal data with the developer.

## Data the extension processes

- **Chat content on supported sites.** On `chat.deepseek.com` and `muse.ai`,
  the content script reads the page to detect `claw` command blocks and to fill
  results back into the input box.
- **Command and result content.** Commands and results are sent between the
  page and the local host over Chrome Native Messaging. They are also placed in
  the chat so the AI can read them.
- **Local configuration.** The extension stores the machine UUID, hostname,
  platform, processed command IDs, auto-send preferences, and pause state in
  `chrome.storage.local`.
- **Local files.** When a chat requests an attachment, the local host reads the
  requested file and the extension uploads it to the AI chat site. Uploads are
  disabled for sensitive paths such as `.ssh`, `.aws`, `.env`, private keys, and
  browser cookies. The host caps a single file at 25 MB.
- **Notifications.** If the user enables Chrome notifications for the
  extension, notifications contain the site hostname and a short status message.
  They do not contain the session URL or command output.

## Local host data

The local host is installed under `~/.webai-claw/` on the user's machine. It
stores:

- `machine.json`: the machine UUID;
- `runtime/active.json`: the current page binding and task state;
- `log/exec_history.jsonl`: metadata about executions, limited to the most
  recent records;
- `log/host.log`: diagnostic events;
- `handoff.md`: an optional conversation handoff written only when the AI sends
  a `summary` block.

Execution history is metadata-only: command text and output text are not
persisted. Logs use a session fingerprint and length metadata instead of the full session
URL, command text, output text, or file path. The user can delete `~/.webai-claw/` at any
time with the uninstall script or manually.

## Third-party AI sites

Commands, results, attachments, and conversation content are processed by the
AI site the user chooses (DeepSeek or Muse). Those sites have their own privacy
policies. webai-claw does not control their retention or use of data. Users
should not send sensitive files or secrets through a chat.

## Permissions

- `nativeMessaging`: communicate with the local host the user installed.
- `storage`: remember the machine binding and user preferences.
- `notifications`: show optional status notifications for disconnects and
  waiting-for-user events.
- Host permissions for `muse.ai` and `chat.deepseek.com`: read command blocks
  and fill results on those supported sites only.

## Data sharing

The developer does not receive extension data. Data leaves the machine only
when the user sends it to the selected AI site through the chat, or when the
user manually runs a command that accesses the network.

## Children

webai-claw is not directed to children under 13.

## Changes

Material changes will be reflected in this file and in the repository release
notes.

## Contact

Questions or privacy requests: open an issue at
<https://github.com/Achillesy/Python-webai-claw/issues>.
