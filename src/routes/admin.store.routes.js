// src/routes/admin.store.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

// Все /admin/stores/* защищено JWT + роли ADMIN или AGENT
router.use(authMiddleware);
router.use(role(['ADMIN', 'AGENT']));

/* ------------------------------------------------------------------
   GET /admin/stores
   • ADMIN → все (фильтр ?userId= работает)
   • AGENT → магазины всех своих клиентов (store.agentId = req.user.id)
-------------------------------------------------------------------*/
router.get('/', async (req, res, next) => {
  try {
    const where = {};

    if (req.user.role === 'ADMIN') {
      if (req.query.userId) where.userId = Number(req.query.userId);
    } else {
      // агент видит магазины, где он ответственный
      where.agentId = req.user.id;
    }

    const stores = await prisma.store.findMany({
      where,
      orderBy: { id: 'asc' },
      include: {
        // Покупатель (USER) + его агент
        user: {
          select: {
            id: true,
            login: true,
            fullName: true,
            agent: {
              select: {
                id: true,
                login: true,
                fullName: true,
              },
            },
          },
        },
        // Менеджер (MANAGER)
        manager: {
          select: {
            id: true,
            login: true,
            fullName: true,
          },
        },
      },
    });

    res.json(stores);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   POST /admin/stores
   • ADMIN → может указать любого userId
   • AGENT → создаёт магазин для своего клиента (user.agentId = req.user.id)
-------------------------------------------------------------------*/
router.post('/', async (req, res, next) => {
  try {
    let { userId, title, address, managerId = null } = req.body;
    userId = Number(userId);

    if (!userId || !title || !address) {
      return res.status(400).json({ error: 'userId, title и address обязательны' });
    }

    // Проверяем владельца магазина
    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, agentId: true },
    });
    if (!owner) return res.status(404).json({ error: 'Пользователь не найден' });

    // Агент может работать только со своим клиентом
    if (req.user.role === 'AGENT' && owner.agentId !== req.user.id) {
      return res.status(403).json({ error: 'Это не ваш клиент' });
    }

    const store = await prisma.store.create({
      data: {
        userId,
        agentId: owner.agentId, // ← автоматическая привязка
        title,
        address,
        managerId: managerId != null ? Number(managerId) : null,
      },
      include: {
        user: {
          select: {
            id: true,
            login: true,
            fullName: true,
            agent: {
              select: { id: true, login: true, fullName: true },
            },
          },
        },
        manager: {
          select: { id: true, login: true, fullName: true },
        },
      },
    });

    res.status(201).json(store);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   PUT /admin/stores/:id
   • ADMIN → может править любой магазин
   • AGENT → только свои (store.agentId = req.user.id)
-------------------------------------------------------------------*/
router.put('/:id', async (req, res, next) => {
  try {
    const storeId = Number(req.params.id);
    const existing = await prisma.store.findUnique({ where: { id: storeId } });
    if (!existing) return res.status(404).json({ error: 'Магазин не найден' });

    if (req.user.role === 'AGENT' && existing.agentId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к этому магазину' });
    }

    const { title, address, userId, managerId = null } = req.body;
    const data = {};

    if (title   !== undefined) data.title   = title;
    if (address !== undefined) data.address = address;
    if (managerId !== undefined)
      data.managerId = managerId != null ? Number(managerId) : null;

    // Если меняем владельца магазина
    if (userId !== undefined) {
      const newOwner = await prisma.user.findUnique({
        where: { id: Number(userId) },
        select: { id: true, agentId: true },
      });
      if (!newOwner) return res.status(404).json({ error: 'Новый пользователь не найден' });

      // Агент не может передать магазин чужому клиенту
      if (req.user.role === 'AGENT' && newOwner.agentId !== req.user.id) {
        return res.status(403).json({ error: 'Это не ваш клиент' });
      }

      data.userId  = Number(userId);
      data.agentId = newOwner.agentId; // синхронизируем агентство
    }

    const updated = await prisma.store.update({
      where: { id: storeId },
      data,
      include: {
        user: {
          select: {
            id: true,
            login: true,
            fullName: true,
            agent: {
              select: { id: true, login: true, fullName: true },
            },
          },
        },
        manager: {
          select: { id: true, login: true, fullName: true },
        },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   DELETE /admin/stores/:id
   • ADMIN → любой магазин
   • AGENT → только свои (store.agentId = req.user.id)
-------------------------------------------------------------------*/
router.delete('/:id', async (req, res, next) => {
  try {
    const storeId = Number(req.params.id);
    const existing = await prisma.store.findUnique({ where: { id: storeId } });
    if (!existing) return res.status(404).json({ error: 'Магазин не найден' });

    if (req.user.role === 'AGENT' && existing.agentId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к этому магазину' });
    }

    await prisma.store.delete({ where: { id: storeId } });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

export default router;
