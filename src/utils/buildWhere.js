// src/utils/buildWhere.js
import { getStockRules } from './stockRules.js';

/**
 * Конструирует объект Prisma `where` из query-string.
 * Используется в /products и /filters.
 *
 * ⚠️  Начиная с этой версии — **async**:
 *      const where = await buildWhere(req.query);
 */
export default async function buildWhere(q = {}) {
  const {
    /* базовые фильтры */
    search, priceMin, priceMax, volumes, degree, type,

    /* чекбоксы */
    brand, wineColor, sweetnessLevel, wineType,
    giftPackaging, excerpt, taste,
    countryOfOrigin, whiskyType,

    /* «только в наличии» */
    inStockOnly,
  } = q;

  /* всегда исключаем архив */
  const where = { isArchived: false };

  /* ───────── 1. «Только в наличии» по правилам StockRule ───────── */
  if (inStockOnly === '1' || inStockOnly === 'true' || inStockOnly === true) {
    const rules = await getStockRules();
    console.log('Stock rules:', rules);
    const noRules = rules
      .filter(r => r.label === 'Нет в наличии')
      .sort((a, b) => a.rank - b.rank);

    const notArr = noRules.map(r => {
      const cond = {};
      if (r.priceMax != null)  cond.basePrice = { lt: r.priceMax };
      if (r.stockMax != null)  cond.stock     = { lte: r.stockMax };
      return cond;
    });

    /* + всегда stock == 0 */
    notArr.push({ stock: 0 });

    /* если правил нет — fallback, но через тот же OR */
    where.NOT = { OR: notArr.length ? notArr : [{ stock: 0 }] };
  }

  /* ───────── 2. Простые фильтры ───────── */
  if (type)   where.type   = type;
  if (search) where.name   = { contains: search, mode: 'insensitive' };

  if (priceMin) where.basePrice = { gte: +priceMin };
  if (priceMax) where.basePrice = { ...(where.basePrice || {}), lte: +priceMax };

  if (degree)   where.degree = { gte: +degree };

  if (volumes) {
    const vols = Array.isArray(volumes) ? volumes : [volumes];
    where.volume = { in: vols.map(Number) };
  }

  const multi = (field, value) => {
    if (!value) return;
    where[field] = {
      in: Array.isArray(value) ? value : [value],
      mode: 'insensitive',
    };
  };

  multi('brand',           brand);
  multi('wineColor',       wineColor);
  multi('sweetnessLevel',  sweetnessLevel);
  multi('wineType',        wineType);
  multi('giftPackaging',   giftPackaging);
  multi('excerpt',         excerpt);
  multi('taste',           taste);
  multi('countryOfOrigin', countryOfOrigin);
  multi('whiskyType',      whiskyType);

  return where;
}
