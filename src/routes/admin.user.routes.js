// src/routes/admin.user.routes.js
import { Router } from 'express';
import bcrypt     from 'bcrypt';
import prisma     from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

// все /admin/users/* — JWT + роли ADMIN или AGENT
router.use(authMiddleware);
router.use(role(['ADMIN','AGENT']));

/** GET /admin/users */
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role === 'AGENT') {
      // агент видит только своих клиентов и менеджеров
      where.agentId = req.user.id;
    } else if (req.query.agentId) {
      // админ может фильтровать по agentId
      where.agentId = Number(req.query.agentId);
    }
    const users = await prisma.user.findMany({
      where,
      select: {
        id:           true,
        login:        true,
        fullName:     true,
        phone:        true,
        role:         true,
        priceModifier:true,
        agentId:      true,
        maAgentId:    true,
      },
      orderBy: { id: 'asc' },
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
      maAgentId = null,
    } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'login и password обязательны' });
    }

    // AGENT может создавать только покупателей под собой
    if (req.user.role === 'AGENT') {
      newRole = 'USER';
      agentId = req.user.id;
      maAgentId = null; // агент не может задавать MA AgentID
    }

    // проверка уникальности
    if (await prisma.user.findUnique({ where: { login } })) {
      return res.status(409).json({ error: 'Этот login уже занят' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        login, passwordHash, fullName, phone,
        role: newRole,
        priceModifier: +priceModifier,
        agentId,
        ...(req.user.role === 'ADMIN' && newRole === 'AGENT'
          ? { maAgentId: normMaHex(maAgentId) }
          : {}),
      },
      select: {
        id: true, login: true, fullName: true,
        phone: true, role: true, priceModifier: true, agentId: true, maAgentId: true
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
  const id = Number(req.params.id);

  try {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // AGENT не может трогать чужих
    if (req.user.role === 'AGENT') {
      if (existing.agentId !== req.user.id || existing.role !== 'USER') {
        return res.status(existing.role === 'MANAGER' ? 400 : 403)
                  .json({ error: existing.role === 'MANAGER'
                    ? 'Менеджеру смена агента недоступна'
                    : 'Нет доступа к этому пользователю'
                  });
      }
    }

   const {
     login, password, fullName, phone,
     role: newRole, priceModifier, agentId: newAgentId,
     maAgentId
   } = req.body;

    const data = {};
    // Общие поля
    if (fullName      !== undefined) data.fullName      = fullName;
    if (phone         !== undefined) data.phone         = phone;
    if (priceModifier !== undefined) data.priceModifier = +priceModifier;

    // Пароль — только админ
    if (req.user.role === 'ADMIN' && password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }
    // login, role, agentId — только админ
    if (req.user.role === 'ADMIN') {
      if (login     !== undefined) data.login   = login;
      if (newRole   !== undefined) data.role    = newRole;
      if (newAgentId!== undefined) data.agentId = newAgentId;
      // maAgentId можно править только у AGENT
      if (maAgentId !== undefined) {
        const targetRole = newRole ?? existing.role;
        if (targetRole === 'AGENT') {
          data.maAgentId = normMaHex(maAgentId);
        } else {
          data.maAgentId = null; // если перестали быть агентом — обнуляем
        }
      }
    }

    // собственно, обновляем
    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id:true, login:true, fullName:true, phone:true, role:true, priceModifier:true, agentId:true, maAgentId:true },
    });

    // Если это покупатель и админ сменил агентId
    if (req.user.role === 'ADMIN'
        && existing.role === 'USER'
        && newAgentId !== undefined
        && newAgentId !== existing.agentId
    ) {
      // 1) Обновить всех других покупателей, у кого agentId = старый
      await prisma.user.updateMany({
        where: { agentId: id, role: 'USER' },
        data:  { agentId: newAgentId },
      });
      // 2) Обновить всех менеджеров этого покупателя
      //    Для менеджеров у нас есть связь через Store.managerId => user.id
      //    Поэтому найдем все магазины, где managerId = id, и поменяем agentId у этих менеджеров:
      const mgrStores = await prisma.store.findMany({
        where: { managerId: id },
        select: { managerId: true },
      });
      const mgrIds = mgrStores.map(s => s.managerId).filter(Boolean);
      if (mgrIds.length) {
        await prisma.user.updateMany({
          where: { id: { in: mgrIds }, role: 'MANAGER' },
          data:  { agentId: newAgentId },
        });
      }
    }

    res.json(user);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Дублирование уникального поля' });
    }
    next(err);
  }
});

/** DELETE /admin/users/:id */
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);

  try {
    // Проверка прав агента: он может удалять только своих клиентов
    if (req.user.role === 'AGENT') {
      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing || existing.agentId !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа к этому пользователю' });
      }
    }

    // Удаляем пользователя
    await prisma.user.delete({ where: { id } });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

export default router;

// ─── helpers ─────────────────────────────────────────────────────────────
function normMaHex(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) {
    throw Object.assign(new Error('maAgentId должен быть 32-символьным hex (без дефисов)'), { status: 400 });
  }
  return s;
}
