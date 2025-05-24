import { Router } from 'express';
import prisma          from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import buildWhere      from '../utils/buildWhere.js'; // тот же, что для каталога

const router = Router();
router.use(authMiddleware); // все вызовы – только для авторизованных

/* ───────── helpers ───────── */
async function getUserFactor(userId) {
  const { priceModifier = 0 } = await prisma.user.findUnique({
    where:  { id: userId },
    select: { priceModifier: true },
  }) ?? {};
  return 1 + priceModifier / 100;
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

/* ───────── POST /favorites  { productId } ───────── */
router.post('/', async (req, res, next) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });

    await prisma.favorite.upsert({
      where   : { userId_productId: { userId: req.user.id, productId } },
      update  : {},         // ничего, уже есть – ничего не меняем
      create  : { userId: req.user.id, productId },
    });

    res.status(204).end();
  } catch (e) { next(e); }
});

/* ───────── DELETE /favorites/:productId ───────── */
router.delete('/:productId', async (req, res, next) => {
  try {
    await prisma.favorite.delete({
      where: { userId_productId: { userId: req.user.id, productId: +req.params.productId } },
    }).catch(() => {});     // если не было – просто игнорируем
    res.status(204).end();
  } catch (e) { next(e); }
});

/* ───────── GET /favorites  (как каталог) ───────── */
router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');

    /* ---------- query ---------- */
    const {
      limit = 50, cursor,
      /* фильтры/сортировка такие же, как в /products */
      search, priceMin, priceMax, volumes, degree, sort, type,
      brand, wineColor, sweetnessLevel, wineType,
      giftPackaging, excerpt, taste, countryOfOrigin, whiskyType,
    } = req.query;

    /* ---------- ids избранного ---------- */
    const favIds = await prisma.favorite.findMany({
      where : { userId: req.user.id },
      select: { productId: true },
    }).then(r => r.map(x => x.productId));

    if (!favIds.length) {
      return res.json({ items: [], nextCursor: null });
    }

    /* ---------- where ---------- */
    const where = buildWhere(req.query);
    where.id = { in: favIds };          // ограничиваем избранным

    if (type)   where.type = type;
    if (search) where.name = { contains: search, mode:'insensitive' };

    if (priceMin) where.basePrice = { gte: +priceMin };
    if (priceMax) where.basePrice = { ...(where.basePrice||{}), lte:+priceMax };
    if (degree)   where.degree    = { gte: +degree };

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

    /* ---------- orderBy ---------- */
    const orderBySpecific =
      sort === 'name_asc'    ? { name: 'asc' }  :
      sort === 'price_asc'   ? { basePrice: 'asc' }  :
      sort === 'price_desc'  ? { basePrice: 'desc' } :
      sort === 'degree_asc'  ? { degree: 'asc' } :
      sort === 'degree_desc' ? { degree: 'desc' } :
      undefined;

    /* ---------- запрос ---------- */
    const products = await prisma.product.findMany({
      where,
      orderBy: [
        ...(orderBySpecific ? [orderBySpecific] : []),
        { id: 'asc' },
      ],
      take: +limit,
      ...(cursor ? { skip: 1, cursor: { id: +cursor } } : {}),
      include: {
        promos: { where: { expiresAt: { gt: new Date() } } },
      },
    });

    /* ---------- модификация цен ---------- */
    const factor = await getUserFactor(req.user.id);
    const items  = products.map(p => applyPriceModifier(p, factor));
    const nextCursor = items.length === +limit ? items.at(-1).id : null;

    res.json({ items, nextCursor });
  } catch (e) { next(e); }
});

export default router;
