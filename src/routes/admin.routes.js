import { Router } from 'express';

import usersRouter    from './admin.user.routes.js';
import productsRouter from './admin.product.routes.js';
import priceRouter    from './admin.price.routes.js';
// (можно подключить и другие админские под-роуты, например ordersRouter)

const router = Router();

// GET /admin → краткий ответ
router.get('/', (_req, res) => {
  res.json({ message: 'Admin API root' });
});

// Все пути /admin/users/* → admin.user.routes.js
router.use('/users', usersRouter);

// Все пути /admin/products/* → admin.product.routes.js
router.use('/products', productsRouter);

// Все пути /admin/price/* → admin.price.routes.js
router.use('/price', priceRouter);

export default router;
