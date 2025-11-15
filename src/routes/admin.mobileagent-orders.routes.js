// src/routes/admin.mobileagent-orders.routes.js
import express from 'express';
import multer from 'multer';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import prisma from '../utils/prisma.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

/* ====================== helpers ====================== */

function normalizeHex(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  return s.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

function toHexFromSqlite(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value.toString('hex').toLowerCase();
  if (typeof value === 'string') return normalizeHex(value);
  return normalizeHex(String(value));
}

function hexToBuffer(hex) {
  const s = normalizeHex(hex);
  if (!s) return null;
  return Buffer.from(s, 'hex');
}

function parseDateRange(dateFrom, dateTo) {
  let from = null;
  let to = null;

  if (dateFrom) {
    from = new Date(String(dateFrom));
    if (Number.isNaN(from.getTime())) from = null;
  }
  if (dateTo) {
    const d = new Date(String(dateTo));
    if (!Number.isNaN(d.getTime())) {
      // до конца дня включительно
      d.setHours(23, 59, 59, 999);
      to = d;
    }
  }
  return { from, to };
}

// AES-ключ, такой же как в MobileAgent
const AES_KEY = Buffer.from('MobileAgentKey!!', 'utf8'); // 16 байт

// Зашифровать GUID (16 байт) так же, как на устройстве: AES/ECB/NoPadding
function aesEncryptGuidHex(plainHex) {
  const h = normalizeHex(plainHex);
  if (!h || h.length !== 32) return null; // GUID 16 байт
  const buf = Buffer.from(h, 'hex');
  const cipher = crypto.createCipheriv('aes-128-ecb', AES_KEY, null);
  cipher.setAutoPadding(false);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return enc.toString('hex').toLowerCase();
}

// Мапа для товаров по externalId (plain + AES)
function buildProductIdMapFromExternal(externals) {
  const map = new Map();
  for (const e of externals) {
    const plain = normalizeHex(e.externalId);
    if (!plain) continue;
    // вариант: в MA лежит plain GUID
    map.set(plain, e.productId);
    // вариант: в MA лежит AES(GUID)
    const enc = aesEncryptGuidHex(plain);
    if (enc) map.set(enc, e.productId);
  }
  return map;
}

// Мапа для товаров по product.productId (plain + AES)
function buildProductIdMapFromProduct(products) {
  const map = new Map();
  for (const p of products) {
    if (!p.productId) continue;
    const plain = normalizeHex(p.productId);
    if (!plain) continue;
    map.set(plain, p.id);
    const enc = aesEncryptGuidHex(plain);
    if (enc) map.set(enc, p.id);
  }
  return map;
}

/* ====================== PREVIEW ====================== */

/**
 * POST /admin/mobileagent-orders/preview
 * form-data:
 *   - file: MobileAgent.db3
 *   - dateFrom?: "2025-11-01"
 *   - dateTo?: "2025-11-07"
 *
 * Ответ: { token, totalInvoices, filteredCount, stats, invoices:[...] }
 */
router.post(
  '/preview',
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не передан' });
    }

    const dbPath = req.file.path;
    const { dateFrom, dateTo } = req.body || {};
    const { from, to } = parseDateRange(dateFrom, dateTo);

    let db;
    try {
      db = new Database(dbPath, { readonly: true });

      // 1) читаем все Invoice
      const rows = db
        .prepare(`
          SELECT
            I.InvoiceID,
            I.ShopID,
            I.AgentID,
            I.InvoiceDateTime,
            I.InvoiceAmount,
            I.ProductCount,
            I.Note
          FROM Invoice I
        `)
        .all();

      const totalInvoices = rows.length;

      // 2) фильтр по дате
      const filtered = rows.filter((r) => {
        if (!from && !to) return true;
        const dtRaw = r.InvoiceDateTime;
        if (!dtRaw) return false;
        const dt = new Date(dtRaw);
        if (Number.isNaN(dt.getTime())) return false;
        if (from && dt < from) return false;
        if (to && dt > to) return false;
        return true;
      });

      // 3) готовим набор hex-ов
      const invoices = filtered.map((r) => {
        const maInvoiceIdHex = toHexFromSqlite(r.InvoiceID);
        const shopMaHex = toHexFromSqlite(r.ShopID);
        const agentMaHex = toHexFromSqlite(r.AgentID);
        return {
          maInvoiceIdHex,
          shopMaHex,
          agentMaHex,
          invoiceDateTime: r.InvoiceDateTime,
          amount: Number(r.InvoiceAmount || 0),
          productCount: Number(r.ProductCount || 0),
          note: r.Note || null,
        };
      });

      const validInvoices = invoices.filter((i) => !!i.maInvoiceIdHex);
      const filteredCount = validInvoices.length;

      const maInvoiceIdHexList = validInvoices
        .map((i) => i.maInvoiceIdHex)
        .filter(Boolean);

      // 4) магазины
      const stores = await prisma.store.findMany({
        where: { maShopId: { not: null } },
        select: { id: true, maShopId: true, title: true, userId: true },
      });
      const storeByMa = new Map();
      for (const s of stores) {
        if (!s.maShopId) continue;
        storeByMa.set(normalizeHex(s.maShopId), s);
      }

      // 5) уже импортированные заказы
      const existing = maInvoiceIdHexList.length
        ? await prisma.order.findMany({
            where: { maInvoiceIdHex: { in: maInvoiceIdHexList } },
            select: { id: true, maInvoiceIdHex: true },
          })
        : [];
      const existingByMa = new Map();
      for (const o of existing) {
        if (!o.maInvoiceIdHex) continue;
        existingByMa.set(normalizeHex(o.maInvoiceIdHex), o.id);
      }

      // 6) превью
      let cntExisting = 0;
      let cntNoStore = 0;

      const previewInvoices = validInvoices.map((inv) => {
        const maKey = normalizeHex(inv.maInvoiceIdHex);
        const store = inv.shopMaHex
          ? storeByMa.get(normalizeHex(inv.shopMaHex)) || null
          : null;
        const existingOrderId = existingByMa.get(maKey) || null;
        if (existingOrderId) cntExisting += 1;
        if (!store) cntNoStore += 1;

        return {
          maInvoiceIdHex: inv.maInvoiceIdHex,
          shopMaHex: inv.shopMaHex,
          agentMaHex: inv.agentMaHex,
          invoiceDateTime: inv.invoiceDateTime,
          amount: inv.amount,
          productCount: inv.productCount,
          note: inv.note,
          storeTitle: store?.title || null,
          storeId: store?.id || null,
          existingOrderId,
        };
      });

      const stats = {
        alreadyImported: cntExisting,
        withoutStore: cntNoStore,
        importable: filteredCount - cntExisting - cntNoStore,
      };

      return res.json({
        token: req.file.filename,
        totalInvoices,
        filteredCount,
        stats,
        invoices: previewInvoices,
      });
    } catch (e) {
      console.error('[preview MA orders] error', e);
      return res
        .status(500)
        .json({ error: 'Ошибка при чтении MobileAgent.db3', details: e.message });
    } finally {
      if (db) db.close();
    }
  }
);

/* ====================== COMMIT ====================== */

/**
 * POST /admin/mobileagent-orders/commit
 * JSON:
 *   {
 *     "token": "<filename из preview>",
 *     "maInvoiceIds": ["abc123...", "..."]
 *   }
 */
router.post('/commit', async (req, res) => {
  const { token, maInvoiceIds } = req.body || {};
  if (!token || !Array.isArray(maInvoiceIds) || maInvoiceIds.length === 0) {
    return res
      .status(400)
      .json({ error: 'Нужны token и непустой массив maInvoiceIds' });
  }

  const dbPath = path.join('uploads', token);
  if (!fs.existsSync(dbPath)) {
    return res.status(400).json({ error: 'Файл MobileAgent не найден (token)' });
  }

  // нормализуем список hex
  const uniqMaIds = Array.from(
    new Set(maInvoiceIds.map((h) => normalizeHex(h)).filter(Boolean))
  );

  if (!uniqMaIds.length) {
    return res.status(400).json({ error: 'Нет валидных maInvoiceIds' });
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true });

    // магазины
    const stores = await prisma.store.findMany({
      where: { maShopId: { not: null } },
      select: { id: true, maShopId: true, title: true, userId: true },
    });
    const storeByMa = new Map();
    for (const s of stores) {
      if (!s.maShopId) continue;
      storeByMa.set(normalizeHex(s.maShopId), s);
    }

    // товары: externalId + productId → productId (plain + AES)
    const externalIds = await prisma.productExternalId.findMany({
      select: { externalId: true, productId: true },
    });
    const productsWithMa = await prisma.product.findMany({
      where: { productId: { not: null } },
      select: { id: true, productId: true },
    });

    const productIdMapExternal = buildProductIdMapFromExternal(externalIds);
    const productIdMapProduct = buildProductIdMapFromProduct(productsWithMa);

    // стейтменты
    const stmtInvoice = db.prepare(`
      SELECT
        I.InvoiceID,
        I.ShopID,
        I.AgentID,
        I.VisitID,
        I.InvoiceDateTime,
        I.InvoiceAmount,
        I.ProductCount,
        I.Note
      FROM Invoice I
      WHERE I.InvoiceID = ?
      LIMIT 1
    `);

    const stmtItems = db.prepare(`
      SELECT
        IP.ProductID,
        IP.Price,
        IP.Volume
      FROM InvoiceProduct IP
      WHERE IP.InvoiceID = ?
    `);

    const stmtVisitInvoices = db.prepare(`
      SELECT
        I.InvoiceID
      FROM Invoice I
      WHERE I.VisitID = ?
    `);

    // расширяем список накладных на весь визит
    const allMaIdsSet = new Set(uniqMaIds);
    for (const maHex of uniqMaIds) {
      const norm = normalizeHex(maHex);
      if (!norm) continue;
      const bufId = hexToBuffer(norm);
      if (!bufId) continue;

      const invRow = stmtInvoice.get(bufId);
      if (!invRow || !invRow.VisitID) continue;

      const visitInvoices = stmtVisitInvoices.all(invRow.VisitID);
      for (const row of visitInvoices) {
        const h = toHexFromSqlite(row.InvoiceID);
        if (h) allMaIdsSet.add(normalizeHex(h));
      }
    }
    const allMaIds = Array.from(allMaIdsSet);

    // уже существующие заказы по всем накладным визитов
    const existing = await prisma.order.findMany({
      where: { maInvoiceIdHex: { in: allMaIds } },
      select: { id: true, maInvoiceIdHex: true },
    });
    const existingByMa = new Map();
    for (const o of existing) {
      if (!o.maInvoiceIdHex) continue;
      existingByMa.set(normalizeHex(o.maInvoiceIdHex), o.id);
    }

    const created = [];
    const skippedExisting = [];
    const skippedNoStore = [];
    const skippedNoItems = [];
    const skippedNotFound = [];

    const currentAdminId = req.user.id;

    for (const maHex of allMaIds) {
      if (existingByMa.has(maHex)) {
        skippedExisting.push(maHex);
        continue;
      }

      const bufId = hexToBuffer(maHex);
      if (!bufId) {
        skippedNotFound.push(maHex);
        continue;
      }

      const inv = stmtInvoice.get(bufId);
      if (!inv) {
        skippedNotFound.push(maHex);
        continue;
      }

      const shopHex = toHexFromSqlite(inv.ShopID);
      const store =
        shopHex && storeByMa.get(normalizeHex(shopHex))
          ? storeByMa.get(normalizeHex(shopHex))
          : null;

      if (!store) {
        skippedNoStore.push(maHex);
        continue;
      }

      const itemsRows = stmtItems.all(bufId);
      if (!itemsRows || !itemsRows.length) {
        skippedNoItems.push(maHex);
        continue;
      }

      // маппинг позиций на Product
      const itemsData = [];
      for (const r of itemsRows) {
        const prodHex = toHexFromSqlite(r.ProductID);
        // пустой ProductID (удалённый товар) — просто пропускаем строку
        if (!prodHex) continue;

        const key = normalizeHex(prodHex);
        let productId = productIdMapExternal.get(key);
        if (!productId) {
          productId = productIdMapProduct.get(key);
        }
        if (!productId) continue;

        const price = Number(r.Price || 0);
        const qty = Number(r.Volume || 0);
        if (!price || !qty) continue;

        itemsData.push({
          productId,
          price,
          quantity: qty,
        });
      }

      if (!itemsData.length) {
        skippedNoItems.push(maHex);
        continue;
      }

      const amount = Number(inv.InvoiceAmount || 0);
      const note = inv.Note || null;
      const dtRaw = inv.InvoiceDateTime;
      const dt = dtRaw ? new Date(dtRaw) : new Date();

      const order = await prisma.order.create({
        data: {
          storeId: store.id,
          userId: store.userId || currentAdminId,
          total:
            amount > 0
              ? amount
              : itemsData.reduce((s, i) => s + i.price * i.quantity, 0),
          status: 'DONE',
          agentComment: note ? String(note).slice(0, 500) : null,
          maInvoiceIdHex: maHex,
          maAppliedAt: dt,
          createdAt: dt, // ← реальная дата/время заказа из MobileAgent
          items: {
            create: itemsData,
          },
        },
        select: { id: true },
      });

      created.push({ maInvoiceIdHex: maHex, orderId: order.id });
    }

    console.log(
      '[MA import]',
      'created:', created.length,
      'existing:', skippedExisting.length,
      'noStore:', skippedNoStore.length,
      'noItems:', skippedNoItems.length,
      'notFound:', skippedNotFound.length,
    );

    return res.json({
      createdCount: created.length,
      created,
      skippedExisting,
      skippedNoStore,
      skippedNoItems,
      skippedNotFound,
    });
  } catch (e) {
    console.error('[commit MA orders] error', e);
    return res
      .status(500)
      .json({ error: 'Ошибка импорта заказов из MobileAgent', details: e.message });
  } finally {
    if (db) db.close();
  }
});

export default router;
