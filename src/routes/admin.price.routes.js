// src/routes/admin/price.routes.js

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
 *  update – только обновляем цены/остатки
 *  add    – добавляем новые + обновляем существующие
 *  full   – архивируем всё, затем add
 */
router.post(
  '/upload',
  role(['ADMIN']),
  upload.single('file'),
  async (req, res) => {
    const mode  = req.query.mode || 'update';
    const wb    = xlsx.readFile(req.file.path);
    const rows  = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    if (mode === 'full') {
      await prisma.product.updateMany({ data: { isArchived: true } });
    }

    let added = 0, updated = 0, archived = 0, skipped = 0;

    for (const r of rows) {
      const data = mapRow(r);

      // уникальный ключ: productId или article
      const uniqueWhere = data.productId
        ? { productId: data.productId }
        : data.article
          ? { article: data.article }
          : null;

      if (!uniqueWhere) {
        skipped++;
        continue;
      }

      const existing = await prisma.product.findUnique({ where: uniqueWhere });

      // режим update: если товара нет – пропускаем
      if (!existing && mode === 'update') {
        skipped++;
        continue;
      }

      // upsert: создаём или обновляем
      const product = await prisma.product.upsert({
        where: uniqueWhere,
        update: {
          basePrice: data.basePrice,
          stock:      data.stock,
          isArchived: false,
        },
        create: data,
      });

      existing ? updated++ : added++;

      // промо-цена
      if (data.promo) {
        await prisma.promo.upsert({
          where:   { productId: product.id },
          update:  data.promo,
          create:  { ...data.promo, product: { connect: { id: product.id } } },
        });
      }
    }

    if (mode === 'full') {
      archived = await prisma.product.count({ where: { isArchived: true } });
    }

    res.json({ added, updated, archived, skipped });
  },
);


// ──────────────────────────────────────────────────────────
// helpers
function mapRow(r) {
  // первичные ключи
  const productId = r.ProductID ? String(r.ProductID) : null;
  const article   = r.Article   ? String(r.Article)   : null;

  // парсим числа и строки
  const name          = r.ProductName || r.name || '';
  const brand         = r.brand       || null;
  const type          = r.Type        || null;
  const volume        = toFloat(r.Volume);
  const degree        = toFloat(r.degree);
  const quantityInBox = toInt(r.QuantityInBox);
  const basePrice     = toFloat(r.BasePrice);
  const stock         = toInt(r.VolumeInStock);

  // nonModify: булево или строка
  const nonModify = (() => {
    const v = r.nonModify;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string')  return v.toLowerCase() === 'true';
    return false;
  })();

  // выбор картинки: newImg > img > null
  const imgPath = r.newImg
    ? String(r.newImg).trim()
    : r.img
      ? String(r.img).trim()
      : null;

  // остальные поля
  const wineColor      = r.WineColor      || null;
  const sweetnessLevel = r.SweetnessLevel || null;
  const wineType       = r.wineType       || null;
  const giftPackaging  = r.giftPackaging  || null;
  const manufacturer   = r.Manufacturer   || null;
  const excerpt        = r.Excerpt        || null;
  const rawMaterials   = r.rawMaterials   || null;
  const taste          = r.taste          || null;
  const description    = r.description    || null;

  // промо-данные
  const promo = r.promoPrice
    ? {
        promoPrice: toFloat(r.promoPrice),
        comment:    r.commentPromo || null,
        expiresAt:  r.expiresAt ? new Date(r.expiresAt) : null,
      }
    : undefined;

  return {
    productId,
    article,
    name,
    brand,
    type,
    volume,
    degree,
    quantityInBox,
    basePrice,
    stock,
    nonModify,
    img: imgPath,
    wineColor,
    sweetnessLevel,
    wineType,
    giftPackaging,
    manufacturer,
    excerpt,
    rawMaterials,
    taste,
    description,
    promo,
  };
}

export default router;
