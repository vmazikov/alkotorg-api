// src/routes/cart.routes.js
import { Router }       from 'express';
import prisma           from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

/*───────────────────────────────────────────────────────────────────*/
/* helpers                                                          */
/*───────────────────────────────────────────────────────────────────*/

/** гарантируем запись Cart, возвращаем id */
async function ensureCart(userId, storeId = 0) {
  const cart = await prisma.cart.upsert({
    where  : { userId_storeId: { userId, storeId } },
    update : {},
    create : { userId, storeId }
  });
  return cart.id;
}

/** финальная цена с учётом promo + надбавки */
function calcPrice(product, priceModifier) {
  const base = product.promos.length
    ? product.promos[0].promoPrice
    : product.basePrice;
  return +(base * (1 + priceModifier)).toFixed(2);
}

/*───────────────────────────────────────────────────────────────────*/
/* GET /cart?storeId=                                               */
/*───────────────────────────────────────────────────────────────────*/
router.get('/', async (req, res, next) => {
  try {
    const storeId = +req.query.storeId || 0;

    /* берём надбавку пользователя */
    const { priceModifier } = await prisma.user.findUnique({
      where : { id: req.user.id },
      select: { priceModifier: true }
    });

    /* корзина + продукты + действующие акции */
    const cart = await prisma.cart.findUnique({
      where  : { userId_storeId: { userId: req.user.id, storeId } },
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

    /* маппим в формат, который удобно рендерить на фронте */
    const items = (cart?.items || []).map(i => {
      const price = calcPrice(i.product, priceModifier);
      return {
        productId : i.productId,
        name      : i.product.name,
        volume    : i.product.volume,
        degree    : i.product.degree,
        qty       : i.qty,
        price,                // цена за штуку
        totalItem : +(price * i.qty).toFixed(2)
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
