/**
 * Конструирует объект Prisma `where` из query-string.
 * Используется и в /products, и в /filters.
 */
export default function buildWhere(q = {}) {
  const {
    search, priceMin, priceMax, volumes, degree, type,
    brand, wineColor, sweetnessLevel, wineType,
    giftPackaging, excerpt, taste,
    countryOfOrigin, whiskyType,
  } = q;

  const where = { isArchived: false };

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
