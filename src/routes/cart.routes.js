// src/routes/cart.routes.js
import { Router }         from 'express';
import prisma             from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

/*───────────────────────────────────────────────────────────────────*/
/* helpers                                                          */
/*───────────────────────────────────────────────────────────────────*/

/** гарантируем запись Cart, возвращаем id */
async function ensureCart(userId, storeId = 0) {
  const cart = await prisma.cart.upsert({
    where: { userId_storeId: { userId, storeId } },
    update: {},
    create: { userId, storeId }
  });
  return cart.id;
}

/*───────────────────────────────────────────────────────────────────*/
/* GET /cart?storeId=                                               */
/*───────────────────────────────────────────────────────────────────*/
router.get('/', async (req, res, next) => {
  try {
    const storeId = +req.query.storeId || 0;

    // 1) Получаем priceModifier проценты пользователя
    const { priceModifier } = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { priceModifier: true }
    });
    // Превращаем в множитель: 10% → 0.10, factor = 1.10
    const factor = 1 + (priceModifier / 100);

    // 2) Загружаем корзину вместе с продуктами и их текущими акциями
    const cart = await prisma.cart.findUnique({
      where: { userId_storeId: { userId: req.user.id, storeId } },
      include: {
        items: {
          include: {
            product: {
              include: {
                promos: {
                  where: { expiresAt: { gt: new Date() } },
                  take : 1
                }
              }
            }
          },
          orderBy: { id: 'asc' }
        }
      }
    });

    // 3) Маппим items в финальный формат
    const items = (cart?.items || []).map(i => {
      const p = i.product;
      const qty = i.qty;

      // выбираем «сырую» цену: промо или базовую
      const raw = p.promos.length
        ? p.promos[0].promoPrice
        : p.basePrice;

      // если nonModify=true, не применяем factor
      const price = p.nonModify
        ? raw
        : + (raw * factor).toFixed(2);

      return {
        productId : p.id,
        name      : p.name,
        volume    : p.volume,
        degree    : p.degree,
        img       : p.img,          // ① картинка
        article   : p.article,      // ② если нужен артикул
        qty,
        price,                              // цена за штуку уже с модификатором
        totalItem : + (price * qty).toFixed(2)
      };
    });

    res.json(items);
  } catch (err) {
    next(err);
  }
});

/*───────────────────────────────────────────────────────────────────*/
/* POST /cart/items                     body { storeId, productId, qty } */
/*───────────────────────────────────────────────────────────────────*/
router.post('/items', async (req, res, next) => {
  try {
    const { storeId = 0, productId, qty = 1 } = req.body;
    const cartId = await ensureCart(req.user.id, +storeId);

    await prisma.cartItem.upsert({
      where : { cartId_productId: { cartId, productId: +productId } },
      update: { qty: +qty },
      create: { cartId, productId: +productId, qty: +qty }
    });

    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

/*───────────────────────────────────────────────────────────────────*/
/* PUT /cart/items/:productId         body { storeId, qty }         */
/*───────────────────────────────────────────────────────────────────*/
router.put('/items/:productId', async (req, res, next) => {
  try {
    const { storeId = 0, qty } = req.body;
    const productId            = +req.params.productId;
    const cartId               = await ensureCart(req.user.id, +storeId);

    await prisma.cartItem.update({
      where: { cartId_productId: { cartId, productId } },
      data : { qty: +qty }
    });

    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

/*───────────────────────────────────────────────────────────────────*/
/* DELETE /cart/items/:productId?storeId=                           */
/*───────────────────────────────────────────────────────────────────*/
router.delete('/items/:productId', async (req, res, next) => {
  try {
    const storeId   = +req.query.storeId || 0;
    const productId = +req.params.productId;
    const cartId    = await ensureCart(req.user.id, storeId);

    await prisma.cartItem.delete({
      where: { cartId_productId: { cartId, productId } }
    });

    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

/*───────────────────────────────────────────────────────────────────*/
/* DELETE /cart?storeId=                                             */
/*───────────────────────────────────────────────────────────────────*/
router.delete('/', async (req, res, next) => {
  try {
    const storeId = +req.query.storeId || 0;
    const cart    = await prisma.cart.findUnique({
      where: { userId_storeId: { userId: req.user.id, storeId } },
      select: { id: true }
    });
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

export default router;
