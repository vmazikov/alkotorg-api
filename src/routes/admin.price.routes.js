// src/routes/admin/price.routes.js
import { Router }        from 'express';
import multer            from 'multer';
import Database          from 'better-sqlite3';
import crypto            from 'crypto';
import xlsx              from 'xlsx';
import prisma            from '../utils/prisma.js';
import { role }          from '../middlewares/auth.js';
import { toFloat, toInt }from '../utils/parse.js';
import { Buffer } from 'buffer';

const router   = Router();
const upload   = multer({ dest: 'uploads/' });
const dbUpload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } }); // 5 МБ

/** 
 * 1) Старый Excel-импорт без изменений 
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
      const uniqueWhere = data.productId
        ? { productId: data.productId }
        : data.article
          ? { article: data.article }
          : null;
      if (!uniqueWhere) { skipped++; continue; }
      const existing = await prisma.product.findUnique({ where: uniqueWhere });
      if (!existing && mode === 'update') { skipped++; continue; }

      const baseUpdate = {
        basePrice: data.basePrice,
        stock:     data.stock,
        isArchived:false,
      };
      if (data.countryOfOrigin != null) baseUpdate.countryOfOrigin = data.countryOfOrigin;
      if (data.whiskyType      != null) baseUpdate.whiskyType      = data.whiskyType;

      const product = await prisma.product.upsert({
        where:  uniqueWhere,
        update: baseUpdate,
        create: data,
      });
      existing ? updated++ : added++;

      if (data.promo) {
        await prisma.promo.upsert({
          where:  { productId: product.id },
          update: data.promo,
          create: { ...data.promo, product:{ connect:{ id:product.id } } },
        });
      }
    }
    if (mode === 'full') {
      archived = await prisma.product.count({ where:{ isArchived:true }});
    }

    res.json({ added, updated, archived, skipped });
  }
);

/** 
 * 2) Синхронизация из SQLite-файла с AES/ECB-дешифровкой 
 */
// ====================== helpers ======================
const KEY = Buffer.from('MobileAgentKey!!', 'utf8');

function decryptAesEcb(buf) {
  const input    = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const decipher = crypto.createDecipheriv('aes-128-ecb', KEY, null);
  decipher.setAutoPadding(false);
  let plain = Buffer.concat([decipher.update(input), decipher.final()]);

  const pad = plain.at(-1);
  if (pad > 0 && pad < 16 && plain.slice(-pad).every(b => b === pad)) {
    plain = plain.slice(0, -pad);
  }
  return plain;
}

function loadExternalProducts(path) {
  const db   = new Database(path, { readonly: true });
  const rows = db.prepare(`
    SELECT ProductID, ProductName, VolumeInStock, BasePrice
    FROM Product
  `).all();
  db.close();

  return rows.map(r => ({
    productId : decryptAesEcb(r.ProductID).toString('hex'),
    name      : typeof r.ProductName === 'string'
                  ? r.ProductName.trim()
                  : decryptAesEcb(r.ProductName).toString('utf8').trim(),
    stock     : Number(r.VolumeInStock),
    basePrice : Number(r.BasePrice),
  }));
}
// =====================================================

router.post(
  '/sync-db',
  role(['ADMIN']),
  dbUpload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error:'Файл не получен' });
    const preview = req.query.preview === '1';

    const extRows = loadExternalProducts(req.file.path);

    let priceChanged = 0, stockChanged = 0, skipped = 0;
    const toUnarchive = [], newCandidates = [];

    for (const r of extRows) {
      if (!r.productId || r.basePrice == null || r.stock == null) {
        skipped++; continue;
      }

      const prod = await prisma.product.findUnique({
        where: { productId: r.productId },
        select:{ id:true, basePrice:true, stock:true, isArchived:true, name:true }
      });

      if (prod) {
        /* ---- цена ---- */
        if (Math.abs(prod.basePrice - r.basePrice) >= 1) {
          priceChanged++;
          if (!preview) {
            await prisma.product.update({
              where:{ id:prod.id },
              data :{ basePrice:r.basePrice }
            });
          }
        }
        /* ---- остаток ---- */
        if (prod.stock !== r.stock) {
          stockChanged++;
          const inc = r.stock > prod.stock;
          if (!preview) {
            await prisma.product.update({
              where:{ id:prod.id },
              data :{ stock:r.stock }
            });
          }
          if (prod.isArchived && inc) {
            toUnarchive.push({
              id: prod.id, name: prod.name,
              oldStock: prod.stock, newStock: r.stock
            });
          }
        }
      } else {
        newCandidates.push(r);
      }
    }

    return res.json({
      preview,
      priceChanged, stockChanged, skipped,
      toUnarchive, newCandidates
    });
  }
);

/**
 * 3) Bulk-эндпойнты для разархивации и создания
 */
router.post(
  '/product/unarchive-bulk',
  role(['ADMIN']),
  async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const result = await prisma.product.updateMany({
      where: { id: { in: ids } },
      data:  { isArchived: false }
    });
    res.json({ updated: result.count });
  }
);

router.post(
  '/product/create-bulk',
  role(['ADMIN']),
  async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const data = rows.map(r => ({
      productId: r.productId,
      name:      r.name,
      basePrice: r.basePrice,
      stock:     r.stock,
      isNew:     true,
      dateAdded: new Date()
    }));
    const result = await prisma.product.createMany({
      data,
      skipDuplicates: true
    });
    res.json({ added: result.count });
  }
);

export default router;

/** ─────────────────── HELPERS for Excel ─────────────────── **/
function mapRow(r) {
  const productId = r.ProductID ? String(r.ProductID) : null;
  const article   = r.Article   ? String(r.Article)   : null;
  const name      = r.ProductName || r.name || '';
  const brand     = r.brand       || null;
  const type      = r.Type        || null;
  const isArchived = (() => {
    const v = r.isArchived;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string')  return v.trim().toLowerCase() === 'true';
    return false;
  })();
  const volume        = toFloat(r.Volume);
  const degree        = toFloat(r.degree);
  const quantityInBox = toInt(r.QuantityInBox);
  const basePrice     = toFloat(r.BasePrice);
  const stock         = toInt(r.VolumeInStock);
  const countryOfOrigin = r.CountryOfOrigin || r.Country || r.countryOfOrigin || null;
  const whiskyType      = r.WhiskyType      || r.whiskyType || null;
  const nonModify = (() => {
    const v = r.nonModify;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string')  return v.toLowerCase() === 'true';
    return false;
  })();
  const imgPath = r.newImg
    ? String(r.newImg).trim()
    : r.img
      ? String(r.img).trim()
      : null;
  const wineColor      = r.WineColor      || null;
  const sweetnessLevel = r.SweetnessLevel || null;
  const wineType       = r.wineType       || null;
  const giftPackaging  = r.giftPackaging  || null;
  const manufacturer   = r.Manufacturer   || null;
  const excerpt        = r.Excerpt        || null;
  const rawMaterials   = r.rawMaterials   || null;
  const taste          = r.taste          || null;
  const description    = r.description    || null;
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
    isArchived,
    volume,
    degree,
    quantityInBox,
    basePrice,
    stock,
    nonModify,
    img: imgPath,
    countryOfOrigin,
    whiskyType,
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
