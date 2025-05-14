// src/routes/admin.user.routes.js
import { Router } from 'express';
import bcrypt     from 'bcrypt';
import prisma     from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

// авторизация + допуск ADMIN и AGENT
router.use(authMiddleware);
router.use(role(['ADMIN','AGENT']));

/** GET /admin/users */
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role === 'AGENT') {
      // агент видит только своих
      where.agentId = req.user.id;
    }
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        login: true,
        fullName: true,
        phone: true,
        role: true,
        priceModifier: true,
        agentId: true,
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
    let {
      login = '',
      password = '',
      fullName = '',
      phone = '',
      role: newRole = 'USER',
      priceModifier = 0,
      agentId = null,
    } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'login и password обязательны' });
    }

    // AGENT может создавать только USER и автоматически привязывать себя
    if (req.user.role === 'AGENT') {
      newRole = 'USER';
      agentId = req.user.id;
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
        role: newRole,
        priceModifier: +priceModifier,
        agentId,
      },
      select: { id, login, fullName, phone, role: true, priceModifier: true, agentId: true },
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
    // для AGENT проверка, что он редактирует только \"своих\"
    if (req.user.role === 'AGENT') {
      const existing = await prisma.user.findUnique({ where: { id } });
      if (existing.agentId !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа к этому пользователю' });
      }
    }

    const {
      login,
      password,
      fullName,
      phone,
      role: newRole,
      priceModifier,
      agentId: newAgentId,
    } = req.body;

    const data = {};
    if (login !== undefined)      data.login = login;
    if (fullName !== undefined)   data.fullName = fullName;
    if (phone !== undefined)      data.phone = phone;
    if (priceModifier !== undefined) data.priceModifier = +priceModifier;
    // ADMIN может менять роль/agentId, AGENT — нет
    if (req.user.role === 'ADMIN') {
      if (newRole !== undefined)   data.role = newRole;
      if (newAgentId !== undefined) data.agentId = newAgentId;
    }
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id, login, fullName, phone, role: true, priceModifier: true, agentId: true },
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
