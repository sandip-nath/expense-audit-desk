# Expense Audit Desk

A conversational TypeScript debugging lab about reconciling business expenses. This is a fictional exercise, not financial guidance or an official interview question.

## Interview brief

You have joined the team that owns a small internal expense assistant. Employees and reviewers use it to examine claims, convert amounts to USD, check reimbursement policy, and investigate exceptions. It calls a paginated expense service, a receipt service, a policy service, and an FX service. Users report that the assistant's totals and eligibility assessments cannot always be trusted.

The application starts and supports repeated chat messages, but it has multiple independent defects. Reproduce the reports, determine their causes, prioritize repairs, and demonstrate correctness. Do not replace the application or disable its failure simulations to make tests pass.

The default suite has **23 tests: 16 passing and 7 intentionally failing**. Some failures share a root cause. No fixes, diagnosis notes, or solution branch are included.

## Start on Windows / PowerShell

Requires **Node.js 22.18+**; Node 24 is also supported. There are no dependencies to install, network services, API keys, or paid model requirements.

```powershell
npm start
```

Open **http://localhost:4321**. Leave that terminal running, and run tests in another terminal:

```powershell
npm test
```

If using mise without an activated shell:

```powershell
mise exec -- npm start
mise exec -- npm test
```

If PowerShell blocks npm.ps1, use `npm.cmd` instead of `npm`. If the port is occupied, set `$env:PORT = "4322"` before starting.

Terminal chat is also available:

```powershell
npm run chat
```

## What you can chat about

Try these in one conversation:

> Audit Alex from 2026-10-01 to 2026-10-07
>
> Only meals
>
> Show exceptions
>
> Show receipts
>
> All categories
>
> Explain E103
>
> What about Blair?
>
> Show policy

The browser also provides explicit employee, date, and category selectors. Click **Apply scope** to apply them, then ask for an audit. Scope changes in chat update those selectors. Each result includes a table, totals, receipt state, policy assessment, and inspectable tool traces. CSV export downloads the latest report; it does not submit a claim.

Supported employees: Alex and Blair. Categories: meals, transport, lodging, equipment. Dates use YYYY-MM-DD. A single date selects that day. Date ranges include both endpoints. Category filters persist until changed or cleared with “All categories”. Employee changes preserve the selected dates and category.

**The default chat planner is deterministic, not an LLM.** It recognizes documented intents and extracts employee names, dates, category filters, and expense IDs. Tool calls execute asynchronously against local simulated services; responses are calculated from returned records. This is not an unrestricted natural-language assistant. There is no live-model adapter in this exercise: external provider setup is outside scope. Diagnose application/data correctness using the included planner and services.

Supported intents: audit/reconcile/summary/total, expense list, exceptions, receipts, explanation by expense ID, policy, and help. Unknown requests return help. Natural-language date expressions, comparisons between employees, arbitrary advice, receipt uploads, and payment operations are outside scope.

## Support queue

These are user reports, not diagnoses:

1. “Changing the service's page size changes how many expenses I see and the total. The audit can still say it is complete.”
2. “An expense on the last selected date is missing. Selecting just that date can return nothing.”
3. “The USD equivalent of foreign receipts does not agree with the supplied rate.”
4. “A hotel stay that should fit the lodging allowance is flagged.”
5. “During a receipt-service outage, some unverifiable expenses still count toward the policy-eligible amount.”

Use the UI, CLI, data fixtures, API contracts, and tests as evidence. Preserve the seeded records and policy semantics. Seven red tests do not imply seven separate defects.

## Expected behavior and contracts

### Expense retrieval

The expense API returns `{ items, nextCursor }`. A non-null cursor indicates another page. Cursors are opaque continuation tokens: pass the returned token back rather than deriving offsets in application code. Collection should retain every unique expense in the selected scope, independent of page size. Use a reasonable bound/progress guard to avoid an infinite loop if a future integration repeats cursors. A failed later page must not silently become a complete report.

The selected date range is inclusive at both ends. Dates represent calendar expense dates, not timestamps. Source expense ordering is stable for this lab.

### Money and rates

All source monetary fields are integer minor units. USD, EUR, and GBP each have 100 minor units per major unit in this exercise. An FX record states **USD major units per source major unit**, expressed as a numerator/denominator pair. For example, a rate of 6/5 means one source unit is worth 1.20 USD. Rates are fixed fictional reference rates; historical rate selection is outside scope.

Convert and round each expense to the nearest USD cent before aggregation. Half-cent ties round upward for these nonnegative claims. Do not round only the grand total, mix major and minor units, or include unpriced rows as zero-dollar claims. This lab does not include credits, refunds, or negative expenses. Retain original currency/amount evidence.

### Policy

The policy service is authoritative. Limits are inclusive. Meals, transport, and equipment caps apply per expense. Lodging caps apply per night, using the stay's `nights` field. Invalid/missing nights cannot prove lodging eligibility. All seeded lodging records have valid positive integer nights.

Receipt requirements are evaluated against the converted USD amount. A missing required receipt is an exception. A receipt lookup failure is unknown evidence, not proof of presence or absence. Rows whose required evidence is unavailable need review and must not count toward policy-eligible totals. Below the receipt threshold, a receipt is optional.

If there is a definite violation as well as unavailable receipt evidence, retain the violation reason and exclude the row from eligibility; an exception or needs-review state is acceptable for that combination. Never label a partial report complete. An unavailable optional receipt may be shown as a warning without changing eligibility.

### Failure behavior

Retain useful known amounts during an FX or receipt outage. An unpriced expense has `usdMinor: null` and a pending-review assessment. Distinguish **known USD total** from **policy-eligible total**, and clearly identify incomplete evidence. Eligibility is not approval or payment. Each audit rereads service evidence; there is no cache to repair in this exercise.

### Conversation and traces

Follow-up filters retain selected scope. Separate conversations retain separate state. Independent receipt lookups should remain concurrent. FX should be requested once per distinct currency per audit. Preserve useful request/result/error traces. No write tools or confirmation workflow exist in this lab.

## Controls and diagnostics

Browser controls:

- Expense API page size: 2, 3, or 50.
- Receipt service unavailable.
- Foreign-exchange service unavailable.

Changes apply to the next audit. In the CLI:

```
/page 50
/fault receipt on
/fault receipt off
/fault fx on
/fault fx off
/trace
/new
/quit
```

Controls are process-wide, but query/history/report state belongs to each conversation. Browser and CLI use separate processes and do not share state. Everything resets when the server restarts. The side panel shows each tool request, result, failure, and elapsed duration; the ledger shows report evidence, not an independent source of truth.

## Interview scope and deliverables

For a **60-minute mock**, reproduce and prioritize the queue, resolve a coherent subset, and explain remaining work. For **90–120 minutes**, aim to repair all five reported issues and add meaningful regression coverage. More time may be needed for additional hardening.

Create a baseline commit before starting:

```powershell
git init
git add .
git commit -m "Baseline expense audit exercise"
```

Use your preferred coding agent. Review its hypotheses and changes, and be ready to explain what you verified. Deliver focused repairs, regression tests, local commits, and a short handoff with symptoms, causes, verification, tradeoffs, and remaining limitations. Keep optional hardening separate from required repairs. Do not weaken assertions or change fixture facts to pass tests.

## Repository map

| File | Responsibility |
| --- | --- |
| src/planner.ts | Chat intent parsing and scope validation |
| src/desk.ts | Conversation state, orchestration, text and CSV presentation |
| src/audit.ts | Collection, enrichment, monetary and policy assessment |
| src/tools.ts | Simulated paginated API, receipts, policy and FX services |
| src/data.ts | Fictional source records, rates and policy |
| src/server.ts | Local browser API and server |
| src/cli.ts | Interactive terminal client |
| public/index.html | Browser chat, report table and trace inspector |
| test/ | Unit, integration, chat and HTTP acceptance tests |

Native Node.js executes the erasable TypeScript syntax. No compiler or static checking dependencies are bundled. Adding type checking is an optional separate improvement. Authentication, durable storage, arbitrary-language reasoning, hosted deployment, real expense import, and actual financial actions are outside scope.
