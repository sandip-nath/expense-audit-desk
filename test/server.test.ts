import { Desk } from '../src/desk.ts';
import { plan } from '../src/planner.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../src/server.ts';
test('browser API supports chat, controls, scoped reports, and CSV export', async () => {
  const { server } = makeServer(new Desk(plan)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = async (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.match(await (await fetch(base)).text(), /Expense Audit Desk/);
    const s = await (await post('/api/session', {})).json() as any;
    const absent = await fetch(base + '/api/export?sessionId=' + s.id); assert.equal(absent.status, 409);
    const chat = await post('/api/chat', { sessionId: s.id, message: 'Audit Alex' }); assert.equal(chat.status, 200);
    const r = await chat.json() as any; assert.ok(r.report.rows.length); assert.ok(r.trace.length);
    const csv = await fetch(base + '/api/export?sessionId=' + s.id); assert.equal(csv.status, 200); assert.match(await csv.text(), /E101/);
    assert.equal((await post('/api/controls', { receiptDown: true, pageSize: 50 })).status, 200);
    assert.equal((await post('/api/controls', { receiptDown: 'yes' })).status, 400);
    assert.equal((await post('/api/select', { sessionId: s.id, patch: { employee: 'blair' } })).status, 200);
    const controls = await (await fetch(base + '/api/controls')).json() as any; assert.equal(controls.receiptDown, true);
    assert.equal((await post('/api/chat', { sessionId: 'wrong', message: 'Audit' })).status, 400);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});


test('browser adapter API defaults offline and keeps selections isolated without exposing credentials', async () => {
  const desk = new Desk(undefined, { OPENAI_API_KEY: 'server-secret' });
  const { server } = makeServer(desk); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = async (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const a = await (await post('/api/session', {})).json() as any;
    const b = await (await post('/api/session', {})).json() as any;
    assert.equal(a.plannerMode, 'offline');
    const options = await (await fetch(base + '/api/planners?sessionId=' + a.id)).json() as any;
    assert.deepEqual(options.options.map((o: any) => o.id), ['openai', 'offline']);
    assert.equal(JSON.stringify(options).includes('server-secret'), false);
    assert.equal((await post('/api/chat', { sessionId: a.id, message: 'Audit' })).status, 200);
    assert.equal((await post('/api/planner', { sessionId: a.id, plannerMode: 'openai' })).status, 200);
    assert.equal((await post('/api/chat', { sessionId: a.id, message: 'Audit' })).status, 400);
    assert.equal((await post('/api/planner', { sessionId: a.id, plannerMode: 'offline' })).status, 200);
    assert.equal((await post('/api/chat', { sessionId: a.id, message: 'Audit Alex' })).status, 200);
    assert.equal(desk.get(b.id).plannerMode, 'offline');
    assert.equal((await post('/api/planner', { sessionId: a.id, plannerMode: 'unknown' })).status, 400);
    const html = await (await fetch(base)).text();
    assert.match(html, /id="plannerMode"/); assert.match(html, /value="offline" selected/);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
