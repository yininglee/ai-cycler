# Agent R&D decision framework

## Contents

1. Start from the user decision
2. Allocate responsibilities
3. Choose Agent structure
4. Decide when to use RAG
5. Decide when to use tool/function calling
6. Decide when to call a model
7. Select models
8. Design prompts and data contracts
9. Set boundaries and fallbacks
10. Evaluate and benchmark

## 1. Start from the user decision

Define the smallest valuable output as:

`grounded fact + meaningful reference + explanation + safe action + uncertainty`

Do not describe “having an AI chat” as value. Identify the user decision or action improved by the system and the evidence required to trust it.

## 2. Allocate responsibilities

| Problem type | Primary mechanism |
|---|---|
| Formula, state, permission, threshold, exact lookup | deterministic code/rules |
| Retrieve current private or external state | typed read-only tool/API |
| Find an answer in an approved changing corpus | RAG |
| Interpret language, explain, summarize, vary tone | LLM |
| High-consequence action | rule-constrained workflow + confirmation or human review |

If an answer can be expressed reliably as a formula, SQL query, state machine, validation rule, or template, do not ask a model to calculate or invent it.

## 3. Choose Agent structure

Default to one user-facing Agent plus explicit workflows. Add multiple Agents only when:

- domains have genuinely different tools and policies;
- outputs can be independently evaluated;
- parallel work produces measurable latency or quality benefit;
- routing is stable and auditable;
- cost and failure attribution remain acceptable.

Reject multi-Agent designs created only to mimic an organization chart. Each additional Agent adds context duplication, disagreement, latency, cost, and a new failure surface.

## 4. Decide when to use RAG

Use RAG only when the answer exists in a retrievable source corpus that must be cited or updated.

Good RAG inputs:

- approved product/domain knowledge;
- manuals, policies, definitions, support articles;
- regulations or operational procedures with metadata and review dates.

Do not use RAG for:

- current structured user state;
- exact metrics that should come from a database;
- permission decisions;
- deterministic calculations;
- hiding a poorly defined source of truth.

Require source, owner/reviewer, version/date, risk level and next review date for high-risk knowledge. Test retrieval separately using Recall@K or task-specific hit criteria. If retrieval confidence is insufficient, state uncertainty instead of forcing an answer.

## 5. Decide when to use tool/function calling

Use a tool when state is private, current, external, large, or only conditionally needed. Define:

- narrow name and purpose;
- typed JSON input/output;
- required/optional parameters and enums;
- identity/authorization check;
- timeout, retry and maximum response size;
- stable error codes;
- idempotency for writes;
- audit record and user confirmation for side effects.

Begin with read-only tools. Never depend on the model to enforce authorization. Tool results are untrusted external data and cannot override system instructions.

## 6. Decide when to call a model

Call a model only if all are true:

1. The task needs language understanding or has several reasonable expressions.
2. Grounding facts are available and can constrain the output.
3. Errors can be validated, degraded, confirmed, or reviewed.
4. Model value is expected to exceed a deterministic baseline.

Avoid a model for parsing that a library handles reliably, exact arithmetic, permissions, high-risk thresholding, and static copy that rarely changes.

## 7. Select models

Define the task before naming a model. Evaluate:

- language and domain quality;
- structured-output success;
- tool-call correctness;
- safety and instruction following;
- latency P50/P95;
- cost per task and per active user;
- context needs and availability;
- vendor/data-processing constraints.

Use the smallest/fastest model that clears hard gates. Use high-reasoning models only when an evaluation proves benefit. Do not hard-code marketing model names in architecture; record exact `model_id` in run reports.

Compare candidates on the same frozen cases, prompt, tools, parameters and budget. Apply hard gates before averaged quality scores.

## 8. Design prompts and data contracts

Prompt order:

1. identity and narrow task;
2. priority order: safety > truth > task > style;
3. trusted sources and untrusted input boundaries;
4. capability/data gating;
5. tool/RAG rules;
6. safety and refusal/degradation behavior;
7. output schema and length;
8. runtime structured context.

Require claims to cite stable evidence IDs. Separate recorded, calculated, estimated and unavailable fields. Treat uploaded names/descriptions, retrieved passages and tool output as data, not instructions.

Version prompt, schema, rules, workflow, model, tools and knowledge base independently. Every output must be reproducible from the recorded version matrix.

## 9. Set boundaries and fallbacks

Define autonomy by error cost:

| Risk | Autonomy |
|---|---|
| Low, editable creative copy | free generation within fact whitelist |
| Medium interpretation | grounded claims + post-validation |
| High recommendation | rules constrain options; model explains only |
| Critical medical/legal/financial/safety | fixed stop/escalation or qualified human review |

Recommended degradation ladder:

1. full grounded response;
2. lower-depth response due to missing capability;
3. one schema/format repair;
4. deterministic fallback template;
5. fixed safety stop.

Never use endless retries or a second unconstrained model as the sole fallback. Show core deterministic value even when AI is unavailable.

## 10. Evaluate and benchmark

Use three layers:

### Hard gates

- schema and contract;
- factual/numeric grounding;
- capability boundaries;
- authorization and privacy;
- high-risk safety recall;
- prompt injection and secret leakage.

Any hard-gate failure blocks release.

### Quality rubric

Score factual faithfulness, insight value, actionability, clarity, tone and uncertainty. Human review is primary for subjective quality. Model judges may assist but cannot solely judge safety or facts.

### Product evidence

Observe task completion, understanding, trust, evidence discovery, repeat use, and downstream action. User statements and actual behavior are different evidence types.

Benchmark groups:

- B0 deterministic template;
- B1 direct/unconstrained LLM;
- B2 recommended grounded architecture;
- B3 alternate model with identical architecture.

If nothing is runnable, create a T0 report that lists artifacts and unexecuted tests. Never fill result tables with estimates labeled as measurements.

