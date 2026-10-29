import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Auditor, toUsdMinor, classify } from '../src/audit.ts';
import { Gateway } from '../src/tools.ts';
import { expenses, rates, policy } from '../src/data.ts';
import type { Query, Trace } from '../src/types.ts';
const query: Query = { employee: 'alex', start: '2026-10-01', end: '2026-10-09', category: null };
const fresh = () => { const gateway = new Gateway(); return { gateway, auditor: new Auditor(gateway) }; };

test('opaque cursors and overlapping pages preserve every unique expense', async () => {
  const { gateway, auditor } = fresh(); const cursors: (string | null)[] = [];
  gateway.listExpenses = async (_query, cursor = null) => {
    cursors.push(cursor);
    if (cursor === null) return { items: expenses.slice(0, 2), nextCursor: 'opaque:next' };
    assert.equal(cursor, 'opaque:next');
    return { items: expenses.slice(1, 3), nextCursor: null };
  };
  const result = await auditor.run(query, []);
  assert.deepEqual(cursors, [null, 'opaque:next']);
  assert.deepEqual(result.rows.map(r => r.expense.id), ['E101', 'E102', 'E103']);
  assert.equal(result.knownTotalUsdMinor, 55600);
  assert.equal(result.complete, true);
});

test('repeated cursors terminate collection and mark retained evidence incomplete', async () => {
  const { gateway, auditor } = fresh(); let calls = 0;
  gateway.listExpenses = async () => { calls++; return { items: [expenses[0]], nextCursor: 'repeat' }; };
  const result = await auditor.run(query, []);
  assert.equal(calls, 2); assert.equal(result.rows.length, 1);
  assert.equal(result.knownTotalUsdMinor, 2200); assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /repeated.*cursor/);
});

test('later page failure preserves known rows and error traces without claiming completion', async () => {
  const { gateway, auditor } = fresh(); const trace: Trace[] = [];
  gateway.listExpenses = async (_query, cursor = null) => {
    if (cursor !== null) throw new Error('Second page offline');
    return { items: [expenses[0]], nextCursor: 'second' };
  };
  const result = await auditor.run(query, trace);
  assert.equal(result.complete, false); assert.equal(result.knownTotalUsdMinor, 2200);
  assert.match(result.warnings.join(' '), /Second page offline/);
  assert.ok(trace.some(t => t.name === 'list_expenses' && t.phase === 'error'));
  assert.ok(trace.some(t => t.phase === 'start' && (t.detail as any).cursor === 'second'));
});

test('first page failure rejects instead of producing an empty complete report', async () => {
  const { gateway, auditor } = fresh();
  gateway.listExpenses = async () => { throw new Error('Expense service offline'); };
  await assert.rejects(auditor.run(query, []), /Expense service offline/);
});

test('an empty intermediate page with a continuation token does not stop collection', async () => {
  const { gateway, auditor } = fresh();
  gateway.listExpenses = async (_query, cursor = null) => cursor === null
    ? { items: [], nextCursor: 'after-empty' }
    : { items: [expenses[0]], nextCursor: null };
  const result = await auditor.run(query, []);
  assert.equal(result.complete, true);
  assert.deepEqual(result.rows.map(r => r.expense.id), ['E101']);
});

test('page guard bounds services that keep returning fresh cursors', async () => {
  const { gateway, auditor } = fresh(); let calls = 0;
  gateway.listExpenses = async () => ({ items: [], nextCursor: `page-${++calls}` });
  const result = await auditor.run(query, []);
  assert.equal(calls, 1000); assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /page limit/);
});

test('FX rounds half cents upward per expense and handles large integer intermediates', () => {
  const halfRate = { ...rates.USD, numerator: 1, denominator: 2 };
  assert.equal(toUsdMinor(1, halfRate), 1);
  assert.equal(toUsdMinor(3, halfRate), 2);
  assert.equal(toUsdMinor(Number.MAX_SAFE_INTEGER, { ...rates.USD, numerator: 3, denominator: 3 }), Number.MAX_SAFE_INTEGER);
  assert.throws(() => toUsdMinor(Number.MAX_SAFE_INTEGER, { ...rates.USD, numerator: 2 }), /safe integer/);
});

test('aggregation sums individually rounded conversions', async () => {
  const { gateway, auditor } = fresh();
  gateway.listExpenses = async () => ({ items: [
    { ...expenses[0], id: 'round-a', amountMinor: 1 },
    { ...expenses[0], id: 'round-b', amountMinor: 1 },
  ], nextCursor: null });
  gateway.rate = async () => ({ ...rates.USD, numerator: 1, denominator: 2 });
  gateway.receipt = async () => ({ status: 'present' });
  const result = await auditor.run(query, []);
  assert.equal(result.knownTotalUsdMinor, 2); assert.equal(result.eligibleUsdMinor, 2);
});

test('lodging with missing or invalid nights needs review', () => {
  for (const nights of [undefined, 0, -1, 1.5, NaN]) {
    const row = classify({ ...expenses[2], nights }, 48000, { status: 'present' }, policy);
    assert.equal(row.state, 'needs-review'); assert.match(row.reasons.join(' '), /nights/);
  }
});

test('unavailable optional receipt preserves eligibility and definite violations retain reasons', () => {
  const optional = classify(expenses[0], 2499, { status: 'unavailable' }, policy);
  assert.equal(optional.state, 'eligible');
  const threshold = classify(expenses[0], 2500, { status: 'unavailable' }, policy);
  assert.equal(threshold.state, 'needs-review');
  const violation = classify(expenses[0], 6001, { status: 'unavailable' }, policy);
  assert.equal(violation.state, 'exception');
  assert.match(violation.reasons.join(' '), /Over meals limit/);
  assert.match(violation.reasons.join(' '), /receipt unavailable/);
});

test('Alex inclusive weekly report has correct totals across supported page sizes', async () => {
  for (const pageSize of [2, 3, 50]) {
    const { gateway, auditor } = fresh(); gateway.pageSize = pageSize;
    const result = await auditor.run({ ...query, end: '2026-10-07' }, []);
    assert.deepEqual(result.rows.map(r => r.expense.id), ['E101','E102','E103','E104','E105','E106']);
    assert.equal(result.knownTotalUsdMinor, 76900);
    assert.equal(result.eligibleUsdMinor, 57400);
    assert.equal(result.complete, true);
  }
});

test('service recovery rereads evidence and restores policy eligibility', async () => {
  const { gateway, auditor } = fresh(); gateway.faults.receiptDown = true;
  const scope = { ...query, employee: 'blair', category: 'meals' as const };
  const outage = await auditor.run(scope, []);
  assert.equal(outage.knownTotalUsdMinor, 5000); assert.equal(outage.eligibleUsdMinor, 0);
  assert.equal(outage.complete, false);
  gateway.faults.receiptDown = false;
  const recovered = await auditor.run(scope, []);
  assert.equal(recovered.eligibleUsdMinor, 5000); assert.equal(recovered.complete, true);
});
test('expense collection spans all pages with unique records', async () => {
  const { gateway, auditor } = fresh(); const result = await auditor.run(query, []);
  assert.deepEqual(result.rows.map(r => r.expense.id), ['E101','E102','E103','E104','E105','E106','E107']);
  assert.equal(new Set(result.rows.map(r => r.expense.id)).size, 7);
  assert.equal(gateway.calls.filter(c => c.name === 'list_expenses').length, 4);
});
test('changing page size does not change the report membership or totals', async () => {
  const { gateway, auditor } = fresh(); gateway.pageSize = 2; const small = await auditor.run(query, []);
  gateway.pageSize = 50; const large = await auditor.run(query, []);
  assert.deepEqual(small.rows.map(r => r.expense.id), large.rows.map(r => r.expense.id));
  assert.equal(small.knownTotalUsdMinor, large.knownTotalUsdMinor);
});
test('date selection includes both endpoints, including a single-day query', async () => {
  const { gateway } = fresh(); gateway.pageSize = 50;
  const result = await gateway.listExpenses({ ...query, start: '2026-10-07', end: '2026-10-07' });
  assert.deepEqual(result.items.map(e => e.id), ['E106']);
});
test('USD values retain their minor units and are never divided by 100 twice', () => {
  assert.equal(toUsdMinor(2200, rates.USD), 2200); assert.equal(toUsdMinor(0, rates.USD), 0);
});
test('conversion follows the rate contract and rounds each expense to cents', () => {
  assert.equal(toUsdMinor(4500, rates.EUR), 5400);
  assert.equal(toUsdMinor(6000, rates.GBP), 7500);
  assert.equal(toUsdMinor(101, rates.EUR), 121);
});
test('invalid monetary input is rejected', () => {
  for (const amount of [-1, 1.2, NaN, Infinity]) assert.throws(() => toUsdMinor(amount, rates.USD));
  assert.throws(() => toUsdMinor(100, { ...rates.USD, denominator: 0 }));
});
test('lodging policy evaluates the stay using its number of nights', () => {
  const hotel = expenses.find(e => e.id === 'E103')!;
  assert.equal(classify(hotel, 48000, { status: 'present' }, policy).state, 'eligible');
  assert.equal(classify(hotel, 61000, { status: 'present' }, policy).state, 'exception');
  assert.equal(classify(hotel, 60000, { status: 'present' }, policy).state, 'eligible');
});
test('non-lodging limits are per expense and inclusive', () => {
  const meal = expenses[0];
  assert.equal(classify(meal, 6000, { status: 'present' }, policy).state, 'eligible');
  assert.equal(classify(meal, 6001, { status: 'present' }, policy).state, 'exception');
});
test('missing receipts below the threshold are allowed; the threshold itself requires a receipt', () => {
  const meal = expenses[0];
  assert.equal(classify(meal, 2499, { status: 'missing' }, policy).state, 'eligible');
  assert.equal(classify(meal, 2500, { status: 'missing' }, policy).state, 'exception');
});
test('an unavailable required receipt cannot establish policy eligibility', () => {
  const meal = expenses[0];
  const row = classify(meal, 5000, { status: 'unavailable' }, policy);
  assert.equal(row.state, 'needs-review'); assert.match(row.reasons.join(' '), /receipt/i);
});
test('receipt outage retains evidence without counting unverifiable expenses as eligible', async () => {
  const { gateway, auditor } = fresh(); gateway.pageSize = 50; gateway.faults.receiptDown = true;
  const result = await auditor.run({ ...query, start: '2026-10-02', end: '2026-10-03' }, []);
  assert.equal(result.complete, false);
  assert.ok(result.rows.some(r => r.expense.id === 'E102'));
  assert.equal(result.rows.find(r => r.expense.id === 'E102')!.state, 'needs-review');
  assert.equal(result.eligibleUsdMinor, 0);
});
test('FX outage yields an incomplete report with explicit unpriced rows', async () => {
  const { gateway, auditor } = fresh(); gateway.pageSize = 50; gateway.faults.fxDown = true;
  const result = await auditor.run(query, []);
  assert.equal(result.complete, false);
  assert.equal(result.rows.find(r => r.expense.id === 'E102')!.usdMinor, null);
  assert.equal(result.rows.find(r => r.expense.id === 'E102')!.state, 'needs-review');
  assert.ok(result.knownTotalUsdMinor > 0); assert.match(result.warnings.join(' '), /conversion unavailable/);
});
test('employee and category scope do not cross into another claim', async () => {
  const { gateway, auditor } = fresh(); gateway.pageSize = 50;
  const result = await auditor.run({ ...query, employee: 'blair', category: 'meals' }, []);
  assert.deepEqual(result.rows.map(r => r.expense.id), ['E202']);
});
test('empty date ranges produce a genuinely empty report', async () => {
  const { auditor } = fresh(); const r = await auditor.run({ ...query, start: '2026-09-01', end: '2026-09-02' }, []);
  assert.equal(r.rows.length, 0); assert.equal(r.knownTotalUsdMinor, 0); assert.equal(r.complete, true);
});
test('each currency is requested once per audit and receipt reads overlap', async () => {
  const { gateway, auditor } = fresh(); gateway.pageSize = 50;
  const original = gateway.receipt.bind(gateway); let active = 0, peak = 0;
  gateway.receipt = async id => { active++; peak = Math.max(peak, active); try { return await original(id); } finally { active--; } };
  const trace: Trace[] = []; await auditor.run(query, trace);
  assert.equal(gateway.calls.filter(c => c.name === 'fx_rate').length, 3); assert.ok(peak > 1);
  assert.ok(trace.some(t => t.phase === 'result' && typeof t.durationMs === 'number'));
});
