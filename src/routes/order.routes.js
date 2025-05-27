// src/routes/order.routes.js
import { Router }         from 'express';
import prisma             from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import { notifyAgent }    from '../utils/teleg.js';

const router = Router();
router.use(authMiddleware);

/* ------------------------------------------------------------------
   POST /orders
   Создать заказ, посчитать цены и оповестить Telegram-агента
-------------------------------------------------------------------*/
router.post('/', async (req, res, next) => {
  try {
    const { storeId, items } = req.body;
    if (!storeId || !Array.isArray(items) || !items.length) {
      return res
        .status(400)
        .json({ error: 'storeId и непустой массив items обязательны' });
    }

    /* 1. priceModifier (для USER / MANAGER) и telegramId агента */
    const customer = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        priceModifier: true,
        agent: { select: { telegramId: true } },
      },
    });
    if (!customer) return res.status(404).json({ error: 'Покупатель не найден' });

    const factor = 1 + customer.priceModifier / 100;

    /* 2. нужные продукты */
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        basePrice: true,
        nonModify: true,
        promos: {
          where: { expiresAt: { gt: new Date() } },
          orderBy: { expiresAt: 'desc' },
          take: 1,
        },
      },
    });

    /* 3. позиции заказа */
    let total = 0;
    const createItems = items.map(({ productId, qty }) => {
      const p = products.find((x) => x.id === productId);
      if (!p) throw new Error(`Product ${productId} not found`);

      const raw   = p.promos.length ? p.promos[0].promoPrice : p.basePrice;
      const price = p.nonModify ? raw : +((raw * factor).toFixed(2));
      total += price * qty;
      return { productId, quantity: qty, price };
    });
    total = +total.toFixed(2);

    /* 4. создаём заказ */
    const order = await prisma.order.create({
      data: {
        storeId: +storeId,
        userId:  req.user.id,   // кто оформил
        total,
        items: { create: createItems },
      },
      include: {
        user:  { select: { login: true, fullName: true } },
        store: {
          select: {
            title: true,
            user: {
              select: {
                id: true,
                fullName: true,
                agent: {
                  select: { login: true, fullName: true, telegramId: true },
                },
              },
            },
          },
        },
        items: {
          include: { product: { select: { name: true, volume: true } } },
        },
      },
    });

    /* 5. Telegram-уведомление агенту */
    const tg = order.store.user.agent?.telegramId;
    if (tg) {
      const link = `https://tk-alcotorg.ru/orders/${order.id}`;
      const text =
        `🆕 Новый заказ #${order.id}\n` +
        `Покупатель: ${order.user.fullName}\n` +
        `Магазин: ${order.store.title}\n` +
        `Сумма: ${order.total.toFixed(2)} ₽\n\n` +
        `Перейти к заказу: ${link}`;
      await notifyAgent(tg, text);
    }

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   GET /orders?status=[NEW|DONE]
   Видимость:
   • AGENT   → заказы клиентов (user.agentId = agent.id)
   • USER    → все заказы магазинов, которыми он владеет (store.userId)
   • MANAGER → заказы магазинов, где он менеджер (store.managerId)
   • ADMIN   → все
-------------------------------------------------------------------*/
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const { role, id: userId } = req.user;

    const where = {};
    if (role === 'AGENT') {
      where.user = { agentId: userId };
    } else if (role === 'USER') {
      where.store = { userId };
    } else if (role === 'MANAGER') {
      where.store = { managerId: userId };
    }
    if (status && ['NEW', 'DONE'].includes(status)) {
      where.status = status;
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        user:  { select: { login: true, fullName: true } },
        store: {
          select: {
            title: true,
            user: {
              select: {
                agent: { select: { login: true, fullName: true } },
              },
            },
          },
        },
        items: {
          include: { product: { select: { name: true, volume: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(orders);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   GET /orders/:id
   Та же логика доступа, но к одному заказу
-------------------------------------------------------------------*/
router.get('/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: +req.params.id },
      include: {
        user:  { select: { login: true, fullName: true, agentId: true } },
        store: {
          select: {
            title: true,
            user:   { select: { id: true } },
            managerId: true,
          },
        },
        items: {
          include: { product: { select: { name: true, volume: true } } },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Not found' });

    const { role, id: userId } = req.user;
    const isAllowed =
      role === 'ADMIN' ||
      (role === 'AGENT'   && order.user.agentId === userId) ||
      (role === 'USER'    && order.store.user.id === userId) ||
      (role === 'MANAGER' && order.store.managerId === userId);

    if (!isAllowed) return res.status(403).json({ error: 'Нет доступа' });

    res.json(order);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   PUT /orders/:id/status   (AGENT и ADMIN)
-------------------------------------------------------------------*/
router.put('/:id/status', async (req, res, next) => {
  try {
    const { status, comment = '' } = req.body;
    if (!['NEW', 'DONE'].includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }
    const updated = await prisma.order.update({
      where: { id: +req.params.id },
      data: { status, agentComment: comment },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   DELETE /orders/:id      (только ADMIN)
-------------------------------------------------------------------*/
router.delete('/:id', async (req, res, next) => {
  try {
    const id = +req.params.id;
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    await prisma.orderItem.deleteMany({ where: { orderId: id } });
    await prisma.order.delete({ where: { id } });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

export default router;
