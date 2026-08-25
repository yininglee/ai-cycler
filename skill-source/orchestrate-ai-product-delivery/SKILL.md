---
name: orchestrate-ai-product-delivery
description: Turn AI product plans, PRDs, requirements, research notes, UED references, and existing repositories into a coordinated delivery system consisting of an evidence-driven Demo and Agent R&D guide, a version roadmap with release gates from Demo through production and continuous iteration, and a traceable project ledger; then guide implementation step by step through build, evaluation, user preview, approval, release, and ongoing improvement. Use when Codex needs to plan or run an AI product from documents to Demo/Alpha/Beta/MVP/GA, design Agent/RAG/function-calling/prompt/fallback/evaluation decisions, establish Go/No-Go criteria, create or repair coordinated delivery documents, resume work from a ledger, or keep decisions, tests, releases, and user feedback synchronized during Vibe Coding.
---

# Orchestrate AI Product Delivery

Build and operate one evidence-driven delivery system, not three disconnected documents. Keep product assumptions, AI architecture, implementation work, evaluation evidence, release gates, and decisions synchronized from initial Demo through production iteration.

## Operating principles

1. Start from the riskiest user/value assumption, not the full PRD feature list.
2. Separate deterministic facts and safety rules from probabilistic model expression.
3. Increase only one risk radius at a time: real data, user count, persistence, public traffic, then high-risk capabilities.
4. Treat code, rules, schema, prompt, workflow, model, tools, and knowledge base as independently versioned release units.
5. Never invent benchmark results, user evidence, legal clearance, test execution, or production readiness.
6. Require user preview and approval for completed product slices before advancing when the user asks for ongoing guidance.
7. Preserve an append-only trace of implementation, tests, feedback, Gate decisions, failures, and corrections.
8. Use a single fact source for each kind of record; keep progress entries delta-oriented and link to detailed evidence instead of copying it.

## Load references progressively

- Read `references/document-system.md` completely when creating, updating, or reconciling the three-document system.
- Read `references/agent-rd-framework.md` completely when the product includes an Agent, LLM, RAG, tool calling, prompt, safety, or AI evaluation decisions.
- Read `references/release-gates.md` completely when defining versions, Alpha/Beta/MVP/GA criteria, gray release, rollback, incidents, or production readiness.
- Read `references/ledger-protocol.md` completely when starting execution, resuming a project, recording work, accepting user feedback, or changing a decision.
- Use templates under `assets/templates/` as structural starting points. Customize them to the source evidence; do not leave bracketed placeholders.
- Run `scripts/validate_delivery_system.py <project-root>` after creating or materially changing the coordinated documents.

These rules govern bundled Skill references. For project PRDs and delivery documents, use the minimum sufficient audit below.

## Minimum sufficient source audit

For every `ITEM`, audit all three development authorities without reading all three documents in full by default:

1. Read `current-status.md`, the latest relevant log/review, observable workspace/code/tests and latest related decisions.
2. Search headings first, then read only the PRD sections directly related to the item.
3. Read only the corresponding R&D-guide implementation/evaluation sections.
4. Read only the roadmap module row, current-stage scope and applicable Gate.
5. Record a compact audit card with source section references, scope, non-goals, material-conflict status and acceptance criteria. Cite sections; do not copy source passages or whole documents into the ledger.

Do not reread accepted unchanged sections. Read `index.md` only when ownership or links are unclear. Resuming work, updating the ledger or starting an ordinary item is not a reason to load full documents.

Read the PRD, R&D guide and roadmap in full only when at least one trigger applies: entering a new Demo/Alpha/Beta/RC/GA stage; materially changing Agent/model/RAG/tool/privacy/safety/data boundaries; the user changes product direction; a material conflict is found; performing a 3–5-item stage review; or preparing a Gate/release decision. Otherwise, the targeted audit is required.

## Decide the operating mode

Choose one mode from the request and workspace state:

### A. Bootstrap

Use when product documents exist but the coordinated delivery system does not.

1. Inventory PRDs, plans, research, UED references, code, evaluations, and constraints.
2. Extract source-backed goals, users, core journeys, data sensitivity, high-risk outputs, external dependencies, and unresolved conflicts.
3. Propose the smallest Demo that can falsify the main value hypothesis.
4. Create the three-document system and initial evaluation/benchmark artifacts.
5. Record unconfirmed material choices as `PROPOSED`, not as accepted facts.
6. End at the first scope approval Gate unless the user already authorized implementation.

### B. Reconcile

Use when some or all documents already exist.

1. Apply the minimum sufficient source audit. Start with the fields or sections being reconciled; expand to full documents only when a listed trigger applies.
2. Compare stage names, scope, versions, Gate metrics, sample sizes, current status, next work item, and decision states.
3. Treat source facts as higher priority than generated summaries; flag genuine product conflicts.
4. Repair cross-links and inconsistencies without silently rewriting append-only history.
5. Add a correction or superseding decision when prior records were wrong.

### C. Execute and guide

Use when the user wants step-by-step implementation, testing, release, or iteration.

1. Read `project-ledger/current-status.md` first.
2. Verify the workspace reality; do not trust stale status blindly.
3. Select exactly one small, previewable work item whose prerequisites are satisfied.
4. Before implementation, state purpose, scope, non-goals, acceptance criteria, user action, and risks.
5. Apply the minimum sufficient source audit and record its compact audit card.
6. Reconcile the PRD and roadmap before coding. If they materially conflict on product behavior, scope, data handling, risk, or acceptance, preserve both statements and ask the user to decide; do not silently choose one.
7. Record the source audit and any pending clarification in the ledger before implementation.
8. Implement and test proportionally to risk.
9. Present a preview with actual evidence and unverified items clearly labeled.
10. Await user acceptance when the item affects product behavior or a documented approval Gate.
11. Append the result and feedback to the ledger; update current status; then select the next item.

### D. Release decision

Use when asked whether a build, model, feature, or version can advance.

1. Freeze the evaluated version matrix.
2. Check hard safety/privacy/authorization gates first.
3. Check AI factuality and capability boundaries next.
4. Check core task, reliability, latency, cost, and user evidence.
5. Return one decision: `GO`, `CONDITIONAL GO`, `NO-GO`, or `STOP/RETHINK`.
6. Do not use `CONDITIONAL GO` for safety, cross-user access, deletion, backup/restore, or blocking compliance gaps.
7. Record scope, cohort, observation window, automatic stop triggers, rollback version, and next review date.

## Build the coordinated document system

Create or maintain these artifacts using a product-specific prefix when appropriate:

1. `[产品]-Demo搭建与Agent研发指南.md`
2. `[产品]-版本路线图与上线放行机制.md`
3. `project-ledger/`
   - `index.md`
   - `README.md`
   - `current-status.md`
   - `progress-ledger.md`
   - `decision-log.md`

Add machine-readable AI evaluation cases and an append-only benchmark report when the product uses AI generation or tool orchestration.

The documents must collaborate as follows:

- The R&D guide defines **how to build and test** the current product slice.
- The roadmap defines **what evidence permits expansion** to the next risk stage.
- The ledger records **what actually happened, what the user accepted, and what is next**.
- The current status points to one current Gate and one next work item.
- Every Gate cites evidence artifacts rather than repeating untraceable conclusions.

### Ledger compression and traceability

Treat the ledger as an indexable audit trail, not a second copy of every report:

- `current-status.md` is the only mandatory Codex recovery entry and contains the current stage, Gate, blocker, compact version matrix and exactly one next item;
- `index.md` is optional human navigation and a source-of-truth map; do not read it on every continuation unless a link or fact owner is unclear;
- `progress-ledger.md` is append-only and records only meaningful state changes, real verification summaries, user actions, risks and next steps; omit fields that did not occur;
- `decision-log.md` is append-only and records material decisions, alternatives, reasons, trade-offs and reconsideration triggers;
- work-item verification belongs in `reviews/ITEM-*.md`; cross-version benchmark summaries belong in `eval/benchmark-report.md`; raw AI runs belong in machine-readable `eval/runs/` artifacts identified by `RUN-*`;
- other documents reference stable `ITEM-*`, `LOG-*`, `DEC-*` and `RUN-*` IDs instead of duplicating full tables.

Do not create a separate start log when `current-status.md` already records an ordinary `IN_PROGRESS` transition. Add a progress entry when there is durable evidence, user feedback, a scope/decision change, a blocker, an incident, a Gate result, or a correction. Use `NOT_RUN` only for an applicable check that was intentionally not executed, not as filler for absent feedback.

Do not delete or silently rewrite existing history when introducing this convention. Start the compact format at a new log entry, add a correction entry when an old fact is wrong, and run the delivery-system validator after changing the ledger structure.

## Resolve ambiguity safely

Ask the user only when a decision materially changes product direction, risk, platform, data handling, or cost and cannot be inferred safely. Offer a recommended option with reasons. Continue reversible analysis while waiting when useful.

Common decisions to surface:

- target platform and first public release form;
- real versus fixture data and data-source priority;
- whether high-risk health, finance, legal, or safety advice is in scope;
- public versus invitation-only launch;
- data retention, third-party model processing, and geography;
- who can provide domain, security, privacy, or legal review.

Do not block on ordinary implementation details that can be safely changed later.

## Control scope and evidence

- Label all evidence as one of: source document, automated test, model run, human review, user behavior, user statement, or assumption.
- Report small samples as counts and percentages, for example `3/10 (30%)`.
- Do not claim retention from one-time usability testing.
- Do not call a template or mocked path “validated with real users.”
- Do not turn a model judge into the sole authority for safety or factual correctness.
- If no runnable model/workflow exists, publish a T0 benchmark-readiness report with `not run`, not fabricated scores.

## Validate before handoff

1. Run the bundled validator.
2. Check that no unresolved template placeholders remain.
3. Confirm the roadmap and R&D guide link to the ledger.
4. Confirm current status matches the latest progress and decision entries.
5. Confirm all declared test results were actually executed.
6. Summarize created/changed artifacts, the current stage and Gate, unresolved decisions, and the single next work item.
