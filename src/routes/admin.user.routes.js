// src/routes/admin.user.routes.js
import { Router } from 'express';
import bcrypt     from 'bcrypt';
import prisma     from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

// Все эндпоинты защищены JWT и доступны только ADMIN
router.use(authMiddleware);
router.use(role(['ADMIN']));

/** GET /admin/users */
router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id            : true,
        login         : true,
        fullName      : true,
        phone         : true,
        role          : true,
        priceModifier : true,
        agentId       : true,
      },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

/** POST /admin/users */
router.post('/', async (req, res, next) => {
  try {
    const {
      login = '',
      password = '',
      fullName = '',
      phone = '',
      role = 'USER',
      priceModifier = 0,
      agentId = null,
    } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'login и password обязательны' });
    }

    const exists = await prisma.user.findUnique({ where: { login } });
    if (exists) {
      return res.status(409).json({ error: 'Этот login уже занят' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        login,
        passwordHash,
        fullName,
        phone,
        role,
        priceModifier: +priceModifier,
        agentId,
      },
      select: {
        id            : true,
        login         : true,
        fullName      : true,
        phone         : true,
        role          : true,
        priceModifier : true,
        agentId       : true,
      },
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Дублирование уникального поля' });
    }
    next(err);
  }
});

/** PUT /admin/users/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const id = +req.params.id;
    const {
      login,
      password,
      fullName,
      phone,
      role,
      priceModifier,
      agentId,
    } = req.body;

    const data = {};
    if (login !== undefined) data.login = login;
    if (fullName !== undefined) data.fullName = fullName;
    if (phone !== undefined) data.phone = phone;
    if (role !== undefined) data.role = role;
    if (priceModifier !== undefined) data.priceModifier = +priceModifier;
    if (agentId !== undefined) data.agentId = agentId;
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where : { id },
      data,
      select: {
        id            : true,
        login         : true,
        fullName      : true,
        phone         : true,
        role          : true,
        priceModifier : true,
        agentId       : true,
      },
    });
    res.json(user);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Дублирование уникального поля' });
    }
    next(err);
  }
});

export default router;
