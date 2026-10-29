import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../src/server.ts';
test('browser API supports chat, controls, scoped reports, and CSV export', async () => {
  const { server } = makeServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
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
