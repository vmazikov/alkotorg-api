// src/routes/product.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();

// Подключаем аутентификацию, чтобы получить req.user
router.use(authMiddleware);

/* GET /products */
router.get('/', async (req, res, next) => {
  try {
    const { search, priceMin, priceMax, volumes, degree, sort, type } = req.query;

    // 1) Получаем пользовательский модификатор
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { priceModifier: true }
    });
    const factor = 1 + (user.priceModifier / 100);

    // 2) Строим оригинальные фильтры по basePrice
    const where = { isArchived: false };
    if (type)     where.type       = type;
    if (search)   where.name       = { contains: search, mode: 'insensitive' };
    if (priceMin) where.basePrice  = { gte: +priceMin };
    if (priceMax) where.basePrice  = { ...(where.basePrice || {}), lte: +priceMax };
    if (degree)   where.degree     = { gte: +degree };
    if (volumes)  where.volume     = { in: (Array.isArray(volumes) ? volumes : [volumes]).map(Number) };

    // 3) Сортировка по оригинальным полям
    const orderBy =
      sort === 'name_asc'   ? { name: 'asc' } :
      sort === 'price_asc'  ? { basePrice: 'asc' } :
      sort === 'price_desc' ? { basePrice: 'desc' } :
      undefined;

    // 4) Запрос к БД — все товары + все активные promos
    const products = await prisma.product.findMany({
      where,
      orderBy,
      include: {
        promos: {
          where: { expiresAt: { gt: new Date() } }
        }
      }
    });

    // 5) Накладываем modifier на обе цены, если nonModify = false
    const result = products.map(p => {
      const modifiedBase = p.nonModify
        ? p.basePrice
        : +(p.basePrice * factor).toFixed(2);

      const modifiedPromos = p.promos.map(pr => ({
        ...pr,
        promoPrice: p.nonModify
          ? pr.promoPrice
          : +(pr.promoPrice * factor).toFixed(2)
      }));

      return {
        ...p,
        basePrice: modifiedBase,
        promos: modifiedPromos
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* GET /products/suggest?query=tor */
router.get('/suggest', async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) return res.json([]);

    const list = await prisma.product.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      select: { name: true },
      take: 10,
    });

    res.json(list.map(x => x.name));
  } catch (err) {
    next(err);
  }
});

export default router;
