# Origin

webai-claw is a hard fork by copy (fresh git history) of:

- **Source:** `https://github.com/Achillesy/Python-webai-hands`
- **Commit:** `c2b6f08` (`docs: add 2026-10-08 pm design handoff`)
- **Date:** 2026-10-12

The v2 design work (URL-keyed command queues, install-time machine identity,
execution-robustness lessons) was carried over into `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md` and
`PROTOCOL.md`; the implementation starts from the renamed v2 code and applies
the redesigns from the ground up instead of branching.

`webai-hands` (Chrome Web Store, v1.0.0) remains a separate, maintained
product. The v3 fence (`claw-exec` / `"v":3`) keeps the two products from
ever triggering each other.
