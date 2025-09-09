// src/app.js
import './utils/telegramBot.js';
import express           from 'express';
import cors              from 'cors';
import morgan            from 'morgan';
import swaggerUi         from 'swagger-ui-express';
import swaggerJsdoc      from 'swagger-jsdoc';
import path              from 'path';
import { fileURLToPath } from 'url';
import rateLimit         from 'express-rate-limit';

import authRoutes        from './routes/auth.routes.js';
import productRoutes     from './routes/product.routes.js';
import orderRoutes       from './routes/order.routes.js';
import adminRoutes       from './routes/admin.routes.js';
import cartRoutes        from './routes/cart.routes.js';
import storeRoutes       from './routes/store.routes.js';
import filtersRouter     from './routes/filters.routes.js';
import favoriteRoutes    from './routes/favorite.routes.js';
import stockRules        from './routes/stockRules.routes.js';
import { authMiddleware } from './middlewares/auth.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Rate limiter ────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 60,             // максимум 60 запросов с одного IP в минуту
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again later" },
});
app.use(limiter);

// ─── Middleware ─────────────────────────────────────────────────────
app.use(morgan('dev'));

// Логирование тела запроса
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length) console.log('BODY:', req.body);
  next();
});

// CORS
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://tk-alcotorg.ru',
    'https://tk-alcotorg.ru'
  ],
  credentials: true,
}));

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Защита от битых JSON ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    console.error("[JSON PARSE ERROR]", err.message);
    return res.status(400).json({ error: "Invalid JSON" });
  }
  next(err);
});

// ─── Защита от вредоносных URL ───────────────────────────────────────
app.use((req, res, next) => {
  try {
    decodeURIComponent(req.url);
    // простая проверка на подозрительные символы
    const forbiddenPattern = /[%<>\\{}|]/;
    if (forbiddenPattern.test(req.url)) {
      console.warn("[FORBIDDEN URL]", req.url);
      return res.status(400).send("Bad request");
    }
    next();
  } catch (err) {
    console.error("[URI ERROR] URL decode failed:", req.url, err.message);
    res.status(400).send("Bad request");
  }
});

// ─── Статика для изображений ─────────────────────────────────────────
app.use('/img', express.static(path.join(__dirname, '..', 'uploads', 'img')));
app.get('/img/*', (_req, res) =>
  res.sendFile(path.join(__dirname, '..', 'uploads', 'img', 'placeholder.png'))
);

// ─── Swagger UI ─────────────────────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Alkotorg API', version: '0.2.0' } },
  apis: ['./src/routes/*.js'],
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Public routes ───────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/filters', filtersRouter);

// ─── Protected routes ────────────────────────────────────────────────
app.use('/orders', authMiddleware, orderRoutes);
app.use('/cart',   authMiddleware, cartRoutes);
app.use('/stores', authMiddleware, storeRoutes);
app.use('/favorites', favoriteRoutes);
app.use('/api/stock-rules', stockRules);

// ─── Admin routes ────────────────────────────────────────────────────
app.use('/admin', authMiddleware, adminRoutes);

// ─── Catch-all 404 ───────────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// ─── Глобальный обработчик ошибок ───────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[GLOBAL ERROR]", err.stack || err.message || err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ─── Отключаем ETag ──────────────────────────────────────────────────
app.set('etag', false);

export default app;
