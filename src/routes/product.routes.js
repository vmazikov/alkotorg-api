// src/routes/product.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { Prisma } from '@prisma/client'; 
import { authMiddleware } from '../middlewares/auth.js';
import buildWhere from '../utils/buildWhere.js';   // ← добавили
import { makeNextCursor, buildWhereAfter } from '../utils/buildNextCursor.js';

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
   GET /products   —  курсорная пагинация + фильтры + модификация цен
   Пример запроса:
     /products?type=whisky&priceMax=50&limit=50
     /products?limit=50&cursor=1234          ← подгрузка следующей страницы
-------------------------------------------------------------------*/
router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    /* ────────── query-string ------------------------------------------------ */
    const {
      /* пагинация */
      limit  = 50,          // сколько карточек вернуть за раз
      cursor,               // id последней карточки предыдущей страницы

      /* фильтры */
      search, priceMin, priceMax, volumes, degree, sort, type,

      // «старые» чек-боксы
      brand, wineColor, sweetnessLevel, wineType,
      giftPackaging, excerpt, taste,

      // новые чек-боксы
      countryOfOrigin, whiskyType,
    } = req.query;

    /* ────────── модификатор цены пользователя ------------------------------ */
    const factor = await getUserFactor(req.user.id);   // helper из файла выше

    /* ────────── WHERE ------------------------------------------------------ */
    const where = buildWhere(req.query);

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

    /* чек-боксы */
    multi('brand',           brand);
    multi('wineColor',       wineColor);
    multi('sweetnessLevel',  sweetnessLevel);
    multi('wineType',        wineType);
    multi('giftPackaging',   giftPackaging);
    multi('excerpt',         excerpt);
    multi('taste',           taste);
    multi('countryOfOrigin', countryOfOrigin);
    multi('whiskyType',      whiskyType);

    /* ────────── ORDER BY --------------------------------------------------- */
    const orderBySpecific =
      sort === 'name_asc'    ? { name: 'asc' }  :
      sort === 'price_asc'   ? { basePrice: 'asc' }  :
      sort === 'price_desc'  ? { basePrice: 'desc' } :
      sort === 'degree_asc'  ? { degree: 'asc' } :
      sort === 'degree_desc' ? { degree: 'desc' } :
      undefined;

      /* ---------- key-set pagination ---------- */
      let cursorObj = null;
      try { 
        if (cursor) cursorObj = JSON.parse(cursor); 
        if (cursorObj?.id)       cursorObj.id       = +cursorObj.id;
        if (cursorObj?.degree)   cursorObj.degree   = +cursorObj.degree;
        if (cursorObj?.basePrice)cursorObj.basePrice= +cursorObj.basePrice;
        if (cursorObj?.name)     cursorObj.name     = String(cursorObj.name); // на всяк.
      } catch { 
        cursorObj = null; 
      }
      const afterWhere = buildWhereAfter(cursorObj, sort, Prisma);

      const products = await prisma.product.findMany({
        where: { ...where, ...afterWhere },
        orderBy: [
          ...(orderBySpecific ? [orderBySpecific] : []),
          { id: 'asc' },
        ],
        take: +limit,
        include: {
          promos: { where: { expiresAt: { gt: new Date() } } },
        },
      });

    /* ────────── модифицируем цены ----------------------------------------- */
    const items = products.map(p => applyPriceModifier(p, factor));

    /* ────────── курсор следующей страницы --------------------------------- */
    // если есть следующая страница — сериализуем курсор в JSON
    const nextCursorObj = items.length === +limit
      ? makeNextCursor(items.at(-1), sort)
      : null;
    const nextCursor = nextCursorObj
      ? JSON.stringify(nextCursorObj)
      : null;
    res.json({ items, nextCursor });
  } catch (err) {
    next(err);
  }
});


router.get('/:id/related', async (req, res, next) => {
  try {
    const prodId = Number(req.params.id);
    const limit  = Number(req.query.limit ?? 10);

    /* ────────────────── 1. базовый товар ────────────────── */
    const base = await prisma.product.findUnique({
      where : { id: prodId },
      select: {
        name: true,
        brand: true,
        type: true,
        basePrice: true,
        productVolumeId: true,
      },
    });
    if (!base) return res.status(404).json({ error: 'Product not found' });

    const {
      name:            baseName,
      brand:           baseBrand,      // может быть null
      type:            baseType,       // может быть null
      basePrice,
      productVolumeId: baseVolId,      // может быть null
    } = base;

    /* ────────────────── 2. SQL-фрагменты для score ────────────────── */
    const brandScore = baseBrand
      ? Prisma.sql`(CASE WHEN p.brand ILIKE ${baseBrand} THEN 2 ELSE 0 END)`
      : Prisma.sql`0`;

    const typeScore = baseType
      ? Prisma.sql`(CASE WHEN p.type ILIKE ${baseType} THEN 1 ELSE 0 END)`
      : Prisma.sql`0`;

    const volScore = baseVolId
      ? Prisma.sql`(CASE WHEN p."productVolumeId" = ${baseVolId} THEN 1 ELSE 0 END)`
      : Prisma.sql`0`;

    const priceScore = Prisma.sql`
      GREATEST(0, 1 - ABS(p."basePrice" - ${basePrice}) / 200.0)
    `;                                                             // 0–1

    const nameScore  = Prisma.sql`
      similarity(p.name, ${baseName})
    `;                                                             // 0–1

    /* ────────────────── 3. выборка кандидатов x3 от лимита ────────────────── */
    const candidates = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          p.id,
          (${brandScore} + ${typeScore} + ${volScore} +
           ${priceScore} + ${nameScore}) AS score
        FROM "Product" p
        WHERE p."isArchived" = false
          AND p.id <> ${prodId}
        ORDER BY score DESC,
                 ABS(p."basePrice" - ${basePrice}) ASC
        LIMIT ${limit * 3}
      `
    );

    if (!candidates.length) return res.json([]);

    /* ────────────────── 4. карточки в исходном порядке ────────────────── */
    const ids = candidates.map(c => c.id).slice(0, limit);

    const products = await prisma.product.findMany({
      where  : { id: { in: ids } },
      include: { promos: { where: { expiresAt: { gt: new Date() } } } },
    });

    const byId   = new Map(products.map(p => [p.id, p]));
    const sorted = ids.map(id => byId.get(id)).filter(Boolean);

    /* ────────────────── 5. модификация цен под пользователя ────────────────── */
    const factor   = await getUserFactor(req.user.id);
    const related  = sorted.map(p => applyPriceModifier(p, factor));

    res.json(related);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   ЛОГИКА «недавно смотрели / уже заказывали»
   ──────────────────────────────────────────────────────────────────
   POST /products/:id/view
   GET  /products/recent?limit=10
   GET  /products/ordered?limit=10&exclude=1,2,3
-------------------------------------------------------------------*/
/* ---------- 1. логируем просмотр товара ------------------------ */
router.post('/:id/view', async (req, res, next) => {
  try {
    await prisma.productView.upsert({
      where : {
        userId_productId: {
          userId:   req.user.id,
          productId: +req.params.id,
        },
      },
      create: { userId: req.user.id, productId: +req.params.id },
      update: { viewedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- 2. последние просмотренные ------------------------ */
router.get('/recent', async (req, res, next) => {
  try {
    const limit = +(req.query.limit || 10);

    /* берём id последних просмотренных товаров */
    const rows = await prisma.productView.findMany({
      where:  { userId: req.user.id },
      orderBy:{ viewedAt: 'desc' },
      take:    limit,
      select: { productId: true },
    });
    const ids = rows.map(r => r.productId);
    if (!ids.length) return res.json([]);

    /* загружаем карточки в том же порядке */
    const factor   = await getUserFactor(req.user.id);
    const products = await prisma.product.findMany({
      where: {
        id: { in: ids },
        isArchived: false,
        stock: { gt: 0 },
      },
      include: {
        promos: { where:{ expiresAt:{ gt:new Date() } } },
      },
    });

    const byId = new Map(
      products.map(p => [p.id, applyPriceModifier(p, factor)])
    );
    res.json(ids.map(id => byId.get(id)).filter(Boolean));
  } catch (e) { next(e); }
});

/* ---------- 3. уже заказывали --------------------------------- */
router.get('/ordered', async (req, res, next) => {
  try {
    const limit   = +(req.query.limit || 10);
    const exclude = (req.query.exclude ?? '')
      .split(',')
      .map(Number)
      .filter(Boolean);

    /* уникальные productId + дата последнего заказа */
    const orderedRows = await prisma.$queryRaw`
      SELECT
        oi."productId",
        MAX(o."createdAt") AS last_order
      FROM "OrderItem" oi
      JOIN "Order"      o ON o.id = oi."orderId"
      WHERE o."userId" = ${req.user.id}
      GROUP BY oi."productId"
      ORDER BY last_order DESC
      LIMIT ${limit * 3}
    `;
    const orderedIds = orderedRows.map(r => r.productId);

    /* убираем «что уже в корзине» или передали в exclude */
    const ids = orderedIds
      .filter(id => !exclude.includes(id))
      .slice(0, limit);
    if (!ids.length) return res.json([]);

    /* карточки + модификатор цены */
    const factor   = await getUserFactor(req.user.id);
    const products = await prisma.product.findMany({
      where: {
        id: { in: ids },
        isArchived: false,
        stock: { gt: 0 },
      },
      include: {
        promos: { where:{ expiresAt:{ gt:new Date() } } },
      },
    });

    const byId = new Map(
      products.map(p => [p.id, applyPriceModifier(p, factor)])
    );
    res.json(ids.map(id => byId.get(id)).filter(Boolean));
  } catch (e) { next(e); }
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
      productVolumeId: p.productVolumeId,
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
      tasteProduct:    p.tasteProduct,
      aromaProduct:    p.aromaProduct,
      colorProduct:    p.colorProduct,
      combinationsProduct: p.сombinationsProduct,
      region:          p.region,
      whiskyType:      p.whiskyType,
      excerpt:         p.excerpt,
      isNew:           p.isNew,
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
   GET /products/volume/:productVolumeId
   Возвращает все товары с тем же productVolumeId (кроме архивных)
-------------------------------------------------------------------*/
router.get('/volume/:volumeId', async (req, res, next) => {
  try {
  const volumeId = String(req.params.volumeId).trim(); // ✅ строка
    if (!volumeId) return res.json([]);

    const rows = await prisma.product.findMany({
      where: {
        productVolumeId: volumeId,
        isArchived: false,
      },
      select: {
        id: true, volume: true, stock: true, basePrice: true,
      },
      orderBy: { volume: 'asc' },
    });

    res.json(rows);
  } catch (e) { next(e); }
});




export default router;
