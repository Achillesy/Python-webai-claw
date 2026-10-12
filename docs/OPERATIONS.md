# webai-claw Operations

> Incident lessons and recovery procedures, carried over from webai-hands.
> Design fixes for these live in [`ROADMAP.md`](ROADMAP.md).

## 1. Runaway command wedges the single lane

**What happened (2026-10-08).** An AI-generated recursive filesystem scan
with a huge AI-set timeout held the serial host lane for ~1 hour. Later
commands were rejected by the 5-second busy rule; the default 120s timeout
never fired.

**Lessons.**
- Cap AI-supplied timeouts (ROADMAP P1).
- Page-side stop MUST kill the host subprocess — v2 had no `kill` message
  type; stop only voided queued items (ROADMAP P1: `{type:"kill"}` +
  process-tree termination).
- Queueing replaces rejection noise but does **not** fix head-of-line
  blocking. Say this out loud whenever someone proposes "just queue it".

## 2. Wedged lane after killing the process

**What happened (2026-10-08).** After the runaway was killed, the background
page kept reporting the command as "running" with a growing elapsed timer,
even though no matching process remained.

**Likely mechanism.** Pipe inheritance: an orphaned child held the host's
stdout open, so Chrome never delivered EOF / `onDisconnect` was lost, and the
background's `hostBusy`/`running` state never cleared.

**Recovery (until the watchdog lands).**
1. Reload the extension at `chrome://extensions` (kills the service worker
   context; Chrome also terminates the host it spawned).
2. Refresh the chat page (content script is dead after a reload).
3. Send a trivial probe block before real work.

**Design fixes.** Background watchdog (no message for ~60s → force-recreate
the native port); popup "reconnect" button; host must not depend on
`communicate()`/EOF for liveness (ROADMAP P1).

## 3. Multi-host state hazards

Two browsers = two host processes sharing one home dir. v2 failure modes:

| Hazard | Mechanism | Fix |
|---|---|---|
| History clobbered | whole-file `"w"` rewrite per exec; second process overwrites the first's entries → dedup destroyed, same id can re-execute | append-only JSONL (ROADMAP P0) |
| Identity fork | two first-runs race `uuid4()` → different in-memory UUIDs until restart | atomic first-writer-wins creation (ROADMAP P0) |
| No cross-browser serialization | `hostBusy` lives per service worker | documented limitation; per-URL queues are per-profile (ROADMAP P1) |
| Stale host after reinstall | running process keeps old code in memory | `pong` carries host version/hash; extension prompts restart (ROADMAP P2) |

## 4. Extension-ID / storage partitioning

`chrome.storage.local` is partitioned by extension ID. Anything persisted
there (`processed` block ids, machine-id cache, auto-send flag) starts empty
when the ID changes. Consequences:

- Never change the pinned dev `key` in `manifest.json` casually.
- Debug on **fresh chat pages**: a new ID means an empty processed set, so
  old blocks in old pages would be treated as new.
- webai-claw starts with one ID precisely to avoid this bug class
  (DECISIONS §3).

## 5. Known limitations (documented, not yet fixed)

- Long AI messages can be truncated by page rendering; the `attach` flow
  exists partly for this.
- `host.py` `sys.argv` carries the caller origin (`chrome-extension://<id>/`)
  from native messaging — currently unused; a ready-made hook for
  per-caller policies later.
- VM note: this project's dev machines are the user's Mac/Windows boxes;
  any sandbox/VM used for assistance is not "local" — never confuse the two
  when paths or identities are involved.
