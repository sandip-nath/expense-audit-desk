import type { Expense, Policy, Rate } from './types.ts';
export const employees = ['alex', 'blair'];
export const categories = ['meals', 'transport', 'lodging', 'equipment'] as const;
export const expenses: Expense[] = [
  { id: 'E101', employee: 'alex', date: '2026-10-01', merchant: 'Harbor Cafe', category: 'meals', amountMinor: 2200, currency: 'USD' },
  { id: 'E102', employee: 'alex', date: '2026-10-02', merchant: 'Central Taxi', category: 'transport', amountMinor: 4500, currency: 'EUR' },
  { id: 'E103', employee: 'alex', date: '2026-10-03', merchant: 'Union Hotel', category: 'lodging', amountMinor: 48000, currency: 'USD', nights: 3 },
  { id: 'E104', employee: 'alex', date: '2026-10-04', merchant: 'Market Bistro', category: 'meals', amountMinor: 6000, currency: 'GBP' },
  { id: 'E105', employee: 'alex', date: '2026-10-05', merchant: 'Office Supply Co', category: 'equipment', amountMinor: 12000, currency: 'USD' },
  { id: 'E106', employee: 'alex', date: '2026-10-07', merchant: 'Airport Deli', category: 'meals', amountMinor: 1800, currency: 'USD' },
  { id: 'E107', employee: 'alex', date: '2026-10-08', merchant: 'City Rail', category: 'transport', amountMinor: 1200, currency: 'USD' },
  { id: 'E201', employee: 'blair', date: '2026-10-02', merchant: 'Riverside Hotel', category: 'lodging', amountMinor: 30000, currency: 'EUR', nights: 2 },
  { id: 'E202', employee: 'blair', date: '2026-10-06', merchant: 'Team Lunch', category: 'meals', amountMinor: 5000, currency: 'USD' },
];
export const missingReceipts = new Set(['E105', 'E106']);
export const rates: Record<string, Rate> = {
  USD: { currency: 'USD', numerator: 1, denominator: 1, meaning: 'USD major units per source major unit' },
  EUR: { currency: 'EUR', numerator: 6, denominator: 5, meaning: 'USD major units per source major unit' },
  GBP: { currency: 'GBP', numerator: 5, denominator: 4, meaning: 'USD major units per source major unit' },
};
export const policy: Policy = {
  version: 'DEMO-2026-10', capsUsdMinor: { meals: 6000, transport: 10000, lodging: 20000, equipment: 100000 },
  receiptRequiredFromUsdMinor: 2500, lodgingCapBasis: 'per-night',
};
