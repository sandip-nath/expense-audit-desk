import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Desk, csv } from './desk.ts';
export function makeServer(desk = new Desk()) {
  const server = createServer(async (req, res) => {
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url!, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(new URL('../public/index.html', import.meta.url))); return; }
      if (req.method === 'GET' && url.pathname === '/api/planners') { const s = desk.get(url.searchParams.get('sessionId') ?? ''); send(200, { plannerMode: s.plannerMode, options: desk.plannerOptions() }); return; }
      if (req.method === 'GET' && url.pathname === '/api/controls') { send(200, { ...desk.auditor.gateway.faults, pageSize: desk.auditor.gateway.pageSize }); return; }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        const report = desk.get(url.searchParams.get('sessionId') ?? '').report;
        if (!report) { send(409, { error: 'Run an audit before exporting' }); return; }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="expense-audit.csv"' }); res.end(csv(report)); return;
      }
      if (req.method !== 'POST') { send(404, { error: 'Not found' }); return; }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 12000) { send(413, { error: 'Request too large' }); return; } }
      const body = raw ? JSON.parse(raw) : {};
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
      if (url.pathname === '/api/session') { send(200, desk.create()); return; }
      if (url.pathname === '/api/planner') { send(200, desk.selectPlanner(body.sessionId, body.plannerMode)); return; }
      if (url.pathname === '/api/select') {
        if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch) || Object.keys(body.patch).some(key => !['employee','start','end','category'].includes(key))) throw new Error('Invalid selection');
        send(200, desk.select(body.sessionId, body.patch)); return;
      }
      if (url.pathname === '/api/controls') {
        for (const [key,value] of Object.entries(body)) {
          if (!['receiptDown','fxDown','pageSize'].includes(key) || (key === 'pageSize' ? ![2,3,50].includes(value as number) : typeof value !== 'boolean')) throw new Error('Invalid controls');
        }
        if (body.pageSize !== undefined) desk.auditor.gateway.pageSize = body.pageSize;
        if (body.receiptDown !== undefined) desk.auditor.gateway.faults.receiptDown = body.receiptDown;
        if (body.fxDown !== undefined) desk.auditor.gateway.faults.fxDown = body.fxDown;
        send(200, { ...desk.auditor.gateway.faults, pageSize: desk.auditor.gateway.pageSize }); return;
      }
      if (url.pathname === '/api/chat') {
        const s = desk.get(body.sessionId);
        try { send(200, await desk.chat(s.id, body.message)); }
        catch (error) { send(400, { error: (error as Error).message, query: s.query, report: s.report, trace: s.trace }); }
        return;
      }
      send(404, { error: 'Not found' });
    } catch (error) { send(400, { error: (error as Error).message }); }
  });
  return { desk, server };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4321);
  makeServer().server.listen(port, '127.0.0.1', () => console.log(`Expense Audit Desk: http://localhost:${port}\n${process.env.PLANNER_MODE ?? 'offline'} intent planner; expense services and records are fictional.\nCtrl+C to stop.`));
}
