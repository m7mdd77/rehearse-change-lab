Current runtime: **GPT 6.1 Sol through AgentRouter**. See [configuration and verification](docs/sol-migration.md). Dated DeepSeek recordings remain historical evidence.

# Rehearse — preview the blast radius

For [Simulate Before You Act](https://build.doo.ooo/challenges/simulate-before-act).

[Open the live workbench](https://rehearse-change-lab.choggyacc.chatgpt.site/) · [90-second walkthrough](https://rehearse-change-lab.choggyacc.chatgpt.site/walkthrough.mp4) · [Public source](https://github.com/m7mdd77/rehearse-change-lab)

Rehearse turns a retention request into a bounded deletion filter, executes the exact SQL on a copy of an actual SQLite database, and shows the full diff. A human can execute that particular preview or revise it. Execution checks the current state and compares actual effects with the prediction inside a transaction. Unexpected effects roll back before commit.

The action is real: persisted ticket, note and attachment rows are deleted through an HTTP service, then can be restored. **The workspace contains fictional disposable data. No production database, real customer account, file attachment, email or payment service is connected.** Attachment rows are metadata, not physical files. Predictions are exact within this bounded database model, not probabilities about the outside world.

## Run a clean clone

Node.js 24.19+ is required. The local service has no third-party runtime dependencies.

```powershell
node --test test/*.test.js
node scripts/build.mjs
node server.js
```

Open http://127.0.0.1:3281. A visitor receives a separate persistent SQLite workspace under ignored `data/local-workspaces/`. Without an API configuration the manual filter, simulation, real execution and restore still work; AI reports unavailability instead of using a canned response.

For live AI, copy `.env.example` to ignored `.env` and supply an existing approved AgentRouter key and the genuine supported Claude Code client path. Then start `node --env-file=.env server.js`. The operator can reuse the existing private sibling configuration with `node --env-file=../decision-engine/.env server.js`; never copy that file into the public source.

## Try the full loop

1. Simulate **All teams**, closed before **2026-09-01**. Eight tickets match, exceeding the five-ticket limit; execution is blocked.
2. Ask DeepSeek: “Delete resolved delivery tickets closed before 1 September 2026. Keep retention-held tickets.” Review the drafted Delivery filter.
3. Simulate it. The exact predicted diff removes **3 tickets, 6 notes and 3 attachment rows**, affects ticket history for three fictional customers, and preserves all four customer records/preferences, open tickets and the held ticket.
4. Execute the reviewed deletion. The source now contains **9 tickets / 18 notes / 9 attachment rows**. Restore it: the original records return atomically.
5. Simulate again, open **Explore an unexpected side effect**, and arm the faulty adapter. Execution attempts an additional customer preference update. The comparison detects the mismatch and rolls back both that update and the deletions. A receipt persists, while domain data and its version remain unchanged.

The Records and Receipts views read actual service state. A page reload does not reseed an existing database. A later domain or schema change blocks a stale preview or conflicting restore.

## AI's actual role

DeepSeek v4 Flash interprets natural language into an allowlisted filter or asks for clarification. A missing cutoff is not silently guessed. It receives the entered request and typed-contract instructions, not a copy of the workspace database. It has no tools, SQL, approval or execution capability. Only SQLite produces the predicted effects. A draft never automatically simulates or writes domain records.

The real supported client is invoked with tools/MCP/session persistence disabled, bounded output, a 25-second deadline and an estimated request budget. There is no model retry or fallback. Both successful and failed attempts consume a persistent rolling allowance of 16 per hour; the public host also allows at most 4 AI requests per session per hour. Client cost limits are estimates, not provider-billing guarantees. Unit tests inject model responses and are not provider evidence; actual inference receipts are under `docs/evidence/`.

## Hosted architecture

The public ChatGPT Site serves the interface and a Worker/D1 command queue. An authenticated outbound PC worker performs the real SQLite operations and genuine AI calls. The provider key stays on the PC. The Site has only a separate worker service credential. Run the operator worker from this repository with `node --env-file=.env pc-worker.js` after configuring its credential on the Site. Its fixed permitted origin is `https://rehearse-change-lab.choggyacc.chatgpt.site`; loopback overrides are available for development.

**Live service requires the operator's PC awake and connected.** An offline badge and failed request remain truthful; there is no imitation cloud execution. Each anonymous HttpOnly session maps server-side to its own SQLite directory; the browser cannot choose another workspace. The hosted session lasts seven days. Clearing its cookie loses access to that workspace; there is no cross-device account recovery. The prototype caps stored workspaces at 100 and needs operator retention/cleanup before broad production use.

Queued payloads are cleared after claim. Delivered/failed/timed-out results are deleted; abandoned rows are cleaned on subsequent worker or config activity after 120 seconds. This is request-driven cleanup, not guaranteed timed erasure. PC workspaces retain domain data, previews, response caches, recovery snapshots and receipts until the operator removes them. Do not enter sensitive text. Already sent model prompts may remain in provider logs.

The worker claims each job once and does not replay a model call or mutation after delivery failure. Retrying the same operation reference returns its cached result if recorded; preview consumption also prevents duplicate deletion. A crash after domain commit but before response-cache insertion can leave a successful receipt without a returned response. **Inspect Receipts after an interrupted execution**, rather than assuming it failed. This is not a distributed exactly-once guarantee.

## Verification and limits

All 26 automated checks pass. The deployed Worker/D1/PC path also passed an actual two-call DeepSeek run: clarification, a blocked broad batch, exact deletion, exact restoration and rollback of an unexpected customer update. See [the public run receipt](docs/evidence/public-live.json); its 991 reported tokens describe that run, not total project cost.

`node scripts/verify-live.mjs <approved-base-url>` is operator-only and makes **two paid AI calls**. It verifies clarification, a too-wide batch, actual deletion, exact restoration and an unpredicted-effect rollback through HTTP. Its evidence separates real provider runs from injected tests.

The domain is four known SQLite tables with foreign-key cascades. Unknown tables require review. The restore path verifies the current domain/schema digest before restoring; it refuses to overwrite later edits. It restores database rows, not external messages, files, backups or irreversible third-party effects. Internal audit events and previews intentionally persist after rollback. The controlled faulty-adapter injection demonstrates a specific under-prediction; it is not a claim that the system predicts every possible failure.

Hosted development: `npm ci` inside `site/`, root `node scripts/build.mjs`, then `npm run build` in `site/`. Preserve the Sites integration and tracked D1 migration history. Native Sites publication applies pending production migrations. Never track `.dev.vars*`, `.env*`, `.sites-runtime/`, `data/` or client configuration.

See [methodology](docs/methodology.md), [architecture](docs/architecture.md), [failure evidence](docs/failure-test.md), [two-year thesis](docs/thesis.md) and [release record](docs/release.md).
