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

const isNoStockRule = rule => (rule?.label || '').toLowerCase() === 'нет в наличии';

function ruleMatchesProduct(rule, product) {
  const priceOk = rule.priceMax == null || product.basePrice < rule.priceMax;
  const stockOk = rule.stockMax == null || product.stock <= rule.stockMax;
  return priceOk && stockOk;
}

/**
 * Возвращает true, если товар считается «в наличии» по правилам стока.
 * Логика совпадает с фильтром inStockOnly в buildWhere.
 */
export function isAvailableByStockRules(product, rules) {
  if (!product || product.stock <= 0) return false;
  const noRules = (rules || []).filter(isNoStockRule).sort((a, b) => a.rank - b.rank);
  return !noRules.some(rule => ruleMatchesProduct(rule, product));
}
