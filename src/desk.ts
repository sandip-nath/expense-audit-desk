import { configuredPlanner, defaultPlannerMode, plannerOptions, plannerModes } from './llm.ts';
import type { Planner, PlannerMode } from './llm.ts';
import { randomUUID } from 'node:crypto';
import { Auditor } from './audit.ts';
import { Gateway } from './tools.ts';
import { help, validateQuery } from './planner.ts';
import type { Session, Query, Report, Row } from './types.ts';
export const money = (minor: number) => '$' + (minor / 100).toFixed(2);
const expenseHeader = 'ID | Date | Merchant | Category | USD | Assessment';
function line(row: Row) { return `${row.expense.id} | ${row.expense.date} | ${row.expense.merchant} | ${row.expense.category} | ${row.usdMinor === null ? 'USD unavailable' : money(row.usdMinor)} | ${row.state}${row.reasons.length ? ': ' + row.reasons.join('; ') : ''}`; }
export class Desk {
  private planner?: Planner;
  private env: NodeJS.ProcessEnv;
  constructor(planner?: Planner, env: NodeJS.ProcessEnv = process.env) { this.planner = planner; this.env = { ...env }; }
  plannerOptions() { return this.planner ? [{ id: 'offline', label: 'Offline', configured: true }] : plannerOptions(this.env); }
  selectPlanner(id: string, mode: PlannerMode) {
    if (this.busy.has(id)) throw new Error('Wait for the current audit');
    const s = this.get(id);
    if (!plannerModes.includes(mode) || !this.plannerOptions().some(option => option.id === mode)) throw new Error('Unknown planner');
    s.plannerMode = mode;
    return { plannerMode: mode, options: this.plannerOptions() };
  }
  auditor = new Auditor();
  sessions = new Map<string, Session>();
  private busy = new Set<string>();
  create() {
    const session: Session = { plannerMode: this.planner ? 'offline' : defaultPlannerMode(this.env), id: randomUUID(), query: { employee: 'alex', start: '2026-10-01', end: '2026-10-07', category: null }, history: [], trace: [], report: null };
    this.sessions.set(session.id, session); return session;
  }
  get(id: string) { const s = this.sessions.get(id); if (!s) throw new Error('Unknown session'); return s; }
  select(id: string, patch: Partial<Query>) {
    if (this.busy.has(id)) throw new Error('Wait for the current audit');
    const s = this.get(id); const query = { ...s.query, ...patch }; validateQuery(query); s.query = query; s.report = null; return s;
  }
  async chat(id: string, text: string) {
    const s = this.get(id);
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Enter 1–2000 characters');
    if (this.busy.has(id)) throw new Error('Wait for the current audit');
    this.busy.add(id);
    try {
      const intent = await (this.planner ?? configuredPlanner(this.env, s.plannerMode))(text, s); const query = { ...s.query, ...intent.patch }; validateQuery(query);
      s.query = query; s.history.push({ role: 'user', content: text });
      const reply = (content: string) => { s.history.push({ role: 'assistant', content }); return { text: content, query: s.query, report: s.report, trace: s.trace }; };
      if (intent.action === 'help') return reply(help);
      if (intent.action === 'policy') {
        const p = await this.auditor.gateway.getPolicy();
        const category = intent.policyCategory;
        const limits = category
          ? `${category} ${money(p.capsUsdMinor[category])} ${category === 'lodging' ? 'per night' : 'per expense'}`
          : `meals ${money(p.capsUsdMinor.meals)} per expense; transport ${money(p.capsUsdMinor.transport)} per expense; lodging ${money(p.capsUsdMinor.lodging)} per night; equipment ${money(p.capsUsdMinor.equipment)} per expense`;
        return reply(`Demo policy ${p.version}: ${limits}. Receipt required at or above ${money(p.receiptRequiredFromUsdMinor)} USD. Limits are inclusive. Eligibility is a policy result, not payment approval.`);
      }
      const report = await this.auditor.run(s.query, s.trace); s.report = report;
      const scope = `${query.employee} | ${query.start} through ${query.end} inclusive | ${query.category ?? 'all categories'}`;
      if (intent.action === 'explain') {
        const row = report.rows.find(r => r.expense.id === intent.expenseId);
        return reply(row ? `${scope}\n${line(row)}\nOriginal: ${row.expense.currency} ${(row.expense.amountMinor/100).toFixed(2)}. Nights: ${row.expense.nights ?? 'n/a'}. Receipt: ${row.receipt.status}. Policy: ${report.policyVersion}.` : `${intent.expenseId} is not in the retrieved expenses for the selected scope.`);
      }
      if (intent.action === 'receipts') return reply(`${scope}\n${report.rows.map(r => `${r.expense.id}: ${r.receipt.status}`).join('\n') || 'No expenses found.'}`);
      if (intent.action === 'list') return reply(`${scope}\n${report.rows.length ? expenseHeader + '\n' + report.rows.map(line).join('\n') : 'No expenses found.'}`);
      if (intent.action === 'exceptions') return reply(`${scope}\n${report.rows.some(r => r.state !== 'eligible') ? expenseHeader + '\n' + report.rows.filter(r => r.state !== 'eligible').map(line).join('\n') : 'No exceptions or pending reviews found.'}`);
      return reply(`${scope}\n${report.rows.length} expenses. Known USD total: ${money(report.knownTotalUsdMinor)}. Policy-eligible: ${money(report.eligibleUsdMinor)}.\n${report.complete ? 'Audit complete.' : 'Audit incomplete: ' + report.warnings.join('; ')}\n${report.rows.length ? expenseHeader + '\n' + report.rows.map(line).join('\n') : 'No expenses found.'}\nThis is an analysis only. No payment or submission was made.`);
    } finally { this.busy.delete(id); }
  }
}
export function csv(report: Report) {
  const cell = (value: unknown) => '"' + String(value).replaceAll('"','""') + '"';
  return [['id','employee','date','category','original_minor','currency','usd_minor','receipt','state','reasons'], ...report.rows.map(r => [r.expense.id,r.expense.employee,r.expense.date,r.expense.category,r.expense.amountMinor,r.expense.currency,r.usdMinor ?? '',r.receipt.status,r.state,r.reasons.join('; ')])].map(row => row.map(cell).join(',')).join('\r\n');
}
