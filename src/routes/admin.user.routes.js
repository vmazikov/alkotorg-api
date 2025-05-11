import { Router } from 'express';
import prisma     from '../utils/prisma.js';
import { role }   from '../middlewares/auth.js';

const router = Router();
router.use(role(['ADMIN']));

/* GET /admin/users */
router.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id:true,email:true,phone:true,role:true,priceModifier:true,agentId:true }
  });
  res.json(users);
});

/* POST /admin/users */
router.post('/', async (req, res) => {
  const { email, phone, role: r='USER', priceModifier=0, agentId=null } = req.body;
  const user = await prisma.user.create({
    data: { email, phone, role: r, priceModifier:+priceModifier, agentId }
  });
  res.status(201).json(user);
});

/* PUT /admin/users/:id */
router.put('/:id', async (req, res) => {
  const id = +req.params.id;
  const { email, phone, role: r, priceModifier, agentId } = req.body;
  const user = await prisma.user.update({
    where:{ id },
    data : { email, phone, role: r, priceModifier:+priceModifier, agentId }
  });
  res.json(user);
});

export default router;
