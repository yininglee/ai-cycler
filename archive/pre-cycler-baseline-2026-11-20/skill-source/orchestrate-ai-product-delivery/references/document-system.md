# Coordinated document system

## Contents

1. Purpose
2. Source inventory
3. Document responsibilities
4. Creation sequence
5. Reconciliation rules
6. Minimum content contracts
7. Naming and linking
8. Quality checks

## 1. Purpose

Create one operating system for delivery. Avoid producing a strategy document, a build guide, and a ledger that use different stage names, scopes, and metrics.

The system answers three distinct questions:

- **R&D guide:** How will the current product slice be designed, built, evaluated, and made safe?
- **Roadmap and release gates:** What evidence allows expansion to the next stage or cohort?
- **Ledger:** What actually occurred, what changed, what the user accepted, and what is next?

## 2. Source inventory

Before authoring, inventory:

- product plan, PRD, requirement notes, market/competitor research;
- UED images, prototypes, design systems, existing UI;
- repository, schemas, APIs, infrastructure, tests;
- prompts, workflows, model configurations, tools, knowledge bases;
- prior evaluations, user research, analytics, incidents;
- platform, budget, time, team, regulatory and data constraints.

For every material statement, distinguish:

- `SOURCE_FACT`: explicitly present in source material;
- `OBSERVATION`: found in code/data/workspace;
- `ASSUMPTION`: needed to progress but not confirmed;
- `PROPOSAL`: recommended decision awaiting approval;
- `DECISION`: explicitly accepted;
- `EVIDENCE`: executed test or observed behavior.

Do not turn a proposal into a decision because it appears in a generated document.

## 3. Document responsibilities

### Demo and Agent R&D guide

Own:

- first-principles value hypothesis and smallest falsifiable Demo;
- in-scope/out-of-scope boundaries;
- deterministic system and AI responsibility split;
- Agent structure and model/RAG/tool/prompt decisions;
- data contracts, confidence, privacy and safety boundaries;
- scenario workflows, fallbacks and degradation;
- Vibe Coding stack, information architecture and UED rules;
- module build order and acceptance criteria;
- testing pyramid, AI evaluation set, rubric and benchmark protocol.

Do not own production cohort expansion decisions beyond linking to the roadmap.

### Version roadmap and release gates

Own:

- stage sequence and the single uncertainty each stage addresses;
- entry/exit criteria, sample size and evidence requirements;
- production readiness, SLOs, cost and support constraints;
- gray cohorts, feature flags, rollback and stop triggers;
- incident levels and post-incident re-release;
- compliance readiness checkpoints;
- feature-expansion triggers after launch.

Do not duplicate implementation-level prompt or schema details; link to the R&D guide.

### Project ledger

Own:

- current stage, current Gate, current item and current version matrix;
- append-only implementation/test/preview/acceptance history;
- decisions, alternatives, reasons and superseding evidence;
- user feedback and whether it was accepted, deferred or rejected;
- failures, corrections, next work item and blockers.

Do not rewrite roadmap policy inside the ledger. Link to the relevant Gate.

## 4. Creation sequence

1. Inventory sources and conflicts.
2. Define value hypothesis and first Demo boundary.
3. Draft the R&D guide through the first user-test Gate.
4. Extend stages from Demo to controlled production in the roadmap.
5. Create the ledger with actual current state, not desired future state.
6. Add evaluation cases, benchmark report and release templates if applicable.
7. Cross-link all artifacts.
8. Run consistency validation.

If the repository already has documents, reconcile before creating replacements.

## 5. Reconciliation rules

Check these fields across artifacts:

| Field | Authoritative source |
|---|---|
| Product positioning and original requirements | PRD/product plan, with later accepted decisions overriding |
| Current Demo scope | latest accepted decision + R&D guide |
| Stage/Gate definitions | roadmap |
| Current stage and next item | current-status + latest relevant ledger evidence |
| Work-item verification | `reviews/ITEM-*.md` linked from the progress entry |
| Cross-version benchmark summary | `eval/benchmark-report.md` |
| Raw AI/model runs | machine-readable `eval/runs/` artifacts keyed by `RUN-*` |
| User acceptance | progress ledger entry |
| Prompt/model/workflow version | execution logs/version matrix |

When conflicts occur:

1. Preserve original evidence.
2. Identify whether the conflict is factual, a changed decision, or different levels of detail.
3. Ask only if the choice materially changes direction or risk.
4. Add a superseding decision; do not erase history.
5. Update derived documents and current status.

## 6. Minimum content contracts

### R&D guide required sections

- outcome and Demo pass criteria;
- first-principles value model;
- scope and unresolved decisions;
- system/Agent architecture;
- rules versus RAG versus tools versus LLM decision matrix;
- model selection protocol;
- data contract and confidence;
- scenario workflows;
- System Prompt design or linked prompt;
- boundary/fallback matrix;
- UI/Vibe Coding plan;
- prioritized build sequence;
- test strategy and AI evaluation;
- benchmark plan and honest current report;
- telemetry and Definition of Done.

### Roadmap required sections

- stage map from current state to production;
- one primary uncertainty per stage;
- stage scope, non-goals, entry and exit Gate;
- user sample/cohort and observation length;
- product, AI, data, engineering, safety/privacy, performance/cost gates;
- GO/CONDITIONAL GO/NO-GO/STOP rules;
- environments and version matrix;
- feature flags, gray release and rollback;
- incident response;
- production readiness and compliance review points;
- post-launch expansion triggers;
- immediate next step.

### Ledger required sections

- current stage/Gate/status;
- links to the accepted baseline and authoritative evidence;
- current incomplete work, blockers and pending decisions only;
- exactly one next work item with acceptance action;
- compact current version matrix;
- optional human navigation/source map in `index.md`;
- append-only logs and decision records.

## 7. Naming and linking

Prefer product-specific filenames while keeping discoverable phrases:

- `[product]-Demo搭建与Agent研发指南.md`
- `[product]-版本路线图与上线放行机制.md`
- `project-ledger/index.md`
- `project-ledger/current-status.md`
- `project-ledger/progress-ledger.md`
- `project-ledger/decision-log.md`

The headers of the two guides should link to each other and to current status. Current status should link to the accepted guides, evaluation cases, and benchmark evidence. `index.md` is human navigation and must not become a second current-status source.

Use stable IDs:

- work items: `ITEM-V001`;
- decisions: `DEC-001`;
- progress: `LOG-YYYYMMDD-001`;
- Gates: `G0`, `G1`, ...;
- incidents: `INC-YYYYMMDD-001`;
- test runs: `RUN-YYYYMMDD-001`.

## 8. Quality checks

- No unresolved `[PRODUCT_NAME]`, `[DATE]`, `TODO`, `TBD`, or invented result.
- Stage names and Gate IDs are consistent.
- Sample sizes match the operating capacity and are not presented as statistical proof.
- Every “passed” claim links to executable or observed evidence.
- Each high-risk capability has a fixed safety boundary and rollback path.
- Current status contains exactly one current Gate and one next work item.
- Append-only files have not had prior entries silently altered.
- The index exists, its local file links resolve, and Codex recovery does not require reading both index and current status.
- Compact logs omit inapplicable fields and link passed checks to authoritative evidence.
