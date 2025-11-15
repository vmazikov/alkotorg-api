// src/routes/order.routes.js
import { Router }         from 'express';
import prisma             from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import { notifyAgent }    from '../utils/teleg.js';
import {
  createOrderLogEntry,
  detectOrderLogSource,
  OrderLogAction,
} from '../utils/orderLog.js';

const router = Router();
router.use(authMiddleware);

const log = (...a) => console.log('[orders]', ...a);

const orderLogsInclude = {
  orderBy: { createdAt: 'asc' },
  include: { actor: { select: { id: true, login: true, fullName: true, role: true } } },
};

const orderDetailsInclude = {
  user:  { select: { login: true, fullName: true, agentId: true } },
  store: {
    select: {
      title: true,
      user: { select: { id: true } },
      managerId: true,
    },
  },
  items: { include: { product: { select: { name: true, volume: true } } } },
  logs: orderLogsInclude,
};

/* ------------------------------------------------------------------
   POST /orders
   Создать заказ, посчитать цены и (неблокирующе) оповестить Telegram-агента
-------------------------------------------------------------------*/
router.post('/', async (req, res, next) => {
  try {
    const { storeId, items } = req.body;
    if (!storeId || !Array.isArray(items) || !items.length) {
      return res
        .status(400)
        .json({ error: 'storeId и непустой массив items обязательны' });
    }

    // 1) Берём модификатор и телеграм у текущего пользователя
    const customer = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        priceModifier: true,
        agent: { select: { telegramId: true } },
      },
    });
    if (!customer) {
      return res.status(404).json({ error: 'Покупатель не найден' });
    }

    const factor = 1 + ((customer.priceModifier ?? 0) / 100);

    // 2) Подтягиваем нужные продукты
    const productIds = items.map(i => i.productId);
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

    // 3) Считаем позиции и сумму
    let total = 0;
    const createItems = items.map(({ productId, qty }) => {
      const p = products.find(x => x.id === productId);
      if (!p) throw new Error(`Product ${productId} not found`);

      const activePromo = p.promos[0];
      const basePrice = p.nonModify
        ? p.basePrice
        : +(p.basePrice * factor).toFixed(2);
      const price = activePromo
        ? (
            (activePromo.applyModifier ?? true)
              ? +(activePromo.promoPrice * factor).toFixed(2)
              : activePromo.promoPrice
          )
        : basePrice;
      total += price * qty;
      return { productId, quantity: qty, price };
    });
    total = +total.toFixed(2);

    // 4) Создаём заказ
    const order = await prisma.order.create({
      data: {
        storeId: +storeId,
        userId:  req.user.id,
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
                agent: { select: { login: true, fullName: true, telegramId: true } },
              },
            },
          },
        },
        items: {
          include: { product: { select: { name: true, volume: true } } },
        },
        logs: orderLogsInclude,
      },
    });

    const source = detectOrderLogSource(req.user.role);
    const createdLog = await createOrderLogEntry({
      orderId: order.id,
      action: OrderLogAction.CREATED,
      source,
      actorId: req.user.id,
      actorRole: req.user.role,
      meta: {
        total,
        itemCount: createItems.length,
      },
    });
    order.logs = [createdLog];

    // 5) Отдаём ответ СРАЗУ — заказ создан
    res.status(201).json(order);

    // 6) Telegram-уведомление — НЕ блокируем, ошибки гасим внутри
    const tg = order.store.user.agent?.telegramId;
    if (tg) {
      const link = `https://tk-alcotorg.ru/orders/${order.id}`;
      const text =
        `🆕 Новый заказ #${order.id}\n` +
        `Покупатель: ${order.user.fullName}\n` +
        `Магазин: ${order.store.title}\n` +
        `Сумма: ${order.total.toFixed(2)} ₽\n\n` +
        `Перейти к заказу: ${link}`;

      // асинхронно, без await — чтобы сеть/Telegram не влияли на API
      setImmediate(() => {
        notifyAgent(tg, text).catch(err => {
          // на всякий пожарный — хотя notifyAgent уже ловит ошибки
          log('tg notify failed (extra catch):', err?.code || err?.message || err);
        });
      });
    }
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   GET /orders?status=[NEW|DONE]
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
            user: { select: { agent: { select: { login: true, fullName: true } } } },
          },
        },
        items: { include: { product: { select: { name: true, volume: true } } } },
        logs: orderLogsInclude,
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
-------------------------------------------------------------------*/
router.get('/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: +req.params.id },
      include: orderDetailsInclude,
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
    const existing = await prisma.order.findUnique({
      where: { id: +req.params.id },
      select: { id: true, status: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    const updated = await prisma.order.update({
      where: { id: existing.id },
      data: { status, agentComment: comment },
      include: orderDetailsInclude,
    });

    const logEntry = await createOrderLogEntry({
      orderId: updated.id,
      action: OrderLogAction.STATUS_CHANGED,
      source: detectOrderLogSource(req.user.role),
      actorId: req.user.id,
      actorRole: req.user.role,
      meta: {
        from: existing.status,
        to: status,
        comment: comment || undefined,
      },
    });
    updated.logs = [...(updated.logs || []), logEntry];

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   PATCH /orders/:orderId/items/:itemId  (ADMIN, AGENT)
   Обновить количество позиции в заказе
-------------------------------------------------------------------*/
router.patch('/:orderId/items/:itemId', async (req, res, next) => {
  try {
    if (!['ADMIN', 'AGENT', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const orderId = +req.params.orderId;
    const itemId = +req.params.itemId;
    const quantity = Number(req.body.quantity);

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'quantity должен быть положительным целым' });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        user: { select: { agentId: true } },
        store: { select: { managerId: true } },
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }
    if (order.status === 'DONE') {
      return res.status(400).json({ error: 'Нельзя редактировать завершённый заказ' });
    }
    if (req.user.role === 'AGENT' && order.user.agentId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к заказу' });
    }
    if (req.user.role === 'MANAGER' && order.store.managerId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к заказу' });
    }

    const orderItem = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      select: { id: true, quantity: true, productId: true },
    });
    if (!orderItem) {
      return res.status(404).json({ error: 'Позиция не найдена' });
    }

    await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: { quantity },
    });

    const logEntry = await createOrderLogEntry({
      orderId,
      action: OrderLogAction.ITEM_UPDATED,
      source: detectOrderLogSource(req.user.role),
      actorId: req.user.id,
      actorRole: req.user.role,
      meta: {
        itemId: orderItem.id,
        productId: orderItem.productId,
        from: orderItem.quantity,
        to: quantity,
      },
    });

    const updatedOrder = await recalcOrderTotalAndFetch(orderId);
    updatedOrder.logs = [...(updatedOrder.logs || []), logEntry];
    res.json(updatedOrder);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   DELETE /orders/:orderId/items/:itemId  (ADMIN, AGENT)
   Удалить позицию из заказа
-------------------------------------------------------------------*/
router.delete('/:orderId/items/:itemId', async (req, res, next) => {
  try {
    if (!['ADMIN', 'AGENT', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const orderId = +req.params.orderId;
    const itemId = +req.params.itemId;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        user: { select: { agentId: true } },
        store: { select: { managerId: true } },
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }
    if (order.status === 'DONE') {
      return res.status(400).json({ error: 'Нельзя редактировать завершённый заказ' });
    }
    if (req.user.role === 'AGENT' && order.user.agentId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к заказу' });
    }
    if (req.user.role === 'MANAGER' && order.store.managerId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к заказу' });
    }

    const orderItem = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      select: { id: true, quantity: true, productId: true },
    });
    if (!orderItem) {
      return res.status(404).json({ error: 'Позиция не найдена' });
    }

    await prisma.orderItem.delete({ where: { id: orderItem.id } });

    const logEntry = await createOrderLogEntry({
      orderId,
      action: OrderLogAction.ITEM_REMOVED,
      source: detectOrderLogSource(req.user.role),
      actorId: req.user.id,
      actorRole: req.user.role,
      meta: {
        itemId: orderItem.id,
        productId: orderItem.productId,
        quantity: orderItem.quantity,
      },
    });

    const updatedOrder = await recalcOrderTotalAndFetch(orderId);
    updatedOrder.logs = [...(updatedOrder.logs || []), logEntry];
    res.json(updatedOrder);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   POST /orders/:id/return-to-cart   (USER)
   Перенести заказ обратно в корзину
-------------------------------------------------------------------*/
router.post('/:id/return-to-cart', async (req, res, next) => {
  try {
    if (req.user.role !== 'USER') {
      return res.status(403).json({ error: 'Доступно только покупателям' });
    }

    const orderId = +req.params.id;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        store: { select: { id: true, userId: true } },
        items: { select: { productId: true, quantity: true } },
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }
    if (order.status === 'DONE') {
      return res.status(400).json({ error: 'Нельзя редактировать завершённый заказ' });
    }
    if (order.store.userId !== req.user.id) {
      return res.status(403).json({ error: 'Нет доступа к заказу' });
    }

    await prisma.$transaction(async tx => {
      const cart = await tx.cart.upsert({
        where: { userId_storeId: { userId: req.user.id, storeId: order.store.id } },
        update: {},
        create: { userId: req.user.id, storeId: order.store.id },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      if (order.items.length) {
        await tx.cartItem.createMany({
          data: order.items.map(item => ({
            cartId: cart.id,
            productId: item.productId,
            qty: item.quantity,
          })),
          skipDuplicates: true,
        });
      }

      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });
    });

    const totalQty = order.items.reduce((acc, item) => acc + item.quantity, 0);
    res.json({ movedToCart: true, storeId: order.store.id, items: order.items.length, totalQty });
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

async function recalcOrderTotalAndFetch(orderId) {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { price: true, quantity: true },
  });

  const total = items.reduce((acc, item) => acc + (item.price * item.quantity), 0);

  return prisma.order.update({
    where: { id: orderId },
    data: { total: +total.toFixed(2) },
    include: orderDetailsInclude,
  });
}
