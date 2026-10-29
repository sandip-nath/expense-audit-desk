import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Desk, csv } from '../src/desk.ts';
import { plan, validateQuery, validDate } from '../src/planner.ts';
test('chat reports corrected weekly totals, single-day expenses, and receipt outage recovery', async () => {
  const d = new Desk(); const s = d.create();
  const audit = await d.chat(s.id, 'Audit Alex from 2026-10-01 to 2026-10-07');
  assert.match(audit.text, /6 expenses\. Known USD total: \$769\.00\. Policy-eligible: \$574\.00/);
  const hotel = await d.chat(s.id, 'Explain E103');
  assert.match(hotel.text, /\$480\.00 \| eligible/);
  const day = await d.chat(s.id, 'Audit Alex on 2026-10-07');
  assert.deepEqual(day.report!.rows.map(r => r.expense.id), ['E106']);
  await d.chat(s.id, 'Audit Blair from 2026-10-01 to 2026-10-07');
  d.auditor.gateway.faults.receiptDown = true;
  const outage = await d.chat(s.id, 'Only meals');
  assert.match(outage.text, /Known USD total: \$50\.00\. Policy-eligible: \$0\.00/);
  assert.equal(outage.report!.complete, false);
  assert.equal(outage.report!.rows[0].state, 'needs-review');
  d.auditor.gateway.faults.receiptDown = false;
  const recovered = await d.chat(s.id, 'Audit');
  assert.equal(recovered.query.employee, 'blair'); assert.equal(recovered.query.category, 'meals');
  assert.equal(recovered.report!.eligibleUsdMinor, 5000); assert.equal(recovered.report!.complete, true);
});
test('chat retains employee/date scope across category and receipt follow-ups', async () => {
  const d = new Desk(); const s = d.create();
  await d.chat(s.id, 'Audit Blair from 2026-10-01 to 2026-10-09');
  await d.chat(s.id, 'Only meals');
  const r = await d.chat(s.id, 'Show receipts');
  assert.equal(r.query.employee, 'blair'); assert.equal(r.query.category, 'meals'); assert.equal(r.query.end, '2026-10-09');
  assert.match(r.text, /E202: present/); assert.equal(s.history.length, 6);
  await d.chat(s.id, 'All categories'); assert.equal(s.query.category, null);
});
test('help and policy do not change conversation scope', async () => {
  const d = new Desk(); const s = d.create(); const before = structuredClone(s.query);
  assert.match((await d.chat(s.id, 'hello')).text, /I can/);
  assert.match((await d.chat(s.id, 'Show policy')).text, /per night/);
  assert.deepEqual(s.query, before);
});
test('explicit selections invalidate the last report', async () => {
  const d = new Desk(); const s = d.create(); await d.chat(s.id, 'Audit Alex'); assert.ok(s.report);
  d.select(s.id, { employee: 'blair' }); assert.equal(s.report, null);
});
test('ambiguous employee requests and invalid dates do not mutate state', async () => {
  const d = new Desk(); const s = d.create(); const before = structuredClone(s.query);
  await assert.rejects(d.chat(s.id, 'Audit Alex and Blair'), /one employee/);
  await assert.rejects(d.chat(s.id, 'Audit Alex from 2026-10-10 to 2026-10-01'), /valid employee/);
  assert.deepEqual(s.query, before); assert.equal(validDate('2026-02-30'), false);
  assert.throws(() => validateQuery({ ...before, employee: 'unknown' }));
});
test('the planner supports explanations and rejects multiple category filters', () => {
  assert.equal(plan('Explain E103').expenseId, 'E103'); assert.throws(() => plan('Only meals and lodging'), /one category/);
});
test('CSV contains row evidence and stable column headers', async () => {
  const d = new Desk(); const s = d.create(); const r = await d.chat(s.id, 'Audit Alex');
  const text = csv(r.report!); assert.match(text, /"original_minor","currency","usd_minor"/); assert.match(text, /"E101"/);
});
test('separate sessions retain separate scopes', async () => {
  const d = new Desk(); const a = d.create(), b = d.create(); await d.chat(a.id, 'Audit Blair'); assert.equal(b.query.employee, 'alex');
});
