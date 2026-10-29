import { Gateway } from './tools.ts';
import type { Query, Expense, Policy, Rate, Receipt, Row, Report, Trace } from './types.ts';
export function toUsdMinor(amountMinor: number, rate: Rate): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isSafeInteger(rate.numerator) || rate.numerator <= 0 || !Number.isSafeInteger(rate.denominator) || rate.denominator <= 0) throw new Error('Invalid monetary input');
  // Integer arithmetic keeps half-cent ties exact even for large safe inputs.
  const numerator = BigInt(amountMinor) * BigInt(rate.numerator);
  const denominator = BigInt(rate.denominator);
  const rounded = (2n * numerator + denominator) / (2n * denominator);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('USD amount exceeds safe integer range');
  return Number(rounded);
}
export function classify(expense: Expense, usdMinor: number | null, receipt: Receipt, policy: Policy): Row {
  const reasons: string[] = [];
  if (usdMinor === null) return { expense, usdMinor, receipt, state: 'needs-review', reasons: ['USD amount unavailable; cannot complete policy check'] };
  const invalidNights = expense.category === 'lodging' && (!Number.isSafeInteger(expense.nights) || expense.nights! <= 0);
  const cap = policy.capsUsdMinor[expense.category] * (expense.category === 'lodging' && !invalidNights ? expense.nights! : 1);
  if (!invalidNights && usdMinor > cap) reasons.push(`Over ${expense.category} limit`);
  if (usdMinor >= policy.receiptRequiredFromUsdMinor && receipt.status === 'missing') reasons.push('Required receipt missing');
  const violation = reasons.length > 0;
  if (invalidNights) reasons.push('Valid lodging nights unavailable; needs review');
  if (usdMinor >= policy.receiptRequiredFromUsdMinor && receipt.status === 'unavailable') reasons.push('Required receipt unavailable; needs review');
  return { expense, usdMinor, receipt, state: violation ? 'exception' : reasons.length ? 'needs-review' : 'eligible', reasons };
}
export class Auditor {
  gateway: Gateway;
  constructor(gateway = new Gateway()) { this.gateway = gateway; }
  async run(query: Query, trace: Trace[]): Promise<Report> {
    const tool = async <T>(name: string, args: unknown, work: () => Promise<T>): Promise<T> => {
      const start = performance.now(); trace.push({ at: Date.now(), name, phase: 'start', detail: args });
      try { const value = await work(); trace.push({ at: Date.now(), name, phase: 'result', detail: value, durationMs: performance.now() - start }); return value; }
      catch (error) { trace.push({ at: Date.now(), name, phase: 'error', detail: String(error), durationMs: performance.now() - start }); throw error; }
    };
    const warnings: string[] = [];
    const collect = async () => {
      const items = new Map<string, Expense>();
      const seen = new Set<string>();
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
        let page;
        try { page = await tool('list_expenses', { ...query, cursor }, () => this.gateway.listExpenses(query, cursor)); }
        catch (error) {
          if (pageNumber === 0) throw error;
          warnings.push('Expense collection incomplete: ' + String(error));
          return [...items.values()];
        }
        for (const expense of page.items) if (!items.has(expense.id)) items.set(expense.id, expense);
        if (page.nextCursor === null) return [...items.values()];
        if (seen.has(page.nextCursor)) {
          warnings.push('Expense collection incomplete: repeated page cursor');
          return [...items.values()];
        }
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      warnings.push('Expense collection incomplete: page limit reached');
      return [...items.values()];
    };
    const [items, policy] = await Promise.all([
      collect(),
      tool('policy', {}, () => this.gateway.getPolicy()),
    ]);
    const currencyRates = new Map<string, Rate | null>();
    await Promise.all([...new Set(items.map(e => e.currency))].map(async currency => {
      try { currencyRates.set(currency, await tool('fx_rate', { currency }, () => this.gateway.rate(currency))); }
      catch { currencyRates.set(currency, null); warnings.push(`${currency} conversion unavailable`); }
    }));
    const rows = await Promise.all(items.map(async expense => {
      let receipt: Receipt;
      try { receipt = await tool('receipt', { id: expense.id }, () => this.gateway.receipt(expense.id)); }
      catch { receipt = { status: 'unavailable' }; warnings.push(`Receipt lookup unavailable for ${expense.id}`); }
      const rate = currencyRates.get(expense.currency);
      const usdMinor = rate ? toUsdMinor(expense.amountMinor, rate) : null;
      return classify(expense, usdMinor, receipt, policy);
    }));
    return {
      query: structuredClone(query), rows,
      knownTotalUsdMinor: rows.reduce((sum, row) => sum + (row.usdMinor ?? 0), 0),
      eligibleUsdMinor: rows.filter(row => row.state === 'eligible').reduce((sum, row) => sum + row.usdMinor!, 0),
      complete: !warnings.length, warnings, policyVersion: policy.version,
    };
  }
}
