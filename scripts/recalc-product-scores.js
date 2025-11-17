// scripts/recalc-product-scores.js
// Пересчёт ProductScore за последние 90 дней
import prisma from '../src/utils/prisma.js';

const LOOKBACK_DAYS = 90;
const NEW_PRODUCT_DAYS = 30;

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const newSince = new Date(Date.now() - NEW_PRODUCT_DAYS * 24 * 60 * 60 * 1000);

  const [products, orderItems] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, isNew: true, dateAdded: true, createdAt: true },
      where: { isArchived: false },
    }),
    prisma.orderItem.findMany({
      where: { order: { createdAt: { gte: since }, status: 'DONE' } },
      select: { productId: true, quantity: true, order: { select: { userId: true } } },
    }),
  ]);

  const stats = new Map();

  for (const item of orderItems) {
    const entry = stats.get(item.productId) || { qty: 0, orders: 0, users: new Set() };
    entry.qty += item.quantity || 0;
    entry.orders += 1;
    if (item.order?.userId) entry.users.add(item.order.userId);
    stats.set(item.productId, entry);
  }

  const allStats = Array.from(stats.values());
  const maxQty = allStats.reduce((m, s) => Math.max(m, s.qty), 0);
  const maxOrders = allStats.reduce((m, s) => Math.max(m, s.orders), 0);
  const maxUsers = allStats.reduce((m, s) => Math.max(m, s.users.size), 0);

  let updated = 0;

  for (const product of products) {
    const stat = stats.get(product.id);
    const qtyNorm = maxQty ? (stat?.qty || 0) / maxQty : 0;
    const ordersNorm = maxOrders ? (stat?.orders || 0) / maxOrders : 0;
    const usersNorm = maxUsers ? (stat?.users?.size || 0) / maxUsers : 0;

    const novelty = (product.isNew || (product.dateAdded && product.dateAdded >= newSince)) ? 0.1 : 0;

    // Весовая формула: qty 50%, orders 30%, users 20%, лёгкий бонус за новинки
    const autoScore = +((0.5 * qtyNorm) + (0.3 * ordersNorm) + (0.2 * usersNorm) + novelty).toFixed(4);

    await prisma.productScore.upsert({
      where: { productId: product.id },
      update: { score: autoScore },
      create: { productId: product.id, score: autoScore },
    });
    updated += 1;
  }

  console.log('[recalc-product-scores] updated', updated, 'products; window days:', LOOKBACK_DAYS);
}

main()
  .catch(err => {
    console.error('[recalc-product-scores] error', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
