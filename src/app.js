import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import authRoutes from './routes/auth.routes.js';
import productRoutes from './routes/product.routes.js';
import orderRoutes from './routes/order.routes.js';
import adminRoutes from './routes/admin.routes.js';
import priceRoutes from './routes/admin.price.routes.js';
import { authMiddleware } from './middlewares/auth.js';
import cartRoutes from './routes/cart.routes.js';
import adminUserRoutes      from './routes/admin.user.routes.js';
import adminProductRoutes   from './routes/admin.product.routes.js';
import storeRoutes          from './routes/store.routes.js';

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

const spec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'Alkotorg API', version: '0.2.0' } },
  apis: ['./src/routes/*.js'],
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));

app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/orders', authMiddleware, orderRoutes);
app.use('/admin', authMiddleware, adminRoutes);
app.use('/admin/price', authMiddleware, priceRoutes);
app.use('/cart', cartRoutes);
app.use('/admin/users',     adminUserRoutes);
app.use('/admin/products',  adminProductRoutes);
app.use('/stores',          storeRoutes);

app.use('*', (_, res) => res.status(404).json({ message: 'Not found' }));
export default app;
