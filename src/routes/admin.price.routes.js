import { Router } from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import prisma from '../utils/prisma.js';
import { role } from '../middlewares/auth.js';
import { toFloat, toInt } from '../utils/parse.js';

const router  = Router();
const upload  = multer({ dest: 'uploads/' });

/**
 * POST /admin/price/upload?mode=update|add|full
 *  update – меняем только цены/остатки существующих
 *  add    – добавляем новые + обновляем существующие
 *  full   – архивируем все старые, затем add
 */
router.post(
  '/upload',
  role(['ADMIN']),
  upload.single('file'),
  async (req, res) => {
    const mode  = req.query.mode || 'update';        // default
    const wb    = xlsx.readFile(req.file.path);
    const rows  = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    if (mode === 'full') {
      await prisma.product.updateMany({ data: { isArchived: true } });
    }

    let added = 0, updated = 0, archived = 0, skipped = 0;

    for (const r of rows) {
      const data = mapRow(r);

      // 1️⃣ выбираем уникальный ключ
      const uniqueWhere = data.productId
        ? { productId: data.productId }
        : data.article
          ? { article: data.article }
          : null;

      if (!uniqueWhere) { skipped++; continue; }       // нет ключа – пропускаем

      const existing = await prisma.product.findUnique({ where: uniqueWhere });

      // режим update → только обновляем, ничего не создаём
      if (!existing && mode === 'update') { skipped++; continue; }

      // режим add / full: upsert
      const product = await prisma.product.upsert({
        where : uniqueWhere,
        update: { basePrice: data.basePrice, stock: data.stock, isArchived: false },
        create: data,
      });

      if (existing) updated++; else added++;

      // 2️⃣ промо-цена
      if (data.promo) {
        await prisma.promo.upsert({
          where: { productId: product.id },
          update: data.promo,
          create: { ...data.promo, product: { connect: { id: product.id } } },
        });
      }
    }

    if (mode === 'full') {
      // посчитаем, сколько позиций осталось в архиве после полной загрузки
      archived = await prisma.product.count({ where: { isArchived: true } });
    }

    res.json({ added, updated, archived, skipped });
  },
);

// ──────────────────────────────────────────────────────────
// helpers
function mapRow(r) {
  return {
    productId: r.ProductID ? String(r.ProductID) : null,
    article:   r.Article   || null,
    name:      r.name      || r.ProductName,
    brand:     r.brand,
    type:      r.Type,

    volume:        toFloat(r.Volume),            // 0,5 → 0.5
    degree:        toFloat(r.degree),
    quantityInBox: toInt(r.QuantityInBox),
    basePrice:     toFloat(r.BasePrice),
    stock:         toInt(r.VolumeInStock),

    img:           r.img || null,
    wineColor:     r.WineColor,
    sweetnessLevel:r.SweetnessLevel,
    wineType:      r.wineType,
    giftPackaging: r.giftPackaging,
    manufacturer:  r.Manufacturer,
    excerpt:       r.Excerpt,
    rawMaterials:  r.rawMaterials,

    promo: r.promoPrice
      ? {
          promoPrice: toFloat(r.promoPrice),
          comment   : r.commentPromo || null,
          expiresAt : r.expiresAt ? new Date(r.expiresAt) : null,
        }
      : undefined,
  };
}

export default router;
