// src/routes/admin.store.routes.js
import { Router } from 'express';
import prisma       from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

// Все /admin/stores/* защищены JWT + роль ADMIN или AGENT
router.use(authMiddleware);
router.use(role(['ADMIN', 'AGENT']));

/* ------------------------------------------------------------------
   GET /admin/stores
   • ADMIN   → все магазины (фильтр ?userId= работает)
   • AGENT   → только свои (store.userId = req.user.id)
-------------------------------------------------------------------*/
router.get('/', async (req, res, next) => {
  try {
    const where = {};

    if (req.user.role === 'ADMIN') {
      // для админа: можно фильтровать по ?userId=
      if (req.query.userId) {
        where.userId = Number(req.query.userId);
      }
    } else {
      // для агента: только свои, даже если передан ?userId
      where.userId = req.user.id;
    }

    const stores = await prisma.store.findMany({
      where,
      include: { user: true, manager: true },
    });
    res.json(stores);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   POST /admin/stores
   • ADMIN → может указывать любой userId
   • AGENT → создаёт только для себя (userId = req.user.id)
-------------------------------------------------------------------*/
router.post('/', async (req, res, next) => {
  try {
    let { userId, title, address, managerId = null } = req.body;

    if (req.user.role === 'AGENT') {
      // агент всегда создаёт под свою учётку
      userId = req.user.id;
    }

    const store = await prisma.store.create({
      data: {
        userId:    Number(userId),
        title,
        address,
        managerId: managerId ? Number(managerId) : null,
      },
      include: { user: true, manager: true },
    });

    res.status(201).json(store);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   PUT /admin/stores/:id
   • ADMIN → может править любой магазин
   • AGENT → только свои (store.userId = req.user.id)
-------------------------------------------------------------------*/
router.put('/:id', async (req, res, next) => {
  try {
    const storeId = Number(req.params.id);

    // проверяем право агента
    if (req.user.role === 'AGENT') {
      const existing = await prisma.store.findUnique({ where: { id: storeId } });
      if (!existing || existing.userId !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа к этому магазину' });
      }
    }

    const { title, address, managerId = null } = req.body;

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: {
        title,
        address,
        managerId: managerId ? Number(managerId) : null,
      },
      include: { user: true, manager: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
