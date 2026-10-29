import { expenses, missingReceipts, rates, policy, employees, categories } from './data.ts';
import type { Query, Expense, Receipt, Rate, Policy } from './types.ts';
export class Gateway {
  faults = { receiptDown: false, fxDown: false };
  pageSize = 2;
  calls: { name: string; args: unknown }[] = [];
  private async begin(name: string, args: unknown) {
    this.calls.push({ name, args: structuredClone(args) });
    await new Promise(resolve => setTimeout(resolve, name === 'receipt' ? 12 : 4));
  }
  async listExpenses(query: Query, cursor: string | null = null): Promise<{ items: Expense[]; nextCursor: string | null }> {
    await this.begin('list_expenses', { query, cursor, pageSize: this.pageSize });
    if (!employees.includes(query.employee)) throw new Error('Unknown employee');
    if (query.category && !categories.includes(query.category)) throw new Error('Unknown category');
    const items = expenses.filter(e => e.employee === query.employee && e.date >= query.start && e.date <= query.end && (!query.category || e.category === query.category));
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid page cursor');
    return { items: structuredClone(items.slice(offset, offset + this.pageSize)), nextCursor: offset + this.pageSize < items.length ? String(offset + this.pageSize) : null };
  }
  async receipt(id: string): Promise<Receipt> {
    await this.begin('receipt', { id });
    if (this.faults.receiptDown) throw new Error('Receipt service unavailable');
    if (!expenses.some(e => e.id === id)) throw new Error('Unknown expense');
    return missingReceipts.has(id) ? { status: 'missing' } : { status: 'present', reference: `receipt://${id}` };
  }
  async rate(currency: string): Promise<Rate> {
    await this.begin('fx_rate', { currency });
    if (this.faults.fxDown && currency !== 'USD') throw new Error('FX service unavailable');
    if (!rates[currency]) throw new Error('Unsupported currency');
    return structuredClone(rates[currency]);
  }
  async getPolicy(): Promise<Policy> { await this.begin('policy', {}); return structuredClone(policy); }
}
