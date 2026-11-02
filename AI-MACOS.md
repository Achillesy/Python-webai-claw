---
name: macos
description: macOS system tasks, permissions, Finder, apps, screenshots, and shell workflows.
triggers: macos, mac, finder, desktop, documents, downloads, screenshot, clipboard, open, homebrew, applescript
platforms: macos
version: 1
---

# AI-MACOS.md - macOS skill

> Use this skill for macOS-specific work. Every `claw` command still needs
> `host` and exact `"v":3` as described in `AI-AGENT.md`.

## 1. First checks

- Read the platform, shell, hostname, and host version from the Connect
  attachment.
- Use the visible skill index to confirm that this skill is for the current
  machine.
- Prefer user-writable locations such as `~/Downloads` or a temporary folder
  for generated files.
- Quote paths with spaces.

## 2. Privacy permissions

macOS protects Desktop, Documents, Downloads, and some application data with
TCC.

If a command returns `Operation not permitted`:

- do not use `sudo`, `chmod`, or copy the folder to bypass it;
- explain that this is macOS privacy protection;
- ask the user to grant **Full Disk Access** to the browser that launches the
  host: Google Chrome or Microsoft Edge;
- the user must fully quit and reopen that browser;
- reconnect and retry with a new command ID.

Terminal permission alone does not apply when the host is launched by the
browser.

## 3. Useful macOS commands

```sh
# Finder / open
open ~/Downloads
open -a "Safari"
open -R ~/Downloads

# Clipboard
pbcopy < file.txt
pbpaste

# Screenshot
screencapture -x /tmp/webai-claw-screen.png

# Find files
mdfind "kMDItemFSName == '*.png'"
find ~/Downloads -maxdepth 2 -name '*.png' -print

# Processes and ports
ps aux
pgrep -fl "Application Name"
lsof -nP -iTCP -sTCP:LISTEN

# System information
sw_vers
uname -m
df -h
```

## 4. Applications and AppleScript

Launch or focus an application:

```sh
open -a "Application Name"
```

Use AppleScript only when the user explicitly needs UI automation:

```sh
osascript -e 'tell application "Finder" to activate'
```

UI automation may require Accessibility permission. If macOS reports a
permission error, explain the required System Settings change; do not attempt to
bypass it.

## 5. Homebrew

Check whether Homebrew is present before using it:

```sh
command -v brew
brew --version
```

Installing software is a system change. Confirm with the user before running
`brew install`, and do not use `sudo brew`.

## 6. Screenshots and attachments

- Capture to a temporary path first.
- Use `attach` when the image should appear in the chat.
- Do not upload a screenshot without checking whether it contains private
  information.
- Do not put large binary data inline in a command block.

## 7. Safety

- Do not use `sudo` unless the user explicitly requests it and understands the
  change.
- Do not delete user data, change startup items, or modify security settings
  without confirmation.
- Do not read passwords, tokens, keychains, browser cookies, or private keys.
- For a command that may take a long time, follow the timeout guidance in
  `AI-AGENT.md`.
