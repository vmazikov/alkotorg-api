import { Router } from 'express';
import prisma from '../utils/prisma.js';

const router = Router();

/* GET /products */
router.get('/', async (req, res) => {
  const { search, priceMin, priceMax, volumes, degree, sort, type } = req.query;

  const where = { isArchived: false };

  if (type)         where.type   = type;
  if (search)       where.name   = { contains: search, mode: 'insensitive' };
  if (priceMin)     where.basePrice = { gte: +priceMin };
  if (priceMax)     where.basePrice = { ...where.basePrice, lte: +priceMax };
  if (degree)       where.degree = { gte: +degree };
  if (volumes)      where.volume = { in: (Array.isArray(volumes) ? volumes : [volumes]).map(Number) };

  const orderBy = sort === 'name_asc'  ? { name: 'asc'  }
               : sort === 'price_asc' ? { basePrice: 'asc' }
               : sort === 'price_desc'? { basePrice: 'desc' }
               : undefined;

  const products = await prisma.product.findMany({
    where,
    orderBy,
    include: { promos: { where: { expiresAt: { gt: new Date() } } } },
  });

  res.json(products);
});

/* GET /products/suggest?query=tor */
router.get('/suggest', async (req, res) => {
  const { query } = req.query;
  if (!query || query.length < 2) return res.json([]);
  const list = await prisma.product.findMany({
    where: { name: { contains: query, mode: 'insensitive' } },
    select: { name: true },
    take: 10,
  });
  res.json(list.map(x => x.name));
});

export default router;
