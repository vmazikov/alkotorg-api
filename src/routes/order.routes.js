import { Router } from 'express';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import { notifyAgent } from '../utils/teleg.js';

const r = Router();
r.use(authMiddleware);

/* POST /orders  — оформление заказа */
r.post('/', async (req,res)=>{
  const { storeId, items } = req.body;
  const products = await prisma.product.findMany({
    where:{ id:{ in:items.map(i=>i.productId) } },
    select:{ id:true, basePrice:true }
  });
  const total = items.reduce((s,i)=>{
    const p = products.find(p=>p.id===i.productId);
    return s + (p?.basePrice||0)*i.qty;
  },0);

  const order = await prisma.order.create({
    data:{
      storeId,
      userId : req.user.id,
      total,
      items : { create: items.map(i=>({ productId:i.productId, qty:i.qty, price:
        products.find(p=>p.id===i.productId)?.basePrice || 0 })) }
    },
    include:{ store:{ include:{ user:{ include:{ agent:true }}}}}
  });

  /* telegram */
  const agentTg = order.store.user.agent?.telegramId;
  notifyAgent(agentTg,
    `🆕 Новый заказ #${order.id}\nМагазин: ${order.store.title}\nСумма: ${total} ₽`);

  res.status(201).json(order);
});

/* GET /orders?status=NEW */
r.get('/', async (req,res)=>{
  const { status='NEW' } = req.query;

  const whereAgent = req.user.role==='AGENT'
      ? { store:{ user:{ agentId:req.user.id }}}
      : req.user.role==='USER'
      ? { store:{ userId:req.user.id }}
      : req.user.role==='MANAGER'
      ? { store:{ managerId:req.user.id }}
      : {};

  const orders = await prisma.order.findMany({
    where:{ status, ...whereAgent },
    include:{ store:true, items:{ include:{ product:true }}}
  });
  res.json(orders);
});

/* PUT /orders/:id/status — агент отмечает DONE + комментарий */
r.put('/:id/status', async (req,res)=>{
  const { status, comment='' } = req.body;
  const order = await prisma.order.update({
    where:{ id:+req.params.id },
    data : { status, agentComment:comment }
  });
  res.json(order);
});

export default r;
