import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Desk } from './desk.ts';
const desk = new Desk(); let s = desk.create();
const rl = createInterface({ input: stdin, output: stdout });
console.log('Expense Audit Desk\nTry: Audit Alex from 2026-10-01 to 2026-10-07\n/new /trace /page 2|3|50 /fault receipt|fx on|off /quit');
try {
  while (true) {
    const text = (await rl.question(`\n${s.query.employee}/${s.query.category ?? 'all'}> `)).trim();
    if (!text) continue;
    if (text === '/quit') break;
    if (text === '/new') { s = desk.create(); console.log('New conversation.'); continue; }
    if (text === '/trace') { console.log(JSON.stringify(s.trace, null, 2)); continue; }
    if (text.startsWith('/page ')) { const size = Number(text.split(' ')[1]); if (![2,3,50].includes(size)) { console.log('Use /page 2|3|50'); continue; } desk.auditor.gateway.pageSize = size; console.log('Page size updated.'); continue; }
    if (text.startsWith('/fault ')) { const [,name,state] = text.split(' '); if (!['receipt','fx'].includes(name) || !['on','off'].includes(state)) { console.log('Use /fault receipt|fx on|off'); continue; } desk.auditor.gateway.faults[name === 'receipt' ? 'receiptDown' : 'fxDown'] = state === 'on'; console.log('Fault updated.'); continue; }
    try { console.log((await desk.chat(s.id, text)).text); } catch (error) { console.log(`Error: ${(error as Error).message}`); }
  }
} finally { rl.close(); }
