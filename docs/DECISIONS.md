# webai-claw Decisions

> Architecture Decision Records (lite). Each entry: context → decision →
> consequences. Dates are when the decision was made.

## 1. Rename-upgrade, not a branch (2026-10-12)

**Context.** webai-hands v1.0.0 is on the Chrome Web Store. Developing the
redesign on a branch meant old/new versions overlapping during debugging,
which is awkward. The redesign is large enough to deserve a clean break.

**Decision.** New repo `Achillesy/Python-webai-claw`, hard fork by copy with
fresh git history (provenance in [`ORIGIN.md`](ORIGIN.md)). webai-hands stays
as a separate product until webai-claw is done.

**Consequences.** New extension ID, new host name, new home dir, new protocol
fence — the two products coexist without interference.

## 2. Protocol v3 is an intentional break (2026-10-12)

**Context.** The block fence is the de-facto protocol. Keeping v2's
`` `muse-exec `` would let both extensions grab the same blocks → double
execution during the overlap period.

**Decision.** v3: fence `` `claw-exec ``, header key `"claw"`, version gate
`"v":3`. Specified in [`PROTOCOL.md`](PROTOCOL.md).

**Consequences.** Old and new extensions can be installed side by side; a
block only ever triggers one product.

## 3. One extension ID from day one (2026-10-12)

**Context.** webai-hands accumulated 3 IDs (dev key, Chrome store, Edge
store). `chrome.storage.local` is partitioned by extension ID, so switching
IDs resets the processed-block list → old blocks re-execute.

**Decision.** webai-claw starts with a single pinned dev key; store IDs are
appended to the allowlist only when a store listing exists.

**Consequences.** No ID-migration bug class, ever.

## 4. Install-time machine identity; host is read-only (2026-10-08)

**Context.** v2's `host.py` generated the UUID at runtime and swallowed write
failures (`except OSError: pass`), producing a fresh UUID per host process —
observed as "the UUID keeps changing".

**Decision.** `install.py` generates `~/.webai-claw/machine.json` (uuid4) only
when absent; atomic write + `0o600`. `host.py` reads it, fails fast
(log + exit) when missing, and never mints identity at runtime.

**Consequences.** Stable identity; reinstalls preserve it; debugging from a
raw checkout requires one `install.py` run first.

## 5. No legacy identity paths (2026-10-08)

**Context.** v2 carried `~/.config/webai-hands/machine.json` as a migration
fallback.

**Decision.** webai-claw recognizes no legacy paths. One home:
`~/.webai-claw/`, always, regardless of launch location.

**Consequences.** Simpler code, one identity story. (No users to migrate —
new product.)

## 6. URL-keyed queues; retire the 5-second busy reject (2026-10-08)

**Context.** Same-conversation tabs sync near-real-time (verified on
DeepSeek), so duplicate tab submissions collided with the old "single active
page" model and the 5-second cross-session rejection.

**Decision.** Registry key = normalized source URL (`origin + path`).
One auto-executing queue per URL; different URLs pump fairly into the serial
host; same-URL duplicates are deduped by block id and dropped silently.

**Consequences.** No manual tab activation; no rejection noise. Queueing does
*not* fix head-of-line blocking — that's what the timeout cap and `kill` are
for (see [`ROADMAP.md`](ROADMAP.md)).

## 7. Shared home dir is a feature; unsafe concurrency is the bug (2026-10-08)

**Context.** Two browsers = two host processes sharing `~/.webai-hands/`.
Whole-file history rewrites clobbered each other and broke idempotent dedup.

**Decision.** Keep one shared home (splitting per browser would fork machine
identity and double skill maintenance). Fix the state handling instead:
append-only JSONL history, atomic first-writer-wins identity.

**Consequences.** Concurrency-safe without doubling everything.

## 8. Human-visible bootstrap guide (2026-10-12)

**Context.** Installers dropped `AI-GUIDE.md` into the hidden `~/.webai-hands/`,
which ordinary users can't find.

**Decision.** `install.py` renders a short human bootstrap guide
(`webai-claw-guide.md`, `{{INSTALL_DIR}}` → real path) into `~/Documents/`
on every install; `uninstall.py` removes it. The guide's only job is getting
the bridge up; it points at the install dir for the full AI guides.

**Consequences.** Discoverable setup without touching the extension.

## 9. "Human reads the page; AI is not expected to read links" (2026-10-08)

**Context.** Letting the AI fetch guide URLs is unreliable (especially
DeepSeek); asking the human to copy-paste is 100% reliable.

**Decision.** Guide delivery is human-driven (file in Documents, upload into
chat). No URL-fetching tricks in the critical path.

## 10. Adapter registry over hardcoded sites (v2, carried over)

**Context.** Site-specific scraping used to live in one big content script.

**Decision.** One adapter file per site, self-registering on
`window.__webaiClawAdapters[hostname]` (`findBlocks`, `blockText`,
`fillResult`, `uploadFile?`, `isActive?`). New site = new file + manifest
entry; core never changes.
