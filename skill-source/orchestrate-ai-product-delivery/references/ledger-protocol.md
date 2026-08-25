# Project ledger protocol

## Contents

1. Ledger purpose
2. File roles
3. Item lifecycle
4. Progress entries
5. Decision entries
6. User preview and approval
7. Corrections and synchronization
8. Session recovery

## 1. Ledger purpose

Keep the project recoverable and auditable across long AI-assisted delivery. Record evidence and decisions, not a polished narrative of only successful work.

## 2. File roles

### `current-status.md`

Mutable snapshot containing:

- last update;
- current stage and Gate;
- one current objective;
- links to the accepted baseline and detailed evidence;
- only incomplete work and decisions relevant to the current item;
- exactly one next work item;
- blockers;
- a compact current version matrix.

### `index.md`

Optional human navigation and source-of-truth map containing:

- the authoritative file for each fact type;
- current work-item, evidence and decision links;
- the compact template for new progress entries.

It is not an additional fact source and is not a mandatory Codex session-recovery read.

### `progress-ledger.md`

Append-only record containing implementation, test, preview, user feedback, acceptance, Gate and incident facts.

### `decision-log.md`

Append-only record containing material product/AI/technical/release decisions, alternatives, reasons, costs, owner, status and reconsideration triggers.

Use `reviews/ITEM-*.md` for work-item verification, `eval/benchmark-report.md` for cross-version benchmark summaries, and machine-readable `eval/runs/` artifacts for raw AI/model runs. Progress entries link to those artifacts rather than duplicating raw results.

## 3. Item lifecycle

- `PROPOSED`: suggested but not authorized.
- `READY`: scope and acceptance are clear.
- `IN_PROGRESS`: being implemented.
- `READY_FOR_PREVIEW`: implementation and developer checks done.
- `CHANGES_REQUESTED`: user requested modifications.
- `ACCEPTED`: user approved the outcome.
- `BLOCKED`: explicit external blocker.
- `CANCELLED`: deliberately stopped with reason.

Do not mark `ACCEPTED` merely because code exists or automated tests pass when product preview is required.

## 4. Progress entries

Use stable ID `LOG-YYYYMMDD-NNN`. Every entry contains one metadata line and only the applicable fields:

- metadata: date / stage / item ID / status;
- change: the durable change in this entry;
- evidence: verification result plus a stable review, benchmark, run or incident link;
- user decision: only when feedback, authorization or acceptance occurred;
- risk/blocker: only when new or changed;
- next action.

Add files/resources or a version delta only when they changed and are not already obvious from the linked evidence. Do not repeat the full version matrix, unchanged rationale, raw test output or empty placeholders.

Do not create a separate start log for an ordinary `IN_PROGRESS` transition already visible in current status. Log starts only when authorization, scope, risk or an external dependency must remain independently auditable. Label an applicable but unexecuted check `NOT_RUN` and partial verification `PARTIAL`; omit inapplicable fields rather than filling them with `等待` or `NOT_RUN`.

Use stable ID `RUN-YYYYMMDD-NNN` for an executable test or AI run that needs independent comparison. Associate AI runs with at least `app_version`, `rules_version`, `schema_version`, `prompt_version`, `workflow_version`, `model_id`, `kb_version`, `case_id/request_id`, result, latency, token/cost and fallback state. Store raw runs in `eval/runs/`; summarize comparable batches in `eval/benchmark-report.md`.

## 5. Decision entries

Use stable ID `DEC-NNN`. Record:

- status: `PROPOSED`, `ACCEPTED`, `REJECTED`, `SUPERSEDED`;
- decision and alternatives;
- evidence and reasoning;
- trade-off/known cost;
- decision owner/date;
- reconsideration trigger;
- superseded decision ID when applicable.

Do not infer user acceptance from silence. Technical implementation defaults may be recorded as temporary baselines if reversible, but label them clearly.

## 6. User preview and approval

Before preview, report:

- intended outcome;
- what changed and what did not;
- tests performed and not performed;
- how to inspect it;
- known limitations;
- exact approval requested.

On feedback:

1. append feedback to the current item;
2. classify accepted/change/defer/reject;
3. update the item status;
4. implement changes if requested;
5. re-test affected areas;
6. ask for acceptance again;
7. only then advance.

## 7. Corrections and synchronization

Do not delete or silently rewrite prior progress/decision entries. Add a correction:

```markdown
## LOG-YYYYMMDD-NNN | Correction to LOG-...

- Incorrect statement:
- Correct evidence:
- Impacted documents/decisions:
- Repair completed:
```

After every accepted item:

- append progress;
- update current status;
- update decision status if needed;
- update roadmap/R&D guide only when scope or Gate logic changed;
- add failed AI/safety cases to the evaluation set;
- update benchmark/release record when versions changed.

When the same fact appears in multiple artifacts, keep the detailed fact in its authoritative source and replace copies with an ID/link. Existing history remains immutable; the compact convention applies from the first explicitly recorded optimization entry onward.

## 8. Session recovery

At the start of a continuation:

1. read current status;
2. read the most recent relevant progress and decision entries;
3. inspect the actual workspace and version state;
4. identify unprocessed user feedback;
5. confirm the current item and prerequisites;
6. continue from the recorded next step without redoing accepted work.

If the ledger conflicts with workspace reality, trust observable state, record a correction, then update current status.

Use `index.md` only for human navigation or when the authoritative file/link is unclear; reading it is not part of the default Codex recovery sequence.

For item source selection, follow `SKILL.md` “Minimum sufficient source audit.” The ledger records its compact section-reference card, not copied source passages.
