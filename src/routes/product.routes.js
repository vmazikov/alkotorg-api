// src/routes/product.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();

// Подключаем аутентификацию, чтобы внутри было req.user
router.use(authMiddleware);

/* ------------------------------------------------------------------
   GET /products
   (ваш уже существующий код)
-------------------------------------------------------------------*/
router.get('/', async (req, res, next) => {
  try {
    const { search, priceMin, priceMax, volumes, degree, sort, type } = req.query;

    // 1) Получаем пользовательский модификатор
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { priceModifier: true }
    });
    const factor = 1 + (user.priceModifier / 100);

    // 2) Фильтры...
    const where = { isArchived: false };
    if (type)     where.type       = type;
    if (search)   where.name       = { contains: search, mode: 'insensitive' };
    if (priceMin) where.basePrice  = { gte: +priceMin };
    if (priceMax) where.basePrice  = { ...(where.basePrice || {}), lte: +priceMax };
    if (degree)   where.degree     = { gte: +degree };
    if (volumes)  where.volume     = { in: (Array.isArray(volumes) ? volumes : [volumes]).map(Number) };

    // 3) Сортировка...
    const orderBy =
      sort === 'name_asc'   ? { name: 'asc' } :
      sort === 'price_asc'  ? { basePrice: 'asc' } :
      sort === 'price_desc' ? { basePrice: 'desc' } :
      undefined;

    // 4) Запрос
    const products = await prisma.product.findMany({
      where,
      orderBy,
      include: {
        promos: {
          where: { expiresAt: { gt: new Date() } }
        }
      }
    });

    // 5) Применяем modifier
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
        promos:    modifiedPromos
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   GET /products/:id
   Вернуть один товар с подробным описанием
-------------------------------------------------------------------*/
router.get('/:id', async (req, res, next) => {
  try {
    const prodId = Number(req.params.id);
    // 1) Получаем user priceModifier
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { priceModifier: true }
    });
    const factor = 1 + (user.priceModifier / 100);

    // 2) Ищем товар (не архивный) с акциями
    const p = await prisma.product.findUnique({
      where: { id: prodId },
      include: {
        promos: {
          where: { expiresAt: { gt: new Date() } },
          orderBy: { expiresAt: 'desc' }
        }
      }
    });

    if (!p || p.isArchived) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // 3) Вычисляем цены
    const modifiedBase = p.nonModify
      ? p.basePrice
      : +(p.basePrice * factor).toFixed(2);

    const modifiedPromos = p.promos.map(pr => ({
      ...pr,
      promoPrice: p.nonModify
        ? pr.promoPrice
        : +(pr.promoPrice * factor).toFixed(2)
    }));

    // 4) Собираем ответ
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

      wineColor:      p.wineColor,
      sweetnessLevel: p.sweetnessLevel,
      wineType:       p.wineType,
      giftPackaging:  p.giftPackaging,
      manufacturer:   p.manufacturer,
      excerpt:        p.excerpt,
      rawMaterials:   p.rawMaterials,
      taste:          p.taste,
      description:    p.description,

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
