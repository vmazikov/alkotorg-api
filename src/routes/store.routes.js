// src/routes/store.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

// Все запросы под этой веткой требуют авторизации
router.use(authMiddleware);

/* ------------------------------------------------------------------
   GET /stores
   • ADMIN   → все (можно фильтровать ?userId=)
   • AGENT   → магазины своих клиентов (store.agentId = req.user.id)
   • USER    → только свои (userId)
   • MANAGER → магазин, где он managerId
-------------------------------------------------------------------*/
router.get(
  '/',
  role(['ADMIN', 'AGENT', 'USER', 'MANAGER']),
  async (req, res, next) => {
    try {
      const { role: r, id: uid } = req.user;
      const where = {};

      if (r === 'ADMIN') {
        if (req.query.userId) where.userId = Number(req.query.userId);
      } else if (r === 'AGENT') {
        where.agentId = uid;
      } else if (r === 'USER') {
        where.userId = uid;
      } else if (r === 'MANAGER') {
        where.managerId = uid;
      }

      const stores = await prisma.store.findMany({
        where,
        orderBy: { id: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              login: true,
              fullName: true,
              phone: true,
              role: true,
              agent: { select: { id: true, login: true, fullName: true } },
            },
          },
          manager: {
            select: {
              id: true,
              login: true,
              fullName: true,
              phone: true,
              role: true,
            },
          },
        },
      });

      res.json(stores);
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------
   POST /stores
   • ADMIN → любой userId
   • AGENT → только для своего клиента
-------------------------------------------------------------------*/
router.post(
  '/',
  role(['ADMIN', 'AGENT']),
  async (req, res, next) => {
    try {
      let { userId, title, address, managerId = null } = req.body;
      userId = Number(userId);

      if (!userId || !title || !address) {
        return res.status(400).json({ error: 'userId, title и address обязательны' });
      }

      // Проверяем владельца
      const owner = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, agentId: true },
      });
      if (!owner) return res.status(404).json({ error: 'Пользователь не найден' });

      // Агент → только своих
      if (req.user.role === 'AGENT' && owner.agentId !== req.user.id) {
        return res.status(403).json({ error: 'Это не ваш клиент' });
      }

      const store = await prisma.store.create({
        data: {
          userId,
          agentId: owner.agentId, // ← ключевая строка
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
              phone: true,
              role: true,
              agent: { select: { id: true, login: true, fullName: true } },
            },
          },
          manager: {
            select: {
              id: true,
              login: true,
              fullName: true,
              phone: true,
              role: true,
            },
          },
        },
      });

      res.status(201).json(store);
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------
   PUT /stores/:id
   • ADMIN → любой магазин
   • AGENT → только свои (store.agentId = req.user.id)
-------------------------------------------------------------------*/
router.put(
  '/:id',
  role(['ADMIN', 'AGENT']),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);

      const existing = await prisma.store.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Магазин не найден' });

      if (req.user.role === 'AGENT' && existing.agentId !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа к этому магазину' });
      }

      const { title, address, managerId, userId } = req.body;
      const data = {};

      if (title   !== undefined) data.title   = title;
      if (address !== undefined) data.address = address;
      if (managerId !== undefined)
        data.managerId = managerId != null ? Number(managerId) : null;

      // Если меняем владельца
      if (userId !== undefined) {
        const newOwner = await prisma.user.findUnique({
          where: { id: Number(userId) },
          select: { id: true, agentId: true },
        });
        if (!newOwner) return res.status(404).json({ error: 'Новый пользователь не найден' });

        if (req.user.role === 'AGENT' && newOwner.agentId !== req.user.id) {
          return res.status(403).json({ error: 'Это не ваш клиент' });
        }

        data.userId  = Number(userId);
        data.agentId = newOwner.agentId;
      }

      const store = await prisma.store.update({
        where: { id },
        data,
        include: {
          user: {
            select: {
              id: true,
              login: true,
              fullName: true,
              phone: true,
              role: true,
              agent: { select: { id: true, login: true, fullName: true } },
            },
          },
          manager: {
            select: {
              id: true,
              login: true,
              fullName: true,
              phone: true,
              role: true,
            },
          },
        },
      });

      res.json(store);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
