// src/routes/order.routes.js
import { Router }         from 'express';
import prisma             from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import { notifyAgent }    from '../utils/teleg.js';

const router = Router();
router.use(authMiddleware);

/**
 * POST /orders
 * Оформление нового заказа.
 * body: { storeId: number, items: Array<{ productId:number, qty:number }> }
 * Цены рассчитываются с учётом promo и пользовательского priceModifier,
 * кроме товаров с nonModify=true.
 */
router.post('/', async (req, res, next) => {
  try {
    const { storeId, items } = req.body;
    if (!storeId || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'storeId и непустой массив items обязательны' });
    }

    // 1) Получаем modifier пользователя
    const { priceModifier } = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { priceModifier: true }
    });
    const factor = 1 + (priceModifier / 100);

    // 2) Берём продукты вместе с полями nonModify и активными promos
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

    // 3) Считаем total и готовим данные для позиций
    let total = 0;
    const itemCreates = items.map(({ productId, qty }) => {
      const p = products.find(x => x.id === productId);
      if (!p) throw new Error(`Product ${productId} not found`);

      // изъятие "сырых" цен
      const raw = p.promos.length
        ? p.promos[0].promoPrice
        : p.basePrice;

      // применяем modifier, если нужно
      const price = p.nonModify
        ? raw
        : + (raw * factor).toFixed(2);

      total += price * qty;

      return {
        productId,
        quantity: qty,
        price
      };
    });
    total = +total.toFixed(2);

    // 4) Создаём заказ вместе с позициями
    const order = await prisma.order.create({
      data: {
        storeId: +storeId,
        userId:  req.user.id,
        total,
        items: {
          create: itemCreates
        }
      },
      include: {
        user:  { select: { login: true, fullName: true } },
        store: {
          select: {
            title: true,
            user: {
              select: {
                agent: {
                  select: { login: true, fullName: true, phone: true }
                },
                fullName: true
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
      }
    });

    console.log('🆕 New order created:', order);

    // 5) Уведомляем агента
    // const tg = order.store.user.agent?.telegramId;
    // if (tg) {
    //   notifyAgent(
    //     tg,
    //     `🆕 Новый заказ #${order.id}\n` +
    //     `Магазин: ${order.store.title}\n` +
    //     `Сумма: ${order.total.toFixed(2)} ₽`
    //   );
    // }

    return res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /orders?status=[NEW|DONE]
 * Возвращает заказы, отфильтрованные по роли и по опциональному статусу.
 */
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const { role, id: userId } = req.user;

    const where = {};
    if (role === 'AGENT') {
      where.store = { user: { agentId: userId } };
    } else if (role === 'USER') {
      where.store = { userId };
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
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json(orders);
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
    return res.json(order);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /orders/:id/status
 * Смена статуса и комментарий (только AGENT и ADMIN)
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
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
