// src/routes/admin/price.routes.js
import { Router }        from 'express';
import fs                from 'fs';
import path              from 'path';
import multer            from 'multer';
import Database          from 'better-sqlite3';
import crypto            from 'crypto';
import xlsx              from 'xlsx';
import prisma            from '../utils/prisma.js';
import { role }          from '../middlewares/auth.js';
import { toFloat, toInt, toBool }from '../utils/parse.js';
import { Buffer } from 'buffer';
import { normalizeName } from '../utils/strings.js';
import { IMAGE_DIR, buildImageUrl } from '../utils/imageStorage.js';

const router   = Router();
const upload   = multer({ dest: 'uploads/' });
const dbUpload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } }); // 5 МБ
const fsp = fs.promises;

const IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 МБ
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

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
  'description', 'rawName'
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

function normalizeImageValue(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str : null;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function downloadImageFromUrl(url) {
  const parsed = new URL(url);
  const response = await fetch(parsed.toString(), { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Не удалось скачать изображение (${response.status})`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!contentType || !ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
    throw new Error('Недопустимый тип файла. Разрешены JPEG, PNG, WEBP');
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength && contentLength > IMAGE_MAX_FILE_SIZE) {
    throw new Error('Размер файла превышает 5 МБ');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > IMAGE_MAX_FILE_SIZE) {
    throw new Error('Размер файла превышает 5 МБ');
  }

  const extFromPath = path.extname(parsed.pathname).toLowerCase();
  const extension = extFromPath || (contentType === 'image/png'
    ? '.png'
    : contentType === 'image/webp'
      ? '.webp'
      : '.jpg');
  const fileName = `${crypto.randomUUID()}${extension}`;
  await fsp.writeFile(path.join(IMAGE_DIR, fileName), buffer);
  return buildImageUrl(fileName);
}

async function resolveImportedImage(value) {
  const normalized = normalizeImageValue(value);
  if (!normalized) return null;
  if (!isHttpUrl(normalized)) return normalized;
  return await downloadImageFromUrl(normalized);
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
      const hasImgCell = 'img' in r || 'newimg' in r;
      const hasHex = !!data.productId;
      if (!hasHex) { skipped++; continue; }
      const existing = await prisma.product.findFirst({
        where: { productId: data.productId }
      });
      if (!existing && mode === 'update') { skipped++; continue; }

      let product;

      if (mode === 'full') {
        if (existing) {
          if (hasImgCell) {
            data.img = await resolveImportedImage(data.img);
          } else {
            data.img = existing.img ?? null;
          }
          // --- сравниваем ---
          let patch = buildUpdateForFull(data);
          // Если пришёл rawName, но не пришёл name — не трогаем name
          if (data.rawName != null && !('name' in data)) {
            delete patch.name;
          }
          // Обновим «сырое» и каноническое имя тоже
          patch.rawName = data.rawName ?? existing.rawName ?? null;
          patch.canonicalName = data.rawName ? normalizeName(data.rawName) : (existing.canonicalName ?? null);
          patch = dropUnchanged(patch, existing);
          // ещё проверяем isArchived
          if (!isEqual(data.isArchived, existing.isArchived)) {
            patch.isArchived = data.isArchived;
          }

          if (Object.keys(patch).length) {
            await prisma.product.update({ where: { id: existing.id }, data: patch });
            updated++;
          } else {
            skipped++;          }
        } else {                                            // -------- CREATE
          if (hasImgCell) {
            data.img = await resolveImportedImage(data.img);
          }
          if (existing) {
            const needPrice  = !isEqual(existing.basePrice, data.basePrice);
            const needStock  = !isEqual(existing.stock,     data.stock);
            if (needPrice || needStock) {
              await prisma.product.update({
                where: { id: existing.id },
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
            await prisma.product.create({
              data: {
                ...data,
                rawName: data.rawName ?? data.name ?? null,
                canonicalName: data.rawName ? normalizeName(data.rawName) : normalizeName(data.name || '')
              }
            });
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
        // rawName/canonicalName при обычном режиме тоже обновим
        if (data.rawName != null) {
          baseUpdate.rawName = data.rawName;
          baseUpdate.canonicalName = normalizeName(data.rawName);
        }
        if (data.productVolumeId != null) baseUpdate.productVolumeId = data.productVolumeId;
        if (data.countryOfOrigin != null) baseUpdate.countryOfOrigin = data.countryOfOrigin;
        if (data.whiskyType      != null) baseUpdate.whiskyType      = data.whiskyType;

        if (existing) {
          if (hasImgCell && !existing.img) {
            const resolvedImg = await resolveImportedImage(data.img);
            if (resolvedImg) baseUpdate.img = resolvedImg;
          }
          product = await prisma.product.update({
            where: { id: existing.id },
            data: baseUpdate
          });
          updated++;
        } else {
          if (hasImgCell) {
            data.img = await resolveImportedImage(data.img);
          }
          product = await prisma.product.create({
            data: {
              ...data,
              rawName: data.rawName ?? data.name ?? null,
              canonicalName: data.rawName ? normalizeName(data.rawName) : normalizeName(data.name || '')
            }
          });
          added++;
        }

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

  return rows.map(r => {
    const sourceName = typeof r.ProductName === 'string'
      ? r.ProductName.trim()
      : decryptAesEcb(r.ProductName).toString('utf8').trim();

    return {
      productId : decryptAesEcb(r.ProductID).toString('hex'),
      rawName   : sourceName || null,
      // поле name оставляем только для превью — в БД его не перетираем
      name      : sourceName || null,
      stock     : Number(r.VolumeInStock),
      basePrice : Number(r.BasePrice),
    };
  });
}
// =====================================================

router.post(
  '/sync-db',
  role(['ADMIN','AGENT']),
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

    const pickRawName = value => {
      if (value == null) return null;
      const s = String(value).trim();
      return s ? s : null;
    };

    /* --- соберём хэши внешнего прайса: и по id, и по article --- */
    const extIdSet = new Set(); // productId

    for (const r of extRows) {
      const id = normId(r.productId);
      if (id) extIdSet.add(id);
    }

    // берём активные товары и их алиасы
    const activeProducts = await prisma.product.findMany({
      where: { isArchived: false },
      select: { id: true, name: true, rawName: true, canonicalName: true, stock: true, productId: true }
    });
    const aliases = await prisma.productExternalId.findMany({
      select: { productId: true, externalId: true }
    });
    const aliasByHex = new Map();
    for (const alias of aliases) {
      const key = normId(alias.externalId);
      if (!key) continue;
      aliasByHex.set(key, alias.productId);
    }

    const aliasHits = new Set();
    for (const [hex, productId] of aliasByHex.entries()) {
      if (extIdSet.has(hex)) aliasHits.add(productId);
    }

    // Кандидаты на архив: те активные, у кого НЕТ ни текущего hex, ни какого-либо алиаса в текущем внешнем наборе
    const toArchiveInitial = activeProducts.filter(p => {
      const curHex = normId(p.productId);
      if (curHex && extIdSet.has(curHex)) return false;
      return !aliasHits.has(p.id);
    });

    let priceChanged = 0, stockChanged = 0, skipped = 0;
    const toUnarchive = [];
    const newCandidates = [];
    const hexConflicts = [];
    const matchedProductIds = new Set();

    for (const r of extRows) {
      if (!r.productId || r.basePrice == null || r.stock == null) {
        skipped++; continue;
      }

      const hex = normId(r.productId);
      const sourceRawName = pickRawName(r.rawName ?? r.name ?? null);
      const canonRaw = normalizeName(sourceRawName || '');
      const canon = canonRaw || null;

      // 1) Ищем по алиасу (быстрый идеальный путь)
      let prodIdByAlias = aliasByHex.get(hex) || null;
      let prod = null;
      if (prodIdByAlias) {
        prod = await prisma.product.findUnique({
          where: { id: prodIdByAlias },
          select:{ id:true, basePrice:true, stock:true, isArchived:true, name:true, productId:true, rawName:true, canonicalName:true }
        });
      }

      // 2) Если не нашли по алиасу — ищем по текущему product.productId
      if (!prod) {
        prod = await prisma.product.findFirst({
          where: { productId: r.productId },
          select:{ id:true, basePrice:true, stock:true, isArchived:true, name:true, productId:true, rawName:true, canonicalName:true }
        });
      }

      // 3) Если всё ещё не нашли — ищем по canonicalName среди активных/архивных
      if (!prod && canon) {
        prod = await prisma.product.findFirst({
          where: { canonicalName: canon },
          select:{ id:true, basePrice:true, stock:true, isArchived:true, name:true, productId:true, rawName:true, canonicalName:true }
        });
      }

      if (prod) {
        matchedProductIds.add(prod.id);
        // hex поменялся? перенесём product.productId на новый и добавим алиас (старый тоже останется в алиасах)
        const needHexMove = !!hex && normId(prod.productId) !== hex;
        const patch = {};
        const prevStock = prod.stock;

        if (needHexMove) {
          const existingAlias = await prisma.productExternalId.findUnique({
            where: { externalId: r.productId },
            select: { productId: true }
          });
          if (existingAlias && existingAlias.productId !== prod.id) {
            hexConflicts.push({
              externalId: r.productId,
              targetProductId: prod.id,
              conflictingProductId: existingAlias.productId
            });
          } else {
            if (!existingAlias && !preview) {
              await prisma.productExternalId.create({
                data: { productId: prod.id, externalId: r.productId, isPrimary: true }
              });
            }
            patch.productId = r.productId;
            aliasByHex.set(hex, prod.id);
          }
        }

        /* ---- цена ---- */
        if (Math.abs(prod.basePrice - r.basePrice) >= 1) {
          priceChanged++;
          patch.basePrice = r.basePrice;
        }
        /* ---- остаток ---- */
        if (prod.stock !== r.stock) {
          stockChanged++;
          patch.stock = r.stock;
          const inc = r.stock > prevStock;
          if (prod.isArchived && inc) {
            toUnarchive.push({
              id: prod.id, name: prod.name,
              oldStock: prevStock, newStock: r.stock
            });
          }
        }

        const needRawUpdate = sourceRawName != null && sourceRawName !== prod.rawName;
        if (needRawUpdate) {
          patch.rawName = sourceRawName;
        }
        if (canon && canon !== prod.canonicalName) {
          patch.canonicalName = canon;
        }

        if (Object.keys(patch).length) {
          if (!preview) {
            await prisma.product.update({
              where: { id: prod.id },
              data: patch
            });
          }
          Object.assign(prod, patch);
        }
      } else {
        // Не нашли — кандидат на создание
        newCandidates.push({
          productId: r.productId,
          rawName:   sourceRawName,
          name:      sourceRawName ?? '',
          stock:     r.stock,
          basePrice: r.basePrice,
          canonicalName: canon
        });
      }
    }

    const filteredToArchive = toArchiveInitial.filter(p => !matchedProductIds.has(p.id));
    const canonicalArchiveIndex = new Map();
    const decorateArchive = product => {
      const normalized = product.canonicalName || normalizeName(product.rawName || product.name || '');
      if (normalized) {
        if (!canonicalArchiveIndex.has(normalized)) canonicalArchiveIndex.set(normalized, []);
        canonicalArchiveIndex.get(normalized).push({
          id: product.id,
          name: product.name,
          rawName: product.rawName,
          canonicalName: normalized,
          productId: product.productId
        });
      }
      return { ...product, normalizedName: normalized || null };
    };
    const toArchive = filteredToArchive.map(decorateArchive);

    for (const candidate of newCandidates) {
      if (!candidate.canonicalName) continue;
      const matches = canonicalArchiveIndex.get(candidate.canonicalName);
      if (matches?.length) {
        candidate.possibleMatches = matches;
      }
    }

    const payload = {
       preview,
       priceChanged, stockChanged, skipped,
       toUnarchive, newCandidates,
       toArchive
    };
    if (hexConflicts.length) payload.hexConflicts = hexConflicts;
    return res.json(payload);
  }
);

/**
 * 3) Bulk-эндпойнты для разархивации и создания
 */
router.post(
  '/product/unarchive-bulk',
  role(['ADMIN','AGENT']),
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
  role(['ADMIN','AGENT']),
  async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    let added = 0;
    for (const r of rows) {
      const canon = normalizeName(r.rawName || r.name || '');
      const created = await prisma.product.create({
        data: {
          productId: r.productId,        // текущий hex сразу кладём в продукт
          rawName:   r.rawName ?? r.name ?? null,
          canonicalName: canon,
          name:      r.name ?? (r.rawName ?? ''), // «красивое» имя — как раньше
          basePrice: r.basePrice,
          stock:     r.stock,
          isNew:     true,
          dateAdded: new Date(),
          externals: { create: { externalId: r.productId, isPrimary: true } }
        }
      });
      if (created?.id) added++;
    }
    res.json({ added });
  }
);

router.post(
  '/product/archive-bulk',
  role(['ADMIN','AGENT']),
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
  // для Excel-импорта rawName не всегда есть — если нет, используем пришедшее name
  const rawName   = r.rawname ?? r.productname ?? r.name ?? null;

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

  const promoApplyModifier = toBool(r.promoapplymodifier ?? r.promomodifier);

  const promo = r.promoprice
    ? {
        promoPrice: toFloat(r.promoprice),
        comment:    r.commentpromo ?? null,
        expiresAt:  r.expiresat ? new Date(r.expiresat) : null,
        ...(promoApplyModifier === undefined
          ? {}
          : { applyModifier: promoApplyModifier }),
      }
    : undefined;

  return {
    productId,
    article,
    name,
    rawName,
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
