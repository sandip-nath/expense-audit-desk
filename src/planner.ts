import { employees, categories } from './data.ts';
import type { Intent, Query } from './types.ts';
export const help = 'I can list expenses, audit a claim, show exceptions or receipts, explain an expense, and show policy. Try “Audit Alex from 2026-10-01 to 2026-10-07”, then “Only meals”, “Show exceptions”, or “Explain E103”. “All categories” clears the category filter. Use the sidebar to select exact dates and employee.';
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateQuery(query: Query) {
  if (!employees.includes(query.employee) || !validDate(query.start) || !validDate(query.end) || query.start > query.end || (query.category !== null && !categories.includes(query.category))) throw new Error('Choose a valid employee, inclusive date range, and category');
}
// This planner recognizes a documented set of intents; it is not a language model.
export function plan(text: string): Intent {
  const lower = text.toLowerCase().trim();
  const patch: Partial<Query> = {};
  const named = employees.filter(name => new RegExp(`\\b${name}\\b`).test(lower));
  if (named.length > 1) throw new Error('Choose one employee at a time');
  if (named.length) patch.employee = named[0];
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (dates.length === 1) { patch.start = dates[0]; patch.end = dates[0]; }
  else if (dates.length === 2) { patch.start = dates[0]; patch.end = dates[1]; }
  else if (dates.length > 2) throw new Error('Use one date or one start/end pair');
  const matched = categories.filter(c => new RegExp(`\\b${c}\\b`).test(lower));
  if (matched.length > 1) throw new Error('Choose one category or use “all categories”');
  if (/all categories|clear filter/.test(lower)) patch.category = null;
  else if (matched.length) patch.category = matched[0];
  const id = lower.match(/\be\d{3}\b/)?.[0]?.toUpperCase();
  if (/\b(help|hello|hi)\b|what can you/.test(lower)) return { action: 'help', patch: {} };
  if (/policy|limits|rules/.test(lower)) return { action: 'policy', patch: {} };
  if (/explain|details/.test(lower) && id) return { action: 'explain', patch, expenseId: id };
  if (/exceptions|flagged|violations/.test(lower)) return { action: 'exceptions', patch };
  if (/receipt/.test(lower)) return { action: 'receipts', patch };
  if (/list|show expenses|transactions/.test(lower)) return { action: 'list', patch };
  if (/audit|reconcile|total|summary|only|all categories|clear filter|what about|switch/.test(lower) || named.length || dates.length) return { action: 'audit', patch };
  return { action: 'help', patch: {} };
}
