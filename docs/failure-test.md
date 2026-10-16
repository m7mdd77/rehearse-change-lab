# A prediction that is wrong, and a safety net that changes the outcome

**Predicted:** deleting resolved Delivery tickets before September 1 removes T-101, T-102 and T-103, plus six notes and three attachment metadata rows. All customer records and contact preferences stay unchanged.

**Injected reality:** the faulty adapter also runs a real SQLite `UPDATE` changing C-01's contact preference from `email` to `none` during execution. Simulation did not include this operation. The injection is explicit and limited to disposable demo data; it represents one possible adapter mismatch, not a naturally occurring incident.

**Observed containment:** the complete actual domain diff contains an extra customer update. Its digest differs from the preview. The entire transaction rolls back, including ticket deletions, FK cascades and the preference update. The original 12 tickets, 24 notes, 12 attachment rows and four customer rows remain, with unchanged domain version. A separate failure receipt records the predicted removals, unexpected update and rollback. The used preview cannot be replayed.

Other meaningful checks refuse an eight-ticket batch, a plan that includes open/held tickets, forged authority fields, expired or stale previews, changed schema, cross-workspace preview IDs, conflicting restores, altered-command idempotency keys and repeated mutation. Provider failures remain failures; they do not become fixture answers.

`test/workspace.test.js` uses actual persisted SQLite files and online backups. `test/transport.test.js` exercises the hosted queue SQL against SQLite. AI unit tests use injected responses; `scripts/verify-live.mjs` makes actual paid requests and records their model and token reports separately.

The local complete HTTP loop passed with actual DeepSeek: typed plan without writes, missing-date clarification, wide-batch block, exact deletion, exact restoration and contained side effect. Evidence: `evidence/local-live.json`. Public verification is required before submission and recorded in release.md.
