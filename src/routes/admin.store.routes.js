// src/routes/admin.store.routes.js
import { Router } from 'express';
import prisma                   from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

/* сначала — авторизация, чтобы был req.user */
router.use(authMiddleware);

/* ------------------------------------------------------------------
   GET /stores
   ADMIN / AGENT           → все магазины  (доступен фильтр ?userId=)
   USER                    → только свои   (store.userId = req.user.id)
   MANAGER                 → только свой   (store.managerId = req.user.id)
-------------------------------------------------------------------*/
router.get('/', async (req, res) => {
  let where = {};

  if (req.query.userId) where.userId = +req.query.userId;
  if (req.user.role === 'USER')     where.userId   = req.user.id;
  if (req.user.role === 'MANAGER')  where.managerId = req.user.id;

  const stores = await prisma.store.findMany({
    where,
    include: { user: true, manager: true }
  });
  res.json(stores);
});

/* ------------------------------------------------------------------
   POST /stores  – только ADMIN и AGENT
-------------------------------------------------------------------*/
router.post(
  '/',
  role(['ADMIN', 'AGENT']),
  async (req, res) => {
    const { userId, title, address, managerId = null } = req.body;

    const store = await prisma.store.create({
      data: {
        userId:    +userId,
        title,
        address,
        managerId: managerId ? +managerId : null,
      },
      include: { user: true, manager: true }
    });
    res.status(201).json(store);
  }
);

/* ------------------------------------------------------------------
   PUT /stores/:id – только ADMIN и AGENT
-------------------------------------------------------------------*/
router.put(
  '/:id',
  role(['ADMIN', 'AGENT']),
  async (req, res) => {
    const id = +req.params.id;
    const { title, address, managerId = null } = req.body;

    const store = await prisma.store.update({
      where: { id },
      data:  {
        title,
        address,
        managerId: managerId ? +managerId : null,
      },
      include: { user: true, manager: true }
    });
    res.json(store);
  }
);

export default router;
