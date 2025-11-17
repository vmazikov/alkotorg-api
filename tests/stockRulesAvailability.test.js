import { isAvailableByStockRules } from '../src/utils/stockRules.js';

describe('isAvailableByStockRules', () => {
  const baseRules = [
    { label: 'Нет в наличии', priceMax: 100, stockMax: 5, rank: 1 },
    { label: 'Нет в наличии', priceMax: 200, stockMax: 0, rank: 2 },
  ];

  it('returns false when stock is zero regardless of rules', () => {
    expect(isAvailableByStockRules({ basePrice: 50, stock: 0 }, baseRules)).toBe(false);
  });

  it('filters out products matching no-stock rule', () => {
    const product = { basePrice: 90, stock: 3 };
    expect(isAvailableByStockRules(product, baseRules)).toBe(false);
  });

  it('passes products outside rule ranges', () => {
    const product = { basePrice: 150, stock: 20 };
    expect(isAvailableByStockRules(product, baseRules)).toBe(true);
  });

  it('respects unlimited bounds in rules', () => {
    const rules = [{ label: 'Нет в наличии', priceMax: null, stockMax: 1, rank: 1 }];
    expect(isAvailableByStockRules({ basePrice: 999, stock: 2 }, rules)).toBe(true);
    expect(isAvailableByStockRules({ basePrice: 20, stock: 1 }, rules)).toBe(false);
  });
});
