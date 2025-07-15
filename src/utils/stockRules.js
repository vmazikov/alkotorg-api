// utils/stockRules.js
import prisma from './prisma.js';
let cached = null;

export async function getStockRules() {
  if (cached) return cached;
  cached = await prisma.stockRule.findMany({ orderBy:{ rank:'asc' } });
  return cached;
}
