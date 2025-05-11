import { Router } from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { role } from '../middlewares/auth.js';
import prisma from '../utils/prisma.js';

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/price/upload', role(['ADMIN']), upload.single('file'), async (req, res) => {
  const workbook = xlsx.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);

  const upserts = rows.map((row) =>
    prisma.product.upsert({
      where: { productId: row.ProductID.toString() },
      update: {
        name: row.ProductName,
        basePrice: row.BasePrice,
        stock: row.VolumeInStock,
      },
      create: {
        productId: row.ProductID.toString(),
        name: row.ProductName,
        basePrice: row.BasePrice,
        stock: row.VolumeInStock,
      },
    }),
  );
  await Promise.all(upserts);
  res.json({ processed: rows.length });
});

export default router;
