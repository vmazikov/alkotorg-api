import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import authRoutes from './routes/auth.routes.js';
import productRoutes from './routes/product.routes.js';
import orderRoutes from './routes/order.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { authMiddleware } from './middlewares/auth.js';

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Swagger
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Alkotorg API', version: '0.1.0' },
  },
  apis: ['./src/routes/*.js'],
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes
app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/orders', authMiddleware, orderRoutes);
app.use('/admin', authMiddleware, adminRoutes);

// 404
app.use('*', (_, res) => res.status(404).json({ message: 'Not found' }));

export default app;
