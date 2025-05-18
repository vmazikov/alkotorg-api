// src/routes/admin.routes.js
import { Router } from 'express';
import { role }   from '../middlewares/auth.js';

import usersRouter    from './admin.user.routes.js';
import productsRouter from './admin.product.routes.js';
import priceRouter    from './admin.price.routes.js';
import storesRouter   from './admin.store.routes.js';
import stockRulesRouter from './admin.stockRules.routes.js';

const router = Router();

// GET /admin → краткий ответ
router.get('/', (_req, res) => {
  res.json({ message: 'Admin API root' });
});

// Доступ /admin/users/* для ADMIN и AGENT
router.use(
  '/users',
  role(['ADMIN','AGENT']),
  usersRouter
);

// Доступ /admin/stores/* для ADMIN и AGENT
router.use(
  '/stores',
  role(['ADMIN','AGENT']),
  storesRouter
);

// Доступ /admin/products/* только для ADMIN
router.use(
  '/products',
  role(['ADMIN']),
  productsRouter
);

// Доступ /admin/price/* только для ADMIN
router.use(
  '/price',
  role(['ADMIN']),
  priceRouter
);
// Доступ /admin/stock-rules/* только для ADMIN
router.use(
  '/stock-rules',
  role(['ADMIN']),
  stockRulesRouter
);

export default router;
