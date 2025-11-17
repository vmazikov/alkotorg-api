// src/routes/admin.auto-pick.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

router.use(authMiddleware);
router.use(role(['ADMIN']));

/* Product scores ---------------------------------------------------*/
router.get('/scores', async (_req, res, next) => {
  try {
    const scores = await prisma.productScore.findMany({
      include: {
        product: { select: { id: true, name: true, type: true, volume: true, isArchived: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(scores);
  } catch (err) {
    next(err);
  }
});

router.put('/scores/:productId', async (req, res, next) => {
  try {
    const productId = +req.params.productId;
    const { score = 0, manualScore = null, promoBoost = 1, noveltyBoost = 1 } = req.body || {};

    const exists = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updated = await prisma.productScore.upsert({
      where: { productId },
      update: { score: +score || 0, manualScore: manualScore === null ? null : +manualScore, promoBoost: +promoBoost || 1, noveltyBoost: +noveltyBoost || 1 },
      create: { productId, score: +score || 0, manualScore: manualScore === null ? null : +manualScore, promoBoost: +promoBoost || 1, noveltyBoost: +noveltyBoost || 1 },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* Category rules ---------------------------------------------------*/
router.get('/category-rules', async (_req, res, next) => {
  try {
    const rules = await prisma.categoryRule.findMany({
      orderBy: [{ category: 'asc' }, { volume: 'asc' }],
    });
    res.json(rules);
  } catch (err) {
    next(err);
  }
});

router.post('/category-rules', async (req, res, next) => {
  try {
    const { category, volume = null, minQty, enabled = true } = req.body || {};
    if (!category || typeof category !== 'string') {
      return res.status(400).json({ error: 'category is required' });
    }
    if (!Number.isFinite(+minQty) || +minQty <= 0) {
      return res.status(400).json({ error: 'minQty must be a positive number' });
    }
    const rule = await prisma.categoryRule.create({
      data: {
        category,
        volume: volume === null ? null : +volume,
        minQty: +minQty,
        enabled: Boolean(enabled),
      },
    });
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

router.put('/category-rules/:id', async (req, res, next) => {
  try {
    const id = +req.params.id;
    const { category, volume, minQty, enabled } = req.body || {};
    const payload = {};
    if (category) payload.category = category;
    if (volume !== undefined) payload.volume = volume === null ? null : +volume;
    if (minQty !== undefined) payload.minQty = +minQty;
    if (enabled !== undefined) payload.enabled = Boolean(enabled);

    const updated = await prisma.categoryRule.update({
      where: { id },
      data: payload,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/category-rules/:id', async (req, res, next) => {
  try {
    const id = +req.params.id;
    await prisma.categoryRule.delete({ where: { id } });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

/* Assortment profiles ----------------------------------------------*/
router.get('/profiles', async (_req, res, next) => {
  try {
    const profiles = await prisma.assortmentProfile.findMany({
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
    res.json(profiles);
  } catch (err) {
    next(err);
  }
});

router.post('/profiles', async (req, res, next) => {
  try {
    const { name, categoryWeights = {}, volumeMinQty = null, isDefault = false } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    if (isDefault) {
      await prisma.assortmentProfile.updateMany({ data: { isDefault: false } });
    }

    const profile = await prisma.assortmentProfile.create({
      data: {
        name,
        categoryWeights,
        volumeMinQty,
        isDefault: Boolean(isDefault),
      },
    });
    res.status(201).json(profile);
  } catch (err) {
    next(err);
  }
});

router.put('/profiles/:id', async (req, res, next) => {
  try {
    const id = +req.params.id;
    const { name, categoryWeights, volumeMinQty, isDefault } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = name;
    if (categoryWeights !== undefined) data.categoryWeights = categoryWeights;
    if (volumeMinQty !== undefined) data.volumeMinQty = volumeMinQty;
    if (isDefault !== undefined) data.isDefault = Boolean(isDefault);

    if (data.isDefault) {
      await prisma.assortmentProfile.updateMany({ data: { isDefault: false } });
    }

    const updated = await prisma.assortmentProfile.update({
      where: { id },
      data,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/profiles/:id', async (req, res, next) => {
  try {
    const id = +req.params.id;
    await prisma.assortmentProfile.delete({ where: { id } });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

export default router;
