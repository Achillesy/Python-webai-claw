# Contributing to webai-claw

Thanks for helping out. This project is small on purpose — please keep it that way.

## Ground rules

- **One thing at a time.** Small, focused PRs beat big rewrites.
- **No new dependencies** in `native-host/` without discussion. The host must stay
  a stdlib-only Python package (`host.py` entry point plus `hostlib/`).
- **Security first.** The host runs shell commands on the user's machine. Any PR
  touching `host.py`, the native-messaging boundary, or file access must explain
  its security implications. When in doubt, fail closed.
- **Test on a real page.** Adapter changes must be verified live on the target
  site before merge — "code-identical to X" is not verification.

## Dev setup

1. Clone the repo.
2. Load the unpacked extension: `chrome://extensions` → Developer mode →
   Load unpacked → select `extension/`.
3. Install the host: `python3 native-host/install.py` (macOS/Linux) or run
   `native-host/install_windows.bat` (Windows).
4. Click the extension icon → "Test Bridge" → shows `connected: <hostname>`.
5. Run the full local test script:

   ```bash
   sh tests/run_all.sh
   ```

After changing extension code: **reload the extension** in `chrome://extensions`
(page refresh alone is not enough — the service worker keeps the old code).
After changing `host.py`: reload the extension so it respawns the host.

## Adding a new site adapter

1. Read `AI-AGENT.md` and the two current adapters (`deepseek.js`, `muse.js`).
2. Start from `docs/ADAPTER-TEMPLATE.md`, not from a copy of a site-specific
   adapter: copying selectors across sites is how false positives happen.
3. Implement the adapter interface (see `docs/ARCHITECTURE.md` §4):
   required `findBlocks`, `sessionKey`, `ai`, `fillResult`, `clickSend`,
   `uploadFile`; optional `isStopButton`, `isGenerating`, `isUploading`,
   `isInputEmpty`, and `isProvisionalSession`. A new site should implement
   `isProvisionalSession` for its own new-chat URLs; without it, session
   adoption falls back to the built-in muse/deepseek rules.
4. Register the site in `extension/manifest.json` in three places:
   `content_scripts[].js` (after `adapter-check.js`, before `content.js`),
   `content_scripts[].matches`, and `host_permissions`. No change to
   `content.js`, `background.js`, or any other core file is needed; if you
   think one is, the adapter interface is missing something — say so in
   the PR instead of working around it in the core.
5. Use the `probe` block (`AI-AGENT.md` §2.2) to inspect the site's DOM
   (input box, send button, `input[type=file]`) before writing selectors.
6. Add the adapter to `tests/test_adapters.js` (registration, required
   methods, provisional-session behaviour) and run `sh tests/run_all.sh`.
7. Verify live: exec round-trip, result fill-back, auto-send, and an `attach`
   upload end-to-end. A store submission is needed before users get a new
   site; that is a release-owner decision, not part of the adapter PR.

## Adding a host capability (no extension change)

Host-side extension is the normal upgrade path and does not need a store
submission: re-running the installer is how users get it.

1. Put reusable helpers under `native-host/skill/` (scripts the AI calls
   through `exec` at a fixed path) or, for host behaviour, under
   `native-host/hostlib/` with a narrow, documented entry point.
2. If you add a file under `hostlib/` or `skill/`, add it to
   `HOST_FILES` in `native-host/install.py` — `tests/test_install.py`
   fails otherwise, because the installed host would import a file the
   installer never copied.
3. For a user-authored capability, prefer a skill file in
   `~/webai-claw-skills/custom/` over host code: it needs no installer
   change at all, and `native-host/skill_check.py --check <file>` validates
   it before the next Connect index.
4. Run `sh tests/run_all.sh` and, after installing on a real machine,
   `python3 native-host/install.py --verify` (read-only) to confirm the
   installed host, manifests, machine identity, and skill directories.

## Block protocol

AI assistants talk to the bridge with fenced `claw` code blocks and exact
`"v":3` (`AI-AGENT.md`). The six kinds are:

- `{"claw":"exec", ...}` — run a shell command on the host
- `{"claw":"probe", ...}` — read-only DOM inspection (page-local, never hits host)
- `{"claw":"attach", ...}` — upload a local file as a chat attachment
- `{"claw":"diag", ...}` — host/lease/history diagnostics
- `{"claw":"write_file", ...}` — create or replace a small local file atomically
- `{"claw":"summary", ...}` — write the handoff summary for the next Connect

Protocol v3 is intentionally strict. New block kinds need a section in
`AI-AGENT.md`, a host message definition, and a security review.

## Release (Chrome Web Store)

Store packaging and submission are handled by the release owner. Do not commit
generated zips; `store/` remains the reference for listing materials and a
reproducible build check.

If the release owner needs a package, `bash store/build.sh` produces it. After
the store assigns an extension ID, add it to the host allowlist in
`native-host/install.py` and tell users to re-run the installer.

## License

By contributing you agree your changes go under the repo's `LICENSE`
(free for non-commercial use; no commercial use or resale).

