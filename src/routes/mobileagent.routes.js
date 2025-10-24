import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';

const router = Router();

// защита ВСЕХ /mobileagent/*
router.use(authMiddleware);
router.use(role(['AGENT']));

/**
 * GET /mobileagent/orders?limit=50&cursor=...
 * Требует роль AGENT. Возвращает только заказы магазинов текущего агента со статусом NEW.
 * Цены не отправляем — планшет возьмёт актуальные из своей MobileAgent БД.
 */
router.get('/orders', role(['AGENT']), async (req, res) => {
  try {
    const agentId = req.user?.id ?? req.user?.userId; // поддержим оба варианта
    if (!agentId) return res.status(401).json({ error: 'Unauthorized' });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

    // магазины агента
    const stores = await prisma.store.findMany({
      where: { agentId },
      select: { id: true, maShopId: true }
    });

    if (!stores.length) return res.json({ orders: [], nextCursor: null });

    const storeIds = stores.map(s => s.id);

    const where = {
      storeId: { in: storeIds },
      status: 'NEW'
    };

    const orders = await prisma.order.findMany({
      where,
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        store: { select: { maShopId: true } },
        user:  { select: { id: true } },
        items: { include: { product: { select: { productId: true } } } }
      }
    });

    const nextCursor = orders.length === limit
      ? String(orders[orders.length - 1].id)
      : null;

    // MA AgentID можно хранить у самого агента (nullable ок)
    const agent = await prisma.user.findUnique({
      where: { id: agentId },
      select: { maAgentId: true }
    });

    // DTO
    const out = orders.map(o => ({
      orderId: o.id,
      shopId: o.store.maShopId || null,     // MA ShopID (plain hex)
      agentId: agent?.maAgentId || null,    // MA AgentID (plain hex) — если заполнен
      priceTypeCode: 17,                    // как договорились
      vatDefault: 0.18,                     // по умолчанию
      note: o.agentComment || null,
      items: o.items.map(it => ({
        productId: it.product.productId,    // MA ProductID (plain hex)
        qty: it.quantity
      }))
    }));

    return res.json({ orders: out, nextCursor });
  } catch (e) {
    console.error('[GET /mobileagent/orders]', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /mobileagent/orders/:id/mark-applied
 * Body: { maInvoiceIdHex?: string }
 * Переводит заказ в DONE + сохраняет maAppliedAt и (если дан) maInvoiceIdHex.
 */
router.post('/orders/:id/mark-applied', role(['AGENT']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const agentId = req.user.id;
    const { maInvoiceIdHex } = req.body || {};

    const order = await prisma.order.findUnique({
      where: { id },
      include: { store: true }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.store.agentId !== agentId)
      return res.status(403).json({ error: 'Forbidden' });

    // идемпотентность
    if (order.status === 'DONE') return res.json({ ok: true });

    await prisma.order.update({
      where: { id },
      data: {
        status: 'DONE',
        maAppliedAt: new Date(),
        ...(maInvoiceIdHex ? { maInvoiceIdHex } : {}),
        maError: null
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /mobileagent/orders/:id/mark-applied]', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /mobileagent/orders/:id/mark-failed
 * Body: { reason: string }
 * Логирует ошибку устройства. Статус оставляем NEW, чтобы можно было отработать позже.
 */
router.post('/orders/:id/mark-failed', role(['AGENT']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const agentId = req.user.id;
    const { reason } = req.body || {};

    const order = await prisma.order.findUnique({
      where: { id },
      include: { store: true }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.store.agentId !== agentId)
      return res.status(403).json({ error: 'Forbidden' });

    await prisma.order.update({
      where: { id },
      data: {
        maError: (reason || '').slice(0, 500)
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /mobileagent/orders/:id/mark-failed]', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
