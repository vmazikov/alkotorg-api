// utils/stockRules.js
import prisma from './prisma.js';

let cached = null;

export async function getStockRules(options = {}) {
  const { forceFresh = false } = options;
  if (!cached || forceFresh) {
    cached = await prisma.stockRule.findMany({ orderBy:{ rank:'asc' } });
  }
  return cached;
}

export function invalidateStockRulesCache() {
  cached = null;
}
