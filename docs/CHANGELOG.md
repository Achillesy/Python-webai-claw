# Changelog

All notable changes to webai-claw. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2026-11-01

### Changed

- Public code, comments, UI strings, AI guides, and store metadata are
  English-only for the international Chrome Web Store release.
- Removed unused ChatGPT, Gemini, and Google AI Mode adapters. Supported sites
  are DeepSeek and Muse.
- Removed legacy host command aliases, unbound file reads, and unbound command
  execution. Every host operation now requires a live lease and an exact
  binding, session, and AI match.
- Removed the arbitrary 150k-character context warning. DeepSeek handoff is
  driven by the AI through the `summary` block.
- Removed unused page-level adapter hooks and historical/internal documents.
- Added a privacy policy and a current store submission checklist.
- Simplified the store build and listing to the supported feature set.

### Versions

- Extension and host bumped to 1.1.0.

## [1.0.1] - 2026-11-01

### Changed

- Removed the `Connected to <site>` notification. Connect is initiated from the
  foreground popup, so the notification could only appear in a rare tab-switch
  race. Notifications now cover unexpected disconnects and waiting for the
  user's next command.

## [1.0.0] - 2026-11-01

### Changed

- Global badge: blank when not connected, `✓` when connected, and `...` when the
  native host has run a command for 5 seconds.
- Separate `Auto-send command results` (default on) and `Auto-send attachments`
  (default off) options.
- Attachment auto-send is controlled only by the popup.
- System notifications for unexpected disconnects and waiting for user input.
- Notifications show only the site hostname, never the session URL.
