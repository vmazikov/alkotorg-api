import { Router }  from 'express';
import prisma      from '../utils/prisma.js';
import { role }    from '../middlewares/auth.js';

const router = Router();
router.use(role(['ADMIN']));

/* PUT /admin/products/:id */
router.put('/:id', async (req, res) => {
  const id = +req.params.id;
  const {
    name, brand, type, volume, degree,
    basePrice, stock, img
  } = req.body;

  const product = await prisma.product.update({
    where:{ id },
    data : {
      name, brand, type,
      volume: volume ? Number(volume) : null,
      degree: degree ? Number(degree) : null,
      basePrice: Number(basePrice),
      stock   : Number(stock),
      img
    }
  });
  res.json(product);
});

export default router;
