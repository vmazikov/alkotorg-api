// src/routes/auto-pick.routes.js
import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import { buildImageUrl } from '../utils/imageStorage.js';

const router = Router();
router.use(authMiddleware);

const clampNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getUserPriceFactor = async userId => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { priceModifier: true },
  });
  return 1 + ((user?.priceModifier ?? 0) / 100);
};

const applyPrice = (product, factor) => {
  const fix = n => +n.toFixed(2);
  const activePromo = product.promos?.[0];
  const basePrice = product.nonModify ? product.basePrice : fix(product.basePrice * factor);
  const price = activePromo
    ? ((activePromo.applyModifier ?? true) ? fix(activePromo.promoPrice * factor) : activePromo.promoPrice)
    : basePrice;
  return { price, basePrice, promoId: activePromo?.id ?? null };
};

const adjustBoxing = (qty, boxSize, stock) => {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (!boxSize || boxSize <= 1) return Math.max(0, Math.min(qty, stock ?? qty));

  let planned = qty;

  if (planned >= boxSize) {
    const boxes = Math.max(1, Math.floor(planned / boxSize));
    planned = boxes * boxSize;
  } else {
    const halfBox = Math.max(1, Math.round(boxSize / 2));
    if (planned >= halfBox * 0.5) {
      planned = halfBox;
    }
  }

  return Math.max(0, Math.min(planned, stock ?? planned));
};

const buildCategoryWeights = (historyByCategory, profile, availableCategories) => {
  const total = Array.from(historyByCategory.values()).reduce((acc, v) => acc + v, 0);
  if (total > 0) {
    return Object.fromEntries(
      Array.from(historyByCategory.entries()).map(([cat, qty]) => [cat, qty / total])
    );
  }

  if (profile?.categoryWeights && typeof profile.categoryWeights === 'object') {
    const entries = Object.entries(profile.categoryWeights || {})
      .filter(([, weight]) => Number.isFinite(+weight) && +weight > 0);
    const sum = entries.reduce((acc, [, w]) => acc + +w, 0);
    if (sum > 0) {
      return Object.fromEntries(entries.map(([cat, w]) => [cat, +w / sum]));
    }
  }

  const unique = [...new Set(availableCategories)];
  const weight = unique.length ? 1 / unique.length : 0;
  return Object.fromEntries(unique.map(cat => [cat, weight]));
};

const findCategoryRule = (rules, category, volume) =>
  rules.find(r => r.category === category && (r.volume == null || r.volume === volume));

const normalizeImage = images => {
  const first = images?.[0];
  return first ? buildImageUrl(first.fileName) : null;
};

router.post('/generate', async (req, res, next) => {
  try {
    const {
      minSum,
      maxSum,
      maxPricePerItem,
      assortmentMode = 0,
      excludeCategories = [],
      storeId = 0,
    } = req.body || {};

    const mode = clampNumber(assortmentMode, 0);
    const minBudget = clampNumber(minSum, 0);
    const maxBudget = Number.isFinite(+maxSum) ? +maxSum : null;
    const maxPrice = Number.isFinite(+maxPricePerItem) ? +maxPricePerItem : null;
    const excluded = new Set((excludeCategories || []).map(String));

    const factor = await getUserPriceFactor(req.user.id);

    const [orders, orderItems, rules, profile] = await Promise.all([
      prisma.order.findMany({
        where: { userId: req.user.id },
        select: { total: true },
      }),
      prisma.orderItem.findMany({
        where: { order: { userId: req.user.id } },
        include: {
          order: { select: { createdAt: true } },
          product: { select: { type: true, volume: true } },
        },
      }),
      prisma.categoryRule.findMany({ where: { enabled: true } }),
      prisma.assortmentProfile.findFirst({
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      }),
    ]);

    const avgOrderTotal =
      orders.length > 0
        ? orders.reduce((acc, o) => acc + (o.total || 0), 0) / orders.length
        : 0;

    const targetTotal = (maxBudget ?? null) != null
      ? maxBudget
      : (minBudget || avgOrderTotal || 20000);
    const upperBudget = maxBudget ?? targetTotal * 1.05;
    const lowerBudget = minBudget || targetTotal * 0.8;

    const productHistory = new Map(); // productId -> { qty, orders }
    const categoryHistory = new Map(); // category -> qty

    for (const item of orderItems) {
      const key = item.productId;
      const prev = productHistory.get(key) || { qty: 0, orders: 0 };
      productHistory.set(key, { qty: prev.qty + item.quantity, orders: prev.orders + 1 });

      const cat = item.product?.type || 'uncategorized';
      categoryHistory.set(cat, (categoryHistory.get(cat) || 0) + item.quantity);
    }

    const products = await prisma.product.findMany({
      where: {
        isArchived: false,
        stock: { gt: 0 },
        ...(excluded.size ? { type: { notIn: Array.from(excluded) } } : {}),
      },
      include: {
        promos: { where: { expiresAt: { gt: new Date() } }, orderBy: { expiresAt: 'desc' }, take: 1 },
        images: { orderBy: { order: 'asc' }, take: 1 },
      },
    });

    const productScores = await prisma.productScore.findMany({
      where: { productId: { in: products.map(p => p.id) } },
    });
    const scoreByProduct = new Map(productScores.map(s => [s.productId, s]));

    const categoryWeights = buildCategoryWeights(
      categoryHistory,
      profile,
      products.map(p => p.type || 'uncategorized')
    );
    const fallbackCategoryWeight =
      Object.keys(categoryWeights).length > 0
        ? 1 / Math.max(Object.keys(categoryWeights).length, 1)
        : 1 / Math.max(products.length, 1);

    const items = [];
    const spentByCategory = new Map();
    let total = 0;

    const seen = new Set();
    const sortedProducts = [...products]
      .map(p => {
        const { price } = applyPrice(p, factor);
        return { ...p, price };
      })
      .filter(p => (maxPrice ? p.price <= maxPrice : true))
      .sort((a, b) => b.price - a.price); // базовая сортировка для стабильности

    sortedProducts.sort((a, b) => {
      const aScore = scoreByProduct.get(a.id);
      const bScore = scoreByProduct.get(b.id);

      const aUser = productHistory.get(a.id)?.qty || 0;
      const bUser = productHistory.get(b.id)?.qty || 0;

      const aGlobal = (aScore?.manualScore ?? aScore?.score ?? 0);
      const bGlobal = (bScore?.manualScore ?? bScore?.score ?? 0);

      const aBoost =
        (aScore?.promoBoost ?? 1) *
        (aScore?.noveltyBoost ?? 1) *
        (a.isNew ? 1.15 : 1) *
        (!productHistory.has(a.id) ? (1 + 0.15 * mode) : 1);
      const bBoost =
        (bScore?.promoBoost ?? 1) *
        (bScore?.noveltyBoost ?? 1) *
        (b.isNew ? 1.15 : 1) *
        (!productHistory.has(b.id) ? (1 + 0.15 * mode) : 1);

      const aFinal = (0.6 * aUser + 0.4 * aGlobal) * aBoost;
      const bFinal = (0.6 * bUser + 0.4 * bGlobal) * bBoost;

      return bFinal - aFinal;
    });

    for (const product of sortedProducts) {
      if (total >= upperBudget && total >= lowerBudget) break;
      if (seen.has(product.id)) continue;
      seen.add(product.id);

      const category = product.type || 'uncategorized';
      const categoryWeight = categoryWeights[category] ?? fallbackCategoryWeight;
      const targetForCategory = categoryWeight ? targetTotal * categoryWeight : targetTotal;
      const alreadySpent = spentByCategory.get(category) || 0;
      const remainingForCategory = Math.max(targetForCategory - alreadySpent, 0);

      const { price } = applyPrice(product, factor);
      if (price <= 0) continue;

      const history = productHistory.get(product.id);
      const avgQty = history ? Math.max(1, Math.round(history.qty / history.orders)) : 1;

      const rule = findCategoryRule(rules, category, product.volume);
      const minRuleQty = rule?.minQty || 0;

      const desiredByBudget = remainingForCategory > 0
        ? Math.max(1, Math.floor(remainingForCategory / price))
        : avgQty;

      let qty = Math.max(desiredByBudget, minRuleQty, avgQty);

      if (maxBudget) {
        const room = maxBudget - total;
        const maxAffordable = Math.floor(room / price);
        qty = Math.min(qty, maxAffordable);
      }

      qty = adjustBoxing(qty, product.quantityInBox, product.stock);
      if (!qty || qty <= 0) continue;

      const lineTotal = +(price * qty).toFixed(2);
      if (lineTotal <= 0) continue;
      if (maxBudget && total + lineTotal > maxBudget * 1.05) continue;

      total = +(total + lineTotal).toFixed(2);
      spentByCategory.set(category, (spentByCategory.get(category) || 0) + lineTotal);

      items.push({
        productId: product.id,
        qty,
        price,
        total: lineTotal,
        name: product.name,
        category,
        volume: product.volume,
        boxSize: product.quantityInBox || null,
        stock: product.stock,
        img: normalizeImage(product.images) || product.img || null,
      });
    }

    if (!items.length) {
      return res.status(400).json({ error: 'Не удалось подобрать товары под заданные параметры' });
    }

    const draft = await prisma.autoPickDraft.create({
      data: {
        userId: req.user.id,
        storeId: +storeId || 0,
        params: {
          minSum: minBudget || null,
          maxSum: maxBudget,
          maxPricePerItem: maxPrice,
          assortmentMode: mode,
          excludeCategories: Array.from(excluded),
          factor,
        },
        items,
        total,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 час
      },
    });

    res.json({ draftId: draft.id, total, items });
  } catch (err) {
    next(err);
  }
});

router.get('/drafts/:id', async (req, res, next) => {
  try {
    const draft = await prisma.autoPickDraft.findUnique({
      where: { id: req.params.id },
    });
    if (!draft || draft.userId !== req.user.id) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json(draft);
  } catch (err) {
    next(err);
  }
});

const ensureCart = async (userId, storeId = 0) => {
  const cart = await prisma.cart.upsert({
    where: { userId_storeId: { userId, storeId } },
    update: {},
    create: { userId, storeId },
  });
  return cart.id;
};

router.post('/apply/:draftId', async (req, res, next) => {
  try {
    const { storeId = 0 } = req.body || {};
    const draft = await prisma.autoPickDraft.findUnique({
      where: { id: req.params.draftId },
    });
    if (!draft || draft.userId !== req.user.id) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    if (draft.status !== 'PENDING') {
      return res.status(400).json({ error: 'Draft already processed' });
    }
    if (draft.expiresAt && draft.expiresAt < new Date()) {
      await prisma.autoPickDraft.update({
        where: { id: draft.id },
        data: { status: 'EXPIRED' },
      });
      return res.status(400).json({ error: 'Draft expired' });
    }

    const parsedItems = Array.isArray(draft.items) ? draft.items : [];
    if (!parsedItems.length) {
      return res.status(400).json({ error: 'Draft has no items' });
    }

    const productIds = parsedItems.map(i => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isArchived: false, stock: { gt: 0 } },
    });
    const byId = new Map(products.map(p => [p.id, p]));

    const cartId = await ensureCart(req.user.id, +storeId || draft.storeId || 0);

    for (const item of parsedItems) {
      const product = byId.get(item.productId);
      if (!product) continue;
      const qty = Math.min(product.stock, item.qty || 0);
      if (!qty) continue;

      await prisma.cartItem.upsert({
        where: { cartId_productId: { cartId, productId: product.id } },
        update: { qty },
        create: { cartId, productId: product.id, qty },
      });
    }

    await prisma.autoPickDraft.update({
      where: { id: draft.id },
      data: { status: 'APPLIED' },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
