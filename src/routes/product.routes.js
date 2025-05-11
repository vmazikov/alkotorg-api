import { Router } from 'express';
import prisma from '../utils/prisma.js';

const router = Router();

// GET /products
router.get('/', async (req, res) => {
  const { search, sort, volume, degree } = req.query;
  const where = {};
  if (search) where.name = { contains: search, mode: 'insensitive' };
  if (volume) where.volume = volume;
  if (degree) where.degree = parseFloat(degree);

  const orderBy = {};
  if (sort === 'price_asc') orderBy.basePrice = 'asc';
  if (sort === 'price_desc') orderBy.basePrice = 'desc';
  if (sort === 'name_asc') orderBy.name = 'asc';
  if (sort === 'name_desc') orderBy.name = 'desc';

  const products = await prisma.product.findMany({
    where,
    orderBy: Object.keys(orderBy).length ? orderBy : undefined,
  });
  res.json(products);
});

// GET /products/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).json({ message: 'Not found' });
  res.json(product);
});

export default router;
