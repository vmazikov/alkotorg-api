// src/routes/product.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { Prisma } from '@prisma/client'; 
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();

// Подключаем аутентификацию, чтобы в req.user был текущий пользователь
router.use(authMiddleware);

/* ───────── helpers — объявляем ПЕРЕД маршрутами ───────── */

async function getUserFactor(userId) {
  const u = await prisma.user.findUnique({
    where : { id: userId },
    select: { priceModifier: true },
  });
  return 1 + (u?.priceModifier ?? 0) / 100;
}

function applyPriceModifier(product, factor) {
  const fix = n => +n.toFixed(2);

  const basePrice = product.nonModify
    ? product.basePrice
    : fix(product.basePrice * factor);

  const promos = product.promos?.map(pr => ({
    ...pr,
    promoPrice: product.nonModify ? pr.promoPrice : fix(pr.promoPrice * factor),
  })) ?? [];

  return { ...product, basePrice, promos };
}
/* ------------------------------------------------------------------
   GET /products/suggest?query=...
-------------------------------------------------------------------*/


router.get('/suggest', async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) return res.json([]);

    const rows = await prisma.$queryRaw`
      SELECT id, name, type, "countryOfOrigin"
      FROM "Product"
      WHERE name ILIKE ${'%' + query + '%'}
      ORDER BY POSITION(LOWER(${query}) IN LOWER(name))
      LIMIT 5
    `;
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/search', async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) return res.json([]);

    /* точные id ------------------------------------------------------ */
    const exactIds = await prisma.product.findMany({
      where : { name:{ contains:query, mode:'insensitive'} },
      select: { id:true },
      take  : 50,
    }).then(r => r.map(x => x.id));

    /* похожие id ----------------------------------------------------- */
    const exclude = exactIds.length
      ? Prisma.sql`AND id NOT IN (${Prisma.join(exactIds)})`
      : Prisma.empty;

    const similarIds = await prisma.$queryRaw`
      SELECT id
      FROM "Product"
      WHERE similarity(name, ${query}) > 0.3
        ${exclude}
      ORDER BY similarity(name, ${query}) DESC
      LIMIT 50
    `.then(r => r.map(x => x.id));

    const ids = [...exactIds, ...similarIds];
    if (!ids.length) return res.json([]);

    /* полные карточки + модификатор ------------------------------- */
    const factor   = await getUserFactor(req.user.id);
    const products = await prisma.product.findMany({
      where  : { id:{ in: ids } },
      include: { promos:{ where:{ expiresAt:{ gt:new Date() } } } },
    });

    const map = Object.fromEntries(
      products.map(p => [p.id, applyPriceModifier(p, factor)])
    );

    res.json(ids.map(id => map[id]));
  } catch (e) { next(e); }
});


/* ------------------------------------------------------------------
   GET /products
-------------------------------------------------------------------*/
router.get('/', async (req, res, next) => {
  try {
    const {
      search,
      priceMin,
      priceMax,
      volumes,
      degree,
      sort,
      type,

      // существующие чек-боксы
      brand,
      wineColor,
      sweetnessLevel,
      wineType,
      giftPackaging,
      excerpt,
      taste,

      // НОВЫЕ чек-боксы
      countryOfOrigin,
      whiskyType,
    } = req.query;

    /* 1) модификатор цены пользователя ----------------------------------- */
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { priceModifier: true },
    });
    const factor = 1 + user.priceModifier / 100;

    /* 2) фильтры ----------------------------------------------------------- */
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

    // --- строковые «старые» чек-боксы
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

    // --- НОВЫЕ чек-боксы
    multi('countryOfOrigin', countryOfOrigin);
    multi('whiskyType',      whiskyType);

    /* 3) сортировка -------------------------------------------------------- */
    const orderBy =
      sort === 'name_asc'   ? { name: 'asc' }  :
      sort === 'price_asc'  ? { basePrice: 'asc' }  :
      sort === 'price_desc' ? { basePrice: 'desc' } :
      sort === 'degree_asc' ? { degree: 'asc' } :
      sort === 'degree_desc'? { degree: 'desc' } :
      undefined;

    /* 4) запрос ------------------------------------------------------------ */
    const products = await prisma.product.findMany({
      where,
      orderBy,
      include: {
        promos: {
          where: { expiresAt: { gt: new Date() } },
        },
      },
    });

    /* 5) модифицируем цены -------------------------------------------------- */
    const result = products.map(p => {
      const modifiedBase = p.nonModify
        ? p.basePrice
        : +(p.basePrice * factor).toFixed(2);

      const modifiedPromos = p.promos.map(pr => ({
        ...pr,
        promoPrice: p.nonModify
          ? pr.promoPrice
          : +(pr.promoPrice * factor).toFixed(2),
      }));

      return { ...p, basePrice: modifiedBase, promos: modifiedPromos };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   GET /products/:id
-------------------------------------------------------------------*/
router.get('/:id', async (req, res, next) => {
  try {
    const prodId = +req.params.id;

    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { priceModifier: true },
    });
    const factor = 1 + user.priceModifier / 100;

    const p = await prisma.product.findUnique({
      where: { id: prodId },
      include: {
        promos: {
          where:   { expiresAt: { gt: new Date() } },
          orderBy: { expiresAt: 'desc' },
        },
      },
    });

    if (!p || p.isArchived) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const modifiedBase = p.nonModify
      ? p.basePrice
      : +(p.basePrice * factor).toFixed(2);

    const modifiedPromos = p.promos.map(pr => ({
      ...pr,
      promoPrice: p.nonModify
        ? pr.promoPrice
        : +(pr.promoPrice * factor).toFixed(2),
    }));

    const product = {
      id:             p.id,
      productId:      p.productId,
      article:        p.article,
      name:           p.name,
      brand:          p.brand,
      type:           p.type,
      volume:         p.volume,
      degree:         p.degree,
      quantityInBox:  p.quantityInBox,
      basePrice:      modifiedBase,
      img:            p.img,
      stock:          p.stock,
      nonModify:      p.nonModify,
      isArchived:     p.isArchived,

      // атрибуты
      countryOfOrigin: p.countryOfOrigin,
      whiskyType:      p.whiskyType,
      wineColor:       p.wineColor,
      sweetnessLevel:  p.sweetnessLevel,
      wineType:        p.wineType,
      giftPackaging:   p.giftPackaging,
      manufacturer:    p.manufacturer,
      excerpt:         p.excerpt,
      rawMaterials:    p.rawMaterials,
      taste:           p.taste,
      description:     p.description,

      promos:         modifiedPromos,
      createdAt:      p.createdAt,
    };

    res.json(product);
  } catch (err) {
    next(err);
  }
});



export default router;
