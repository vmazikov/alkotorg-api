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

/* ─────────────── utils для режима full ─────────────── */

// Поля, которые МЫ МОЖЕМ менять при "полном" обновлении
const MUTABLE_FIELDS_FULL = [
  'article', 'name', 'brand', 'type', 'isArchived',
  'volume', 'productVolumeId', 'region', 'degree', 'quantityInBox',
  'nonModify', 'img', 'countryOfOrigin', 'whiskyType',
  'wineColor', 'sweetnessLevel', 'wineType', 'giftPackaging',
  'manufacturer', 'excerpt', 'rawMaterials',
  'taste', 'spirtType', 'bottleType',
  'tasteProduct', 'aromaProduct', 'colorProduct', 'сombinationsProduct',
  'description'
];

/** Пустая строка из Excel → null, иначе возвращаем как есть */
function toDbValue(v) {
  return v === '' || v === undefined ? null : v;
}

/** Строит объект data: { поле1: значение1, … } для prisma.update */
function buildUpdateForFull(rowData) {
  const out = {};
  for (const key of MUTABLE_FIELDS_FULL) {
    if (key in rowData) out[key] = toDbValue(rowData[key]);
  }
  return out;
}

function isEqual(a, b) {
  return (a ?? null) === (b ?? null);
}

function dropUnchanged(patch, current) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!isEqual(v, current[k])) out[k] = v;
  }
  return out;
}


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

    let added = 0, updated = 0, skipped = 0;

    /* ---- helpers для нормализации заголовков ---- */
    function normalizeKey(k) {
      return k
        .replace(/\u00A0/g, ' ')   // NBSP → пробел
        .replace(/\s+/g, '')       // убрать все пробелы/табуляции
        .toLowerCase();            // регистр не важен
    }

    function cleanRowKeys(row) {
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        out[normalizeKey(k)] = v;
      }
      return out;
    }

    for (const raw of rows) {
      const r = cleanRowKeys(raw);     // ← нормализовали ключи

      const data = mapRow(r);        // mapRow теперь работает со «чистыми» ключами
      const uniqueWhere = data.productId
        ? { productId: data.productId }
        : data.article
          ? { article: data.article }
          : null;
      if (!uniqueWhere) { skipped++; continue; }
      const existing = await prisma.product.findUnique({ where: uniqueWhere });
      if (!existing && mode === 'update') { skipped++; continue; }

      let product;

      if (mode === 'full') {
        if (existing) {
          // --- сравниваем ---
          let patch = buildUpdateForFull(data);
          patch = dropUnchanged(patch, existing);
          // ещё проверяем isArchived
          if (!isEqual(data.isArchived, existing.isArchived)) {
            patch.isArchived = data.isArchived;
          }

          if (Object.keys(patch).length) {
            await prisma.product.update({ where: uniqueWhere, data: patch });
            updated++;
          } else {
            skipped++;          }
        } else {                                            // -------- CREATE
          if (existing) {
            const needPrice  = !isEqual(existing.basePrice, data.basePrice);
            const needStock  = !isEqual(existing.stock,     data.stock);
            if (needPrice || needStock) {
              await prisma.product.update({
                where: uniqueWhere,
                data : {
                  ...(needPrice && { basePrice: data.basePrice }),
                  ...(needStock && { stock:     data.stock })
                }
              });
              updated++;
            } else {
              skipped++;
            }
          } else {
            await prisma.product.create({ data });
            added++;
          }
          /* promo сохраняем только при создании нового товара */
          if (data.promo) {
            await prisma.promo.create({
              data:{ ...data.promo, product:{ connect:{ id:product.id } } }
            });
          }
        }
      } else {
        const baseUpdate = {
          basePrice: data.basePrice,
          stock:     data.stock,
          isArchived:false,
        };
        if (data.productVolumeId != null) baseUpdate.productVolumeId = data.productVolumeId;
        if (data.countryOfOrigin != null) baseUpdate.countryOfOrigin = data.countryOfOrigin;
        if (data.whiskyType      != null) baseUpdate.whiskyType      = data.whiskyType;

        product = await prisma.product.upsert({
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
  }
  // сколько товаров сейчас в архиве — пригодится в UI
  const archived = await prisma.product.count({ where:{ isArchived:true }})
  return res.json({ added, updated, skipped, archived })
});

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

  /** helper: нормализуем id → "abcd1234…" или ''  */
  const normId = id =>
    (id || '')
      .toString()
      .toLowerCase()
      .replace(/[^0-9a-f]/g, '');

  /* --- соберём хэши внешнего прайса: и по id, и по article --- */
  const extIdSet       = new Set();   // productId
  const extArticleSet  = new Set();   // article  (может быть undefined)

  for (const r of extRows) {
    const id = normId(r.productId);
    if (id)        extIdSet.add(id);
    if (r.article) extArticleSet.add(r.article.trim().toLowerCase());
  }

    // берём все активные продукты одной выборкой
   const activeProducts = await prisma.product.findMany({
     where: { isArchived: false },
     select: { id: true, name: true, stock: true, productId: true, article: true }
   });

   const toArchive = activeProducts.filter(p => {
     const id  = normId(p.productId);
     const art = p.article?.trim()?.toLowerCase();

     /* нет ни id, ни article во внешнем прайсе */
     const idMissing  = !id  || !extIdSet.has(id);
     const artMissing = !art || !extArticleSet.has(art);

     return idMissing && artMissing;
   });

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

    const payload = {
       preview,
       priceChanged, stockChanged, skipped,
       toUnarchive, newCandidates,
       toArchive
    };
    if (preview) payload.toArchive = toArchive;
    return res.json(payload);
  }
);

/**
 * 3) Bulk-эндпойнты для разархивации и создания
 */
router.post(
  '/product/unarchive-bulk',
  role(['ADMIN']),
  async (req, res) => {
   // конвертируем всё, безопасно отфильтровываем NaN
   const ids = Array.isArray(req.body.ids)
     ? req.body.ids.map(id => Number(id)).filter(Number.isInteger)
     : [];
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

router.post(
  '/product/archive-bulk',
  role(['ADMIN']),
  async (req, res) => {
    // безопасно приводим к числу
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map(n => Number(n)).filter(Number.isInteger)
      : [];

    // если список пустой – сразу отвечаем, чтобы не слать некорректный IN ()
    if (!ids.length) return res.json({ updated: 0 });

    const result = await prisma.product.updateMany({
      where: { id: { in: ids } },
      data:  { isArchived: true }
    });
    res.json({ updated: result.count });
  }
);

export default router;

/** ─────────────────── HELPERS for Excel ─────────────────── **/
function mapRow(r) {
  // ключи уже в нижнем регистре и без пробелов
  const productId = r.productid ?? null;
  const article   = r.article   ?? null;
  const name      = r.name ?? r.productname ?? '';

  /* volume-id: число или строка → приводим к строке */
  const productVolumeIdRaw = r.productvolumeid ?? null;
  const productVolumeId =
        productVolumeIdRaw != null && productVolumeIdRaw !== ''
          ? String(productVolumeIdRaw).trim()
          : null;
  const brand     = r.brand     ?? null;
  const type      = r.type      ?? null;

  const isArchived = String(r.isarchived || '')
                      .trim().toLowerCase() === 'true';

  const volume        = toFloat(r.volume);
  const degree        = toFloat(r.degree);
  const quantityInBox = toInt(r.quantityinbox);
  const basePrice     = toFloat(r.baseprice);
  const stock         = toInt(r.volumeinstock);

  const countryOfOrigin = r.countryoforigin ?? r.country ?? null;
  const region          = r.region          ?? null;
  const whiskyType      = r.whiskytype      ?? null;

  const nonModify = String(r.nonmodify || '')
                     .trim().toLowerCase() === 'true';

  const imgPath = r.newimg ?? r.img ?? null;

  /* дегустационка и прочее */
  const wineColor      = r.winecolor      ?? null;
  const sweetnessLevel = r.sweetnesslevel ?? null;
  const wineType       = r.winetype       ?? null;
  const giftPackaging  = r.giftpackaging  ?? null;
  const manufacturer   = r.manufacturer   ?? null;
  const excerpt        = r.excerpt        ?? null;
  const rawMaterials   = r.rawmaterials   ?? null;
  const spirtType      = r.spirtType      ?? null;
  const bottleType     = r.bottletype     ?? null;
  const taste          = r.taste          ?? null;
  const tasteProduct   = r.tasteproduct   ?? null;
  const aromaProduct   = r.aromaproduct   ?? null;
  const colorProduct   = r.colorproduct   ?? null;
  const combinationsProduct = r.combinationsproduct ?? r.сombinationsproduct ?? null;
  const description    = r.description    ?? null;

  const promo = r.promoprice
    ? {
        promoPrice: toFloat(r.promoprice),
        comment:    r.commentpromo ?? null,
        expiresAt:  r.expiresat ? new Date(r.expiresat) : null,
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
    productVolumeId,
    region,
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
    spirtType,
    bottleType,
    tasteProduct,
    aromaProduct,
    colorProduct,
    сombinationsProduct: combinationsProduct,
    description,
    promo,
  };
}

