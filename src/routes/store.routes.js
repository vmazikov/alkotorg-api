import { Router }  from 'express';
import prisma      from '../utils/prisma.js';
import { role }    from '../middlewares/auth.js';

const router = Router();

/* GET /stores?userId= */
router.get('/', role(['ADMIN','AGENT','USER']), async (req,res)=>{
  const where = req.query.userId ? { userId:+req.query.userId } : undefined;
  const stores = await prisma.store.findMany({ where });
  res.json(stores);
});

/* POST /stores */
router.post('/', role(['ADMIN','AGENT']), async (req,res)=>{
  const { userId, title, address } = req.body;
  const store = await prisma.store.create({ data:{ userId:+userId, title, address }});
  res.status(201).json(store);
});

/* PUT /stores/:id */
router.put('/:id', role(['ADMIN','AGENT']), async (req,res)=>{
  const id = +req.params.id;
  const { title, address } = req.body;
  const store = await prisma.store.update({ where:{id}, data:{ title, address }});
  res.json(store);
});

export default router;
