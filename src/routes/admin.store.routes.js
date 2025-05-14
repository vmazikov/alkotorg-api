// src/routes/admin.store.routes.js
import { Router } from 'express';
import prisma      from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

// Все /admin/stores/* защищено JWT + роль ADMIN или AGENT
router.use(authMiddleware);
router.use(role(['ADMIN', 'AGENT']));

/* ------------------------------------------------------------------
   GET /admin/stores
   • ADMIN → все (фильтр ?userId= работает)
   • AGENT → только свои (store.userId = req.user.id)
-------------------------------------------------------------------*/
router.get('/', async (req, res, next) => {
  try {
    const where = {};

    if (req.user.role === 'ADMIN') {
      // ADMIN может фильтровать по ?userId=
      if (req.query.userId) {
        where.userId = Number(req.query.userId);
      }
    } else {
      // AGENT видит только созданные им магазины
      where.userId = req.user.id;
    }

    const stores = await prisma.store.findMany({
      where,
      orderBy: { id: 'asc' },
      include: {
        // Покупатель (USER), в том числе его агент
        user: {
          select: {
            id:       true,
            login:    true,
            fullName: true,
            agent: {
              select: {
                id:       true,
                login:    true,
                fullName: true
              }
            }
          }
        },
        // Менеджер (MANAGER)
        manager: {
          select: {
            id:       true,
            login:    true,
            fullName: true
          }
        }
      }
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
      // AGENT всегда создаёт магазин под своей учёткой
      userId = req.user.id;
    }

    const store = await prisma.store.create({
      data: {
        userId:    Number(userId),
        title,
        address,
        managerId: managerId != null ? Number(managerId) : null
      },
      include: {
        user: {
          select: {
            id:       true,
            login:    true,
            fullName: true,
            agent: {
              select: {
                id:       true,
                login:    true,
                fullName: true
              }
            }
          }
        },
        manager: {
          select: {
            id:       true,
            login:    true,
            fullName: true
          }
        }
      }
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

    if (req.user.role === 'AGENT') {
      // AGENT редактирует только свои магазины
      const existing = await prisma.store.findUnique({ where: { id: storeId } });
      if (!existing || existing.userId !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа к этому магазину' });
      }
    }

    const { title, address, userId, managerId = null } = req.body;

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: {
        title,
        address,
        // ADMIN может сменить владельца, AGENT не передаст чужой userId
        userId:    userId != null ? Number(userId) : undefined,
        managerId: managerId != null ? Number(managerId) : null
      },
      include: {
        user: {
          select: {
            id:       true,
            login:    true,
            fullName: true,
            agent: {
              select: {
                id:       true,
                login:    true,
                fullName: true
              }
            }
          }
        },
        manager: {
          select: {
            id:       true,
            login:    true,
            fullName: true
          }
        }
      }
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   DELETE /admin/stores/:id
   • ADMIN и AGENT могут удалять свои магазины
-------------------------------------------------------------------*/
router.delete('/:id', async (req, res, next) => {
  try {
    const storeId = Number(req.params.id);

    if (req.user.role === 'AGENT') {
      // AGENT удаляет только свои магазины
      const existing = await prisma.store.findUnique({ where: { id: storeId } });
      if (!existing || existing.userId !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа к этому магазину' });
      }
    }

    await prisma.store.delete({ where: { id: storeId } });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

export default router;
