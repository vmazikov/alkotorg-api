// src/routes/admin.product.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';
import { normalizeName } from '../utils/strings.js';
import { toBool } from '../utils/parse.js';

const router = Router();

// Защита: JWT + только ADMIN
router.use(authMiddleware);
router.use(role(['ADMIN']));

/**
 * GET /admin/products?withPromo=true
 * Возвращает все товары (включая архивные), опционально с последней акцией
 */
router.get('/', async (req, res, next) => {
  try {
    const includePromo = req.query.withPromo === 'true';
    const productsRaw = await prisma.product.findMany({
      orderBy: { id: 'asc' },
      include: includePromo
        ? { promos: true }
        : {},
    });
    const products = productsRaw.map(p => {
      const lastPromo = (p.promos?.length)
        ? p.promos[p.promos.length - 1]
        : null;
      const { promos, ...rest } = p;
      return { ...rest, promo: lastPromo };
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

/** PUT /admin/products/:id — обновление товара */
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = {};

    // Текстовые поля
    [
      'article','name','rawName','brand','type','img',
      'wineColor','sweetnessLevel','wineType','giftPackaging',
      'manufacturer','excerpt','rawMaterials','taste',
      'description'           // ← добавлено
    ].forEach(key => {
      if (req.body[key] !== undefined) {
        data[key] = req.body[key];
      }
    });

    // Числовые поля
    [ 'volume','degree','basePrice','stock' ].forEach(key => {
      if (req.body[key] !== undefined) {
        const v = req.body[key];
        data[key] = v === null ? null : Number(v);
      }
    });

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(data.rawName !== undefined
          ? { canonicalName: data.rawName ? normalizeName(data.rawName) : null }
          : {})
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/** PATCH /admin/products/:id/archive — пометить в архив */
router.patch('/:id/archive', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const archived = await prisma.product.update({
      where: { id },
      data: { isArchived: true },
    });
    res.json(archived);
  } catch (err) {
    next(err);
  }
});

/** PATCH /admin/products/:id/unarchive — вернуть из архива */
router.patch('/:id/unarchive', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const restored = await prisma.product.update({
      where: { id },
      data: { isArchived: false },
    });
    res.json(restored);
  } catch (err) {
    next(err);
  }
});

/** DELETE /admin/products/:id — удалить товар и все связи */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    // Удаляем все связанные записи в нужном порядке
    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { productId: id } }),
      prisma.cartItem.deleteMany({ where: { productId: id } }),
      prisma.promo.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** POST /admin/products/:id/promo — создать новую акцию */
router.post('/:id/promo', async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const { promoPrice, comment, expiresAt } = req.body;
    const applyModifier = toBool(req.body.applyModifier);
    const promo = await prisma.promo.create({
      data: {
        productId,
        promoPrice: Number(promoPrice),
        comment: comment || null,
        expiresAt: new Date(expiresAt),
        ...(applyModifier === undefined ? {} : { applyModifier }),
      },
    });
    res.status(201).json(promo);
  } catch (err) {
    next(err);
  }
});

/** PATCH /admin/products/:id/promo/:promoId — редактировать акцию */
router.patch('/:id/promo/:promoId', async (req, res, next) => {
  try {
    const promoId = Number(req.params.promoId);
    const { promoPrice, comment, expiresAt } = req.body;
    const applyModifier = toBool(req.body.applyModifier);
    const updated = await prisma.promo.update({
      where: { id: promoId },
      data: {
        promoPrice: Number(promoPrice),
        comment: comment || null,
        expiresAt: new Date(expiresAt),
        ...(applyModifier === undefined ? {} : { applyModifier }),
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
