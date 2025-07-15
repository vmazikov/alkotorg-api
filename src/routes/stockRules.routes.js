import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware, role as allowRoles } from '../middlewares/auth.js';

const router = Router();
router.use(authMiddleware, allowRoles(['ADMIN']));

router.get('/',  async (_, res) => {
  const rows = await prisma.stockRule.findMany({ orderBy:{ rank:'asc' }});
  res.json(rows);
});
router.post('/', async (req, res) => {
  const r = await prisma.stockRule.create({ data: req.body });
  res.json(r);
});
router.put('/:id', async (req, res) => {
  const r = await prisma.stockRule.update({ where:{ id:+req.params.id }, data:req.body });
  res.json(r);
});
router.delete('/:id', async (req, res) => {
  await prisma.stockRule.delete({ where:{ id:+req.params.id }});
  res.json({ ok:true });
});

export default router;
