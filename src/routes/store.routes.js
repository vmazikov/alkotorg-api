// src/routes/store.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

/* ──────────────────────────────────────────────────────────────
   middleware: сначала проверяем JWT, потом — роль пользователя
   ────────────────────────────────────────────────────────────── */
router.use(authMiddleware);

/* ------------------------------------------------------------------
   GET  /stores
   - ADMIN  → все магазины
   - AGENT  → магазины его клиентов   (дорабатываем позже фильтр agentId)
   - USER   → свои магазины
   - MANAGER→ только свой магазин     (по managerId)
   ------------------------------------------------------------------ */
router.get(
  '/',
  role(['ADMIN', 'AGENT', 'USER', 'MANAGER']),
  async (req, res) => {
    let where = {};

    // ограничиваем выборку, если это USER или MANAGER
    switch (req.user.role) {
      case 'USER':
        where.userId = req.user.id;
        break;
      case 'MANAGER':
        where.managerId = req.user.id;
        break;
      default:
        // ADMIN / AGENT увидят все (при желании — фильтр agentId)
        break;
    }

    // опциональный фильтр ?userId=
    if (req.query.userId) where.userId = +req.query.userId;

    const stores = await prisma.store.findMany({
      where,
      include: {
        manager: { select: { id: true, email: true, role: true } },
        user:    { select: { id: true, email: true } },
      },
    });

    res.json(stores);
  }
);

/* ------------------------------------------------------------------
   POST /stores
   Доступ: ADMIN, AGENT
   body: { userId, title, address, managerId? }
   ------------------------------------------------------------------ */
router.post(
  '/',
  role(['ADMIN', 'AGENT']),
  async (req, res) => {
    const { userId, title, address, managerId = null } = req.body;

    const store = await prisma.store.create({
      data: {
        userId:   +userId,
        title,
        address,
        managerId,
      },
      include: { manager: true, user: true },
    });

    res.status(201).json(store);
  }
);

/* ------------------------------------------------------------------
   PUT /stores/:id
   Доступ: ADMIN, AGENT
   body: { title?, address?, managerId? }
   ------------------------------------------------------------------ */
router.put(
  '/:id',
  role(['ADMIN', 'AGENT']),
  async (req, res) => {
    const id = +req.params.id;
    const { title, address, managerId = null } = req.body;

    const store = await prisma.store.update({
      where: { id },
      data : { title, address, managerId },
      include: { manager: true, user: true },
    });

    res.json(store);
  }
);

export default router;
