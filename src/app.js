// src/app.js
import './utils/telegramBot.js';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.routes.js';
import productRoutes from './routes/product.routes.js';
import orderRoutes from './routes/order.routes.js';
import adminRoutes from './routes/admin.routes.js';
import cartRoutes from './routes/cart.routes.js';
import storeRoutes from './routes/store.routes.js';
import filtersRouter from './routes/filters.routes.js';
import favoriteRoutes from './routes/favorite.routes.js';
import stockRules from './routes/stockRules.routes.js';
import mobileagent from './routes/mobileagent.routes.js';
import notificationRoutes from './routes/notification.routes.js';


import { authMiddleware } from './middlewares/auth.js';

const app = express();

// ─── __dirname для ESM ───────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Статика для изображений ─────────────────────────────────────────
// Отдаём файлы из папки uploads/img по запросу на /img/<filename>
app.use('/img', express.static(path.join(__dirname, '..', 'uploads', 'img')));

// Заглушка на случай, если файла нет
app.get('/img/:filename', (req, res) => {
  const filePath = path.join(__dirname, '..', 'uploads', 'img', req.params.filename);
  res.sendFile(filePath, err => {
    if (err) {
      res.sendFile(path.join(__dirname, '..', 'uploads', 'img', 'placeholder.png'));
    }
  });
});

// ─── Global middleware ───────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://tk-alcotorg.ru',
    'https://tk-alcotorg.ru'
  ],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(morgan('dev'));

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
app.use('/filters', filtersRouter);

// ─── Protected routes ────────────────────────────────────────────────
app.use('/orders', authMiddleware, orderRoutes);
app.use('/cart', authMiddleware, cartRoutes);
app.use('/stores', authMiddleware, storeRoutes);
app.use('/favorites', authMiddleware, favoriteRoutes);
app.use('/api/stock-rules', authMiddleware, stockRules);
app.use('/mobileagent', authMiddleware, mobileagent);
app.use('/notifications', authMiddleware, notificationRoutes);

// ─── Admin routes ────────────────────────────────────────────────────
app.use('/admin', authMiddleware, adminRoutes);

// ─── Catch-all 404 ───────────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// ─── Global error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

app.set('etag', false);

export default app;
