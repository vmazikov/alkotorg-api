// src/routes/product.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();

// Подключаем аутентификацию, чтобы в req.user был текущий пользователь
router.use(authMiddleware);

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

/* ------------------------------------------------------------------
   GET /products/suggest?query=...
-------------------------------------------------------------------*/
router.get('/suggest', async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) return res.json([]);

    const list = await prisma.product.findMany({
      where:  { name: { contains: query, mode: 'insensitive' } },
      select: { name: true },
      take:   10,
    });

    res.json(list.map(x => x.name));
  } catch (err) {
    next(err);
  }
});

export default router;
