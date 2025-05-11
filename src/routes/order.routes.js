// src/routes/order.routes.js
import { Router }            from 'express';
import prisma                from '../utils/prisma.js';
import { authMiddleware }    from '../middlewares/auth.js';
import { notifyAgent }       from '../utils/teleg.js';

const router = Router();

// Все эндпоинты защищены JWT
router.use(authMiddleware);

/**
 * POST /orders
 * Оформление нового заказа
 * body: { storeId: number, items: Array<{ productId: number, qty: number }> }
 */
router.post('/', async (req, res, next) => {
  try {
    const { storeId, items } = req.body;

    // Валидация
    if (!storeId || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'storeId и непустой массив items обязательны' });
    }

    // Получаем базовые цены товаров
    const products = await prisma.product.findMany({
      where: { id: { in: items.map(i => i.productId) } },
      select: { id: true, basePrice: true },
    });

    // Считаем общую сумму
    const total = items.reduce((sum, { productId, qty }) => {
      const prod = products.find(p => p.id === productId);
      return sum + (prod?.basePrice ?? 0) * qty;
    }, 0);

    // Создаём заказ вместе с позициями
    const order = await prisma.order.create({
      data: {
        storeId: +storeId,
        userId:  req.user.id,
        total,
        items: {
          create: items.map(({ productId, qty }) => {
            const prod = products.find(p => p.id === productId);
            return {
              productId,
              quantity: qty,
              price:     prod?.basePrice ?? 0,
            };
          }),
        },
      },
      include: {
        store: {
          include: {
            user: {
              include: {
                agent: true,    // берём телеграм-ID агента
              },
            },
          },
        },
      },
    });
    console.log('🛒 New order created:', JSON.stringify(order, null, 2));
    // Отправляем уведомление агенту, если у него есть telegramId
    const tgId = order.store.user.agent?.telegramId;
    if (tgId) {
      notifyAgent(
        tgId,
        `🆕 Новый заказ #${order.id}\n` +
        `Магазин: ${order.store.title}\n` +
        `Сумма: ${total.toFixed(2)} ₽`
      );
    }

    return res.status(201).json(order);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /orders?status=NEW
 * Список заказов, отфильтрованных по роли:
 * - ADMIN видит все
 * - AGENT видит заказы своих клиентов
 * - USER видит заказы из своих магазинов
 * - MANAGER видит заказы своего магазина
 */
router.get('/', async (req, res, next) => {
  try {
    const { status = 'NEW' } = req.query;
    const role               = req.user.role;
    const userId             = req.user.id;

    // Дополним фильтр в зависимости от роли
    let agentFilter = {};
    if (role === 'AGENT') {
      agentFilter = { store: { user: { agentId: userId } } };
    } else if (role === 'USER') {
      agentFilter = { store: { userId } };
    } else if (role === 'MANAGER') {
      agentFilter = { store: { managerId: userId } };
    }

    const orders = await prisma.order.findMany({
      where: {
        status,
        ...agentFilter,
      },
      include: {
        store: true,
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(orders);
  } catch (err) {
    return next(err);
  }
});

/**
 * PUT /orders/:id/status
 * Агент изменяет статус и добавляет комментарий
 * body: { status: 'DONE', comment?: string }
 */
router.put('/:id/status', async (req, res, next) => {
  try {
    const orderId      = +req.params.id;
    const { status, comment = '' } = req.body;

    if (!['NEW','DONE'].includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data:  { status, agentComment: comment },
    });

    return res.json(updated);
  } catch (err) {
    return next(err);
  }
});

export default router;
