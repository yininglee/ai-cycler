# Release stages and gates

## Contents

1. Stage model
2. Gate order
3. Recommended stage contracts
4. Decision types
5. Gray release
6. Feature flags and rollback
7. Incident handling
8. Production readiness
9. Post-launch iteration

## 1. Stage model

Use stages to expand risk gradually. Tailor names and cohorts to product risk and operator capacity.

| Stage | Primary uncertainty |
|---|---|
| Baseline | Can deterministic facts and evaluation be trusted? |
| Demo | Does the AI experience add user value? |
| Alpha | Does the product work with real data and recover from errors? |
| Beta | Do activated users repeat the core behavior? |
| Release Candidate | Can the system operate safely and reliably? |
| Controlled GA | Does quality hold as acquisition and traffic expand? |
| Continuous iteration | Does each new capability add incremental value safely? |

Do not use stage names as maturity claims without meeting their evidence contracts.

## 2. Gate order

Evaluate in this order:

1. safety, privacy, authorization and destructive-action integrity;
2. factuality and AI capability boundaries;
3. core task completion;
4. reliability, latency, degradation and cost;
5. user value and repeated behavior;
6. new feature demand.

Earlier failures block later discussion.

## 3. Recommended stage contracts

### Baseline Gate

- deterministic value works without a model;
- source/derived/estimated fields are distinguishable;
- fixtures include normal and abnormal cases;
- evaluation and version matrix exist;
- secrets remain server-side.

### Demo Gate

- fixed AI cases run with zero hard-gate failures;
- grounded architecture beats or meaningfully complements B0;
- 5 task-based users reveal understandable value and evidence;
- fallbacks preserve the core task;
- measured latency/cost are recorded.

Five users provide directional usability evidence, not retention or market proof.

### Alpha Gate

- 10–20 invited target users use real or representative data;
- data import/core calculation consistency is verified;
- permissions, deletion, errors, logging and support work;
- new real-world failures enter regression cases;
- AI disable-to-template rollback is rehearsed.

Increase cohort if the domain is heterogeneous or risk is higher.

### Beta Gate

- at least 30–50 activated users for a solo controlled pilot, more when operations allow;
- observation covers the natural repeat cycle;
- report numerator/denominator for activation and repeat behavior;
- reliability, degradation, cost and support load remain within budget;
- interview both repeat users and drop-offs;
- no severe authorization, privacy or safety events.

### Release Candidate Gate

- feature freeze around the validated core loop;
- production environment, monitoring, backups and restore rehearsed;
- account, authorization, data export/delete, retention and third-party flow documented;
- prompt/workflow/model/knowledge rollbacks work independently;
- primary devices/browsers and abuse/upload tests pass;
- user terms, privacy, AI notice and support entry exist;
- deployment-specific compliance blockers are reviewed by qualified parties when needed.

### Controlled GA Gate

- release in cohorts, not all at once;
- no critical incident during the observation window;
- SLOs, AI hard gates, cost and support load remain stable;
- activation/repeat value does not collapse relative to Beta;
- stop-registration and maintenance controls work.

## 4. Decision types

- `GO`: all hard and stage evidence gates pass.
- `CONDITIONAL GO`: only low-risk non-blocking items remain, with owner, cohort cap and ≤7-day deadline.
- `NO-GO`: hard gate or core hypothesis fails; fix and rerun.
- `STOP/RETHINK`: repeated cycles show insufficient value, unacceptable risk or uneconomic operation.

Never conditionally waive cross-user access, critical safety, deletion integrity, backup/restore, or blocking compliance issues.

## 5. Gray release

Suggested cohorts:

1. owner and reviewers;
2. 5 seed users;
3. 20 users;
4. 50 users;
5. controlled public cap based on support and budget.

Define a minimum observation interval for every cohort. A cohort size is a ceiling, not a target to fill regardless of signal.

## 6. Feature flags and rollback

Use server-enforced flags for:

- AI generation versus deterministic fallback;
- chat, RAG and individual tools;
- data-source uploads/integrations;
- risky sharing/location features;
- new prompt/model cohorts;
- registration and maintenance mode.

Rollback units:

- app build;
- database migration;
- rules/schema;
- prompt/workflow/model;
- knowledge base;
- individual external integration.

Release one meaningful variable at a time when measuring causality.

## 7. Incident handling

Suggested levels:

- P0: cross-user/secret leak, destructive data loss, dangerous critical advice — disable immediately and preserve evidence.
- P1: widespread core failure, deletion failure, systematic fabrication — stop expansion and degrade/rollback.
- P2: limited format/browser/non-core failure — provide alternate path and fix promptly.
- P3: copy/layout/minor experience issue — normal backlog.

Every P0/P1 requires root-cause analysis, a new regression case, explanation of why tests missed it, and renewed small-cohort release.

Initial automatic-stop examples:

- any cross-user, secret, sensitive-location or critical safety failure;
- core error rate >5% for five minutes;
- AI fallback >10% for fifteen minutes;
- AI P95 above twice the release target for thirty minutes;
- daily cost reaches the predeclared safety cap;
- repeated same-type blocking feedback after a new release.

Tune operational thresholds after obtaining a baseline; keep severe safety thresholds at one event.

## 8. Production readiness

Verify:

- server-side identity and authorization on every private object;
- secret rotation and least privilege;
- sensitive data minimization, retention, deletion and redacted logs;
- third-party data processing and residency;
- backup/restore with RPO/RTO;
- rate, size, quota and cost limits;
- availability, latency, error, fallback and safety monitoring;
- user communication, support and incident templates;
- platform/regional legal review appropriate to actual launch form.

Do not state that a generic checklist proves legal compliance.

## 9. Post-launch iteration

Require every new feature to have:

- observed demand evidence;
- falsifiable hypothesis;
- minimal slice and non-goals;
- independent tests/evaluation cases;
- failure/fallback and rollback;
- gray cohort and observation window;
- expand/adjust/stop decision.

Prioritize with a risk-adjusted heuristic:

`observed pain × core-loop increment ÷ (delivery cost × error risk)`

