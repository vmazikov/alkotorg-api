import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware);

/* helper: ensure cart record */
async function getCartId(userId, storeId) {
  let cart = await prisma.cart.findUnique({ where: { userId_storeId: { userId, storeId } } });
  if (!cart) cart = await prisma.cart.create({ data: { userId, storeId } });
  return cart.id;
}

/* GET /cart?storeId= */
router.get('/', async (req, res) => {
  const storeId = +req.query.storeId;
  const cart = await prisma.cart.findUnique({
    where: { userId_storeId: { userId: req.user.id, storeId } },
    include: { items: { include: { product: true } } },
  });
  res.json(cart?.items || []);
});

/* POST /cart/items */
router.post('/items', async (req, res) => {
  const { storeId, productId, qty } = req.body;
  const cartId = await getCartId(req.user.id, storeId);

  await prisma.cartItem.upsert({
    where : { cartId_productId: { cartId, productId } },
    update: { qty },
    create: { cartId, productId, qty },
  });
  res.sendStatus(204);
});

/* PUT /cart/items/:productId */
router.put('/items/:productId', async (req, res) => {
  const { storeId, qty } = req.body;
  const productId = +req.params.productId;
  const cartId = await getCartId(req.user.id, storeId);

  await prisma.cartItem.update({
    where: { cartId_productId: { cartId, productId } },
    data : { qty },
  });
  res.sendStatus(204);
});

/* DELETE /cart/items/:productId */
router.delete('/items/:productId', async (req, res) => {
  const storeId   = +req.query.storeId;
  const productId = +req.params.productId;
  const cartId    = await getCartId(req.user.id, storeId);

  await prisma.cartItem.delete({
    where: { cartId_productId: { cartId, productId } },
  });
  res.sendStatus(204);
});

/* DELETE /cart?storeId= */
router.delete('/', async (req, res) => {
  const cart = await prisma.cart.findUnique({
    where: { userId_storeId: { userId: req.user.id, storeId: +req.query.storeId } },
  });
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  res.sendStatus(204);
});

export default router;
