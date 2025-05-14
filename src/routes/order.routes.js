// src/routes/order.routes.js
import { Router }         from 'express';
import prisma             from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import { notifyAgent }    from '../utils/teleg.js';

const router = Router();
router.use(authMiddleware);

/**
 * POST /orders
 * Создать новый заказ:
 * – рассчитывает цены с promo и priceModifier (кроме nonModify)
 * – сохраняет его и возвращает
 * – уведомляет Telegram-агента покупателя (если он привязан)
 */
router.post('/', async (req, res, next) => {
  try {
    const { storeId, items } = req.body;
    if (!storeId || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'storeId и непустой массив items обязательны' });
    }

    // 1) Получаем у покупателя priceModifier и telegramId его агента
    const customer = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        priceModifier: true,
        agent: {
          select: { telegramId: true }
        }
      }
    });
    if (!customer) {
      return res.status(404).json({ error: 'Покупатель не найден' });
    }
    const factor = 1 + (customer.priceModifier / 100);

    // 2) Загружаем все нужные продукты
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
          take: 1
        }
      }
    });

    // 3) Считаем итог и формируем позиции для вложенного create
    let total = 0;
    const createItems = items.map(({ productId, qty }) => {
      const p = products.find(x => x.id === productId);
      if (!p) throw new Error(`Product ${productId} not found`);

      const raw = p.promos.length ? p.promos[0].promoPrice : p.basePrice;
      const price = p.nonModify ? raw : +((raw * factor).toFixed(2));
      total += price * qty;
      return { productId, quantity: qty, price };
    });
    total = +total.toFixed(2);

    // 4) Создаем заказ вместе с позициями, включая вложенные данные
    const order = await prisma.order.create({
      data: {
        storeId: +storeId,
        userId:  req.user.id,
        total,
        items: { create: createItems }
      },
      include: {
        user: { select: { login: true, fullName: true } },
        store: {
          select: {
            title: true,
            user: {
              select: {
                agent: {
                  select: { login: true, fullName: true, telegramId: true }
                },
                fullName: true
              }
            }
          }
        },
        items: {
          include: {
            product: { select: { name: true, volume: true } }
          }
        }
      }
    });

    console.log('🆕 New order created:', order);

    // 5) Уведомляем Telegram-агента покупателя
    const tg = order.store.user.agent?.telegramId;
    if (tg) {
      const link = `https://your-frontend.com/orders/${order.id}`;
      const text =
        `🆕 Новый заказ #${order.id}\n` +
        `Покупатель: ${order.user.fullName}\n` +
        `Магазин: ${order.store.title}\n` +
        `Сумма: ${order.total.toFixed(2)} ₽\n\n` +
        `Перейти к заказу: ${link}`;
      await notifyAgent(tg, text);
    }

    return res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /orders?status=[NEW|DONE]
 * Список заказов с учётом роли:
 * – AGENT   → заказы клиентов (user.agentId === agent.id)
 * – USER    → свои заказы (order.userId)
 * – MANAGER → заказы в его магазинах (store.managerId)
 * – ADMIN   → все
 * Можно опционально фильтровать по статусу.
 */
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const { role, id: userId } = req.user;

    const where = {};
    if (role === 'AGENT') {
      where.user = { agentId: userId };
    } else if (role === 'USER') {
      where.userId = userId;
    } else if (role === 'MANAGER') {
      where.store = { managerId: userId };
    }
    if (status && ['NEW','DONE'].includes(status)) {
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
                agent: {
                  select: { login: true, fullName: true }
                }
              }
            }
          }
        },
        items: {
          include: {
            product: {
              select: { name: true, volume: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(orders);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /orders/:id
 * Детализация одного заказа
 */
router.get('/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: +req.params.id },
      include: {
        user:  { select: { login: true, fullName: true } },
        store: {
          select: {
            title: true,
            user: {
              select: {
                agent: { select: { login: true, fullName: true } }
              }
            }
          }
        },
        items: {
          include: {
            product: { select: { name: true, volume: true } }
          }
        }
      }
    });
    if (!order) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /orders/:id/status
 * Смена статуса заказа и запись agentComment (AGENT и ADMIN)
 */
router.put('/:id/status', async (req, res, next) => {
  try {
    const { status, comment = '' } = req.body;
    if (!['NEW','DONE'].includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }
    const updated = await prisma.order.update({
      where: { id: +req.params.id },
      data: { status, agentComment: comment }
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
