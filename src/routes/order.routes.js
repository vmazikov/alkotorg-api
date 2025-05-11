import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { sendOrderTelegram } from '../utils/telegram.js';

const router = Router();

// POST /orders
router.post('/', async (req, res) => {
  const { storeId, items } = req.body; // items: [{productId, qty}]
  if (!items?.length) return res.status(400).json({ message: 'No items' });

  // calculate total
  const productIds = items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });

  const mapped = items.map((i) => {
    const p = products.find((p) => p.id === i.productId);
    const price = p.basePrice;
    return { ...i, price };
  });
  const total = mapped.reduce((sum, i) => sum + i.price * i.qty, 0);

  const order = await prisma.order.create({
    data: {
      userId: req.user.id,
      storeId,
      total,
      items: {
        createMany: {
          data: mapped.map((i) => ({
            productId: i.productId,
            price: i.price,
            quantity: i.qty,
          })),
        },
      },
    },
    include: { items: true },
  });

  await sendOrderTelegram(order);

  res.status(201).json(order);
});

// GET /orders
router.get('/', async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(orders);
});

export default router;
