// src/routes/admin.routes.js
import { Router } from 'express'
import { role }   from '../middlewares/auth.js'

import usersRouter       from './admin.user.routes.js'
import storesRouter      from './admin.store.routes.js'
import productsRouter    from './admin.product.routes.js'
import priceRouter       from './admin.price.routes.js'
import stockRulesRouter  from './admin.stockRules.routes.js'
import promoRoutes       from './admin.promo.routes.js'
import priceExportRouter from './admin.priceExport.routes.js'
import notificationsRouter from './admin.notification.routes.js'
import mobileagentOrdersRouter from './admin.mobileagent-orders.routes.js'
import autoPickRouter from './admin.auto-pick.routes.js'

const router = Router()

// GET /admin → краткий ответ
router.get('/', (_req, res) => {
  res.json({ message: 'Admin API root' })
})

// /admin/users/* доступно ADMIN и AGENT
router.use(
  '/users',
  role(['ADMIN', 'AGENT']),
  usersRouter
)

// /admin/stores/* доступно ADMIN и AGENT
router.use(
  '/stores',
  role(['ADMIN', 'AGENT']),
  storesRouter
)

// /admin/products/* доступно только ADMIN
router.use(
  '/products',
  role(['ADMIN']),
  productsRouter
)

// /admin/price/* доступно только ADMIN
router.use(
  '/price',
  role(['ADMIN','AGENT']),
  priceRouter
)

// /admin/stock-rules/* доступно только ADMIN
router.use(
  '/stock-rules',
  role(['ADMIN']),
  stockRulesRouter
)

// /admin/export/* доступно только ADMIN
router.use(
  '/export',
  role(['ADMIN']),
  priceExportRouter
)

router.use(
  '/notifications',
  role(['ADMIN']),
  notificationsRouter
)
// /admin/mobileagent-orders/* доступно ADMIN и AGENT
router.use(
  '/mobileagent-orders',
  role(['ADMIN', 'AGENT']),
  mobileagentOrdersRouter
)

// /admin/promos/* доступно только ADMIN
router.use(
  '/',
  role(['ADMIN']),
  promoRoutes
)

router.use(
  '/auto-pick',
  role(['ADMIN']),
  autoPickRouter
)



export default router
