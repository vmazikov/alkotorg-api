// src/routes/admin.stockRules.routes.js
import { Router }    from 'express';
import prisma         from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';
import { invalidateStockRulesCache } from '../utils/stockRules.js';

const router = Router();

// Только ADMIN
router.use(authMiddleware);
router.use(role(['ADMIN']));

/** GET /admin/stock-rules */
router.get('/', async (req, res, next) => {
  try {
    const rules = await prisma.stockRule.findMany({
      orderBy: { priority: 'asc' }
    });
    res.json(rules);
  } catch (err) { next(err) }
});

/** POST /admin/stock-rules */
router.post('/', async (req, res, next) => {
  try {
    const { field, operator, value, label, color, priority } = req.body;
    const rule = await prisma.stockRule.create({
      data: { field, operator, value, label, color, priority }
    });
    invalidateStockRulesCache();
    res.status(201).json(rule);
  } catch (err) { next(err) }
});

/** PUT /admin/stock-rules/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { field, operator, value, label, color, priority } = req.body;
    const rule = await prisma.stockRule.update({
      where: { id },
      data: { field, operator, value, label, color, priority }
    });
    invalidateStockRulesCache();
    res.json(rule);
  } catch (err) { next(err) }
});

/** DELETE /admin/stock-rules/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.stockRule.delete({ where: { id: Number(req.params.id) } });
    invalidateStockRulesCache();
    res.sendStatus(204);
  } catch (err) { next(err) }
});

export default router;
