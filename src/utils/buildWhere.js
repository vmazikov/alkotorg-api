/**
 * Конструирует объект Prisma `where` из query-string.
 * Используется и в /products, и в /filters.
 */
export default function buildWhere(q = {}) {
  const {
    search, priceMin, priceMax, volumes, degree, type,
    brand, wineColor, sweetnessLevel, wineType,
    giftPackaging, excerpt, taste,
    countryOfOrigin, whiskyType, inStockOnly,
  } = q;

  const where = { isArchived: false };

  /* ---------- «только в наличии» (правила как в getStockStatus) ---------- */
  if (inStockOnly === '1' || inStockOnly === true) {
    where.NOT = [
      { stock: 0 },
      { AND: [ { basePrice: { lt: 100 } }, { stock: { lte: 50 } } ] },
      { AND: [ { basePrice: { lt: 500 } }, { stock: { lte: 30 } } ] },
      { AND: [ { basePrice: { lt: 1000 } }, { stock: { lte: 10 } } ] },
    ];
  }

  if (type)     where.type   = type;
  if (search)   where.name   = { contains: search, mode: 'insensitive' };

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
