import express           from 'express';
import cors              from 'cors';
import morgan            from 'morgan';
import swaggerUi         from 'swagger-ui-express';
import swaggerJsdoc      from 'swagger-jsdoc';

import authRoutes        from './routes/auth.routes.js';
import productRoutes     from './routes/product.routes.js';
import orderRoutes       from './routes/order.routes.js';
import adminRoutes       from './routes/admin.routes.js';
import cartRoutes        from './routes/cart.routes.js';
import storeRoutes       from './routes/store.routes.js';

import { authMiddleware } from './middlewares/auth.js';

const app = express();

// ─── Global middleware ───────────────────────────────────────────────
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// ─── Swagger UI ─────────────────────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Alkotorg API', version: '0.2.0' },
  },
  apis: ['./src/routes/*.js'],
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Public routes ───────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/products', productRoutes);

// ─── Protected routes ────────────────────────────────────────────────
// Все запросы к /orders требуют авторизации
app.use('/orders', authMiddleware, orderRoutes);

// Админка: один роутер для всех /admin/*
app.use('/admin', authMiddleware, adminRoutes);

// Корзина тоже под авторизацией
app.use('/cart', authMiddleware, cartRoutes);

// Магазины под авторизацией
app.use('/stores', authMiddleware, storeRoutes);

// Health check
app.get('/ping', authMiddleware, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// Catch-all 404
app.use('*', (_req, res) => {
  res.status(404).json({ message: 'Not found' });
});

export default app;
