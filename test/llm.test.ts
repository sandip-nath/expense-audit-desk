import { plan } from '../src/planner.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredPlanner, openAIPlanner, defaultPlannerMode } from '../src/llm.ts';
import { Desk } from '../src/desk.ts';
const intent = { action: 'audit', employee: null, start: null, end: null, category: null, clearCategory: false, expenseId: null, policyCategory: null };
function response(value: unknown, status = 'completed') {
  return new Response(JSON.stringify({ status, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
}
const plannerFor = (value: unknown) => openAIPlanner({ apiKey: 'test-key', model: 'test-model', fetch: async () => response(value) });

test('OpenAI adapter sends structured request and uses local audit calculations', async () => {
  let request: any;
  const planner = openAIPlanner({ apiKey: 'test-key', model: 'test-model', fetch: async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    request = JSON.parse(init!.body as string);
    assert.equal((init!.headers as any).Authorization, 'Bearer test-key');
    return response({ ...intent, employee: 'alex', start: '2026-10-07', end: '2026-10-07' });
  } });
  const desk = new Desk(planner); const session = desk.create();
  const result = await desk.chat(session.id, 'Check Alex’s claims on October 7, 2026');
  assert.equal(result.report!.knownTotalUsdMinor, 1800);
  assert.deepEqual(result.report!.rows.map(r => r.expense.id), ['E106']);
  assert.equal(request.store, false); assert.equal(request.text.format.strict, true);
  assert.equal(request.model, 'test-model');
  assert.equal(JSON.parse(request.input).scope.employee, 'alex');
  assert.equal(JSON.stringify(result).includes('test-key'), false);
});

test('LLM policy requests retain scope and show only the requested category', async () => {
  const desk = new Desk(plannerFor({ ...intent, action: 'policy', policyCategory: 'lodging' }));
  const session = desk.create(); const before = structuredClone(session.query);
  const result = await desk.chat(session.id, 'What is the hotel allowance?');
  assert.match(result.text, /lodging \$200\.00 per night/);
  assert.equal(result.text.includes('meals'), false); assert.deepEqual(session.query, before);
});

test('LLM follow-up can clear a category while retaining employee and dates', async () => {
  const desk = new Desk(plannerFor({ ...intent, clearCategory: true })); const s = desk.create();
  desk.select(s.id, { employee: 'blair', category: 'meals' });
  const result = await desk.chat(s.id, 'Include every category');
  assert.equal(result.query.employee, 'blair'); assert.equal(result.query.category, null);
  assert.equal(result.report!.rows.length, 2);
});

test('invalid model intents cannot mutate scope or history', async () => {
  for (const value of [
    { ...intent, employee: 'unknown' }, { ...intent, start: '2026-02-30' },
    { ...intent, start: '2026-11-01', end: '2026-10-01' },
    { ...intent, action: 'pay' }, { ...intent, action: 'explain' },
    { ...intent, action: 'policy', category: 'meals' },
    { ...intent, category: 'meals', clearCategory: true },
    { ...intent, extra: 'ignored?' }, {}, null,
  ]) {
    const desk = new Desk(plannerFor(value)); const s = desk.create(); const before = structuredClone(s.query);
    await assert.rejects(desk.chat(s.id, 'request'));
    assert.deepEqual(s.query, before); assert.equal(s.history.length, 0);
  }
});

test('provider errors are explicit, sanitized, and release the conversation lock', async () => {
  let calls = 0;
  const desk = new Desk(openAIPlanner({ apiKey: 'secret-key', model: 'test-model', fetch: async () => {
    if (++calls === 1) return new Response('secret provider details', { status: 429 });
    return response(intent);
  } }));
  const s = desk.create();
  await assert.rejects(desk.chat(s.id, 'Audit'), /HTTP 429/);
  assert.equal(s.history.length, 0);
  assert.ok((await desk.chat(s.id, 'Audit')).report);
});

test('refusals, incomplete output, malformed JSON, and transport failures fail closed', async () => {
  const bodies = [
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }] }] },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'not json' }] }] },
  ];
  for (const body of bodies) {
    const planner = openAIPlanner({ apiKey: 'key', model: 'model', fetch: async () => new Response(JSON.stringify(body)) });
    const desk = new Desk(planner); const s = desk.create();
    await assert.rejects(desk.chat(s.id, 'Audit')); assert.equal(s.history.length, 0);
  }
  const planner = openAIPlanner({ apiKey: 'key', model: 'model', fetch: async () => { throw new Error('secret'); } });
  const desk = new Desk(planner); const s = desk.create();
  await assert.rejects(desk.chat(s.id, 'Audit'), /unavailable or timed out/);
});

test('offline configuration and explicit provider validation', async () => {
  const desk = new Desk(configuredPlanner({ PLANNER_MODE: 'offline' })); const s = desk.create();
  assert.ok((await desk.chat(s.id, 'Audit Alex')).report);
  assert.throws(() => configuredPlanner({ PLANNER_MODE: 'unknown' }), /PLANNER_MODE/);
  assert.throws(() => configuredPlanner({ PLANNER_MODE: 'openai' }), /required/);
});


test('offline is the default and unconfigured OpenAI fails explicitly', async () => {
  assert.equal(defaultPlannerMode({}), 'offline');
  const desk = new Desk(undefined, {}); const s = desk.create();
  assert.equal(s.plannerMode, 'offline');
  assert.ok((await desk.chat(s.id, 'Audit Alex')).report);
  desk.selectPlanner(s.id, 'openai');
  const historyLength = s.history.length;
  await assert.rejects(desk.chat(s.id, 'Audit Alex'), /required/);
  assert.equal(s.history.length, historyLength);
});

test('adapter selection is per conversation and rejects unknown modes', async () => {
  const desk = new Desk(undefined, {}); const a = desk.create(), b = desk.create();
  desk.selectPlanner(b.id, 'openai');
  assert.equal(a.plannerMode, 'offline');
  await desk.chat(a.id, 'Audit Alex');
  const report = a.report; const query = structuredClone(a.query);
  assert.throws(() => desk.selectPlanner(a.id, 'invalid' as any), /Unknown planner/);
  assert.equal(a.plannerMode, 'offline'); assert.equal(a.report, report); assert.deepEqual(a.query, query);
});


test('LLM trace retains raw output, parsed intent, provider request ID, and timing', async () => {
  const planner = openAIPlanner({ apiKey: 'trace-secret', model: 'test-model', fetch: async () => {
    const r = response(intent); r.headers.set('x-request-id', 'provider-request-123'); return r;
  } });
  const desk = new Desk(planner); const session = desk.create();
  await desk.chat(session.id, 'Audit Alex');
  const events = session.trace.filter(t => t.name === 'llm_plan');
  assert.equal(events[0].phase, 'start');
  assert.ok(events.some(t => (t.detail as any).rawOutput?.includes('audit')));
  assert.ok(events.some(t => (t.detail as any).intent?.action === 'audit'));
  assert.ok(events.some(t => (t.detail as any).requestId === 'provider-request-123'));
  assert.ok(events.every(t => typeof t.durationMs === 'number'));
  assert.equal(JSON.stringify(events).includes('trace-secret'), false);
});

test('invalid model output explains exact rejected field and remains inspectable after failure', async () => {
  const desk = new Desk(plannerFor({ ...intent, action: 'policy', category: 'meals' }));
  const s = desk.create();
  await assert.rejects(desk.chat(s.id, 'Meals policy'), /use policyCategory/);
  const failure = s.trace.find(t => t.name === 'llm_plan' && t.phase === 'error')!;
  assert.equal((failure.detail as any).stage, 'validation');
  assert.ok((failure.detail as any).correlationId);
  assert.ok(s.trace.some(t => (t.detail as any).rawOutput?.includes('meals')));
  assert.equal(s.history.length, 0);
});

test('read-only policy may echo unchanged current scope without being rejected or mutating it', async () => {
  const desk = new Desk(plannerFor({ ...intent, action: 'policy', employee: 'alex', start: '2026-10-01', end: '2026-10-07', policyCategory: 'lodging' }));
  const s = desk.create(); const before = structuredClone(s.query);
  const result = await desk.chat(s.id, 'Hotel policy');
  assert.match(result.text, /lodging/); assert.deepEqual(s.query, before);
});

test('raw-output traces redact credentials echoed by the provider', async () => {
  const secret = 'credential-test-secret';
  const desk = new Desk(openAIPlanner({ apiKey: secret, model: 'test', fetch: async () => response({ ...intent, expenseId: secret }) }));
  const s = desk.create();
  await assert.rejects(desk.chat(s.id, 'Audit'), /expenseId/);
  assert.equal(JSON.stringify(s.trace).includes(secret), false);
  assert.ok(JSON.stringify(s.trace).includes('[REDACTED]'));
});


test('Only meals receives current scope and conversation, matching the offline result', async () => {
  let providerInput: any;
  const llm = openAIPlanner({ apiKey: 'test-key', model: 'test-model', fetch: async (_url, init) => {
    const payload = JSON.parse(init!.body as string);
    providerInput = JSON.parse(payload.input);
    assert.ok(payload.instructions.includes('A category-only follow-up always uses action audit'));
    return response({ ...intent, category: 'meals' });
  } });
  const desk = new Desk((text, session) => text === 'Only meals' ? llm(text, session) : plan(text));
  const s = desk.create();
  await desk.chat(s.id, 'Audit Blair from 2026-10-01 to 2026-10-09');
  // Sidebar changes are newer than conversation history and must take precedence.
  desk.select(s.id, { employee: 'alex', start: '2026-10-01', end: '2026-10-07', category: 'transport' });
  const result = await desk.chat(s.id, 'Only meals');
  assert.deepEqual(providerInput.scope, { employee: 'alex', start: '2026-10-01', end: '2026-10-07', category: 'transport' });
  assert.equal(providerInput.request, 'Only meals');
  assert.equal(providerInput.recentMessages[0].content, 'Audit Blair from 2026-10-01 to 2026-10-09');
  const offline = new Desk(plan); const other = offline.create();
  offline.select(other.id, providerInput.scope);
  const expected = await offline.chat(other.id, 'Only meals');
  assert.deepEqual(result.query, expected.query);
  assert.deepEqual(result.report, expected.report);
  assert.deepEqual(result.report!.rows.map(r => r.expense.id), ['E101', 'E104', 'E106']);
});


test('Show receipts recovers a model help misclassification and retains selected scope', async () => {
  const desk = new Desk(plannerFor({ ...intent, action: 'help' })); const s = desk.create();
  desk.select(s.id, { employee: 'alex', category: 'meals', start: '2026-10-01', end: '2026-10-07' });
  const before = structuredClone(s.query);
  const result = await desk.chat(s.id, 'Show receipts');
  assert.match(result.text, /E101: present/); assert.match(result.text, /E104: present/); assert.match(result.text, /E106: missing/);
  assert.equal(result.text.includes('I can list expenses'), false);
  assert.deepEqual(s.query, before);
  assert.ok(s.trace.some(t => (t.detail as any).modelIntent?.action === 'help' && (t.detail as any).correctedIntent?.action === 'receipts'));
});

test('help recovery is limited to exact supported commands', async () => {
  const desk = new Desk(plannerFor({ ...intent, action: 'help' })); const s = desk.create();
  const unsupported = await desk.chat(s.id, 'Show receipts and upload them to another service');
  assert.match(unsupported.text, /I can list expenses/); assert.equal(s.report, null);
  const filtered = await desk.chat(s.id, 'Only meals');
  assert.equal(filtered.query.category, 'meals'); assert.equal(filtered.report!.rows.length, 3);
});
