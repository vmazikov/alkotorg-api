// src/routes/admin.promo.routes.js
import { Router }   from 'express'
import prisma       from '../utils/prisma.js'
import { role }     from '../middlewares/auth.js'
import { toBool }   from '../utils/parse.js'

const router = Router()

/**
 * POST /admin/promos/bulk
 * Массовое создание акций для набора товаров
 * body: {
 *   expiresAt: ISODate,                 // общий срок действия (обязателен)
 *   applyModifier?: boolean,            // значение по умолчанию для всех items
 *   comment?: string,                   // общий комментарий
 *   items: [
 *     { productId, promoPrice, comment?, applyModifier?, expiresAt? }
 *   ]
 * }
 */
router.post(
  '/promos/bulk',
  role(['ADMIN']),
  async (req, res) => {
    const { expiresAt, items, applyModifier, comment } = req.body ?? {};
    if (!expiresAt) {
      return res.status(400).json({ error: 'expiresAt is required' });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }

    const baseExpiresAt = new Date(expiresAt);
    if (Number.isNaN(baseExpiresAt.getTime())) {
      return res.status(400).json({ error: 'expiresAt must be a valid date' });
    }

    const defaultApplyModifier = toBool(applyModifier);
    const defaultComment = comment ?? null;

    const errors = [];
    const payloads = [];

    items.forEach((item, index) => {
      const productId = Number(item?.productId);
      if (!Number.isInteger(productId) || productId <= 0) {
        errors.push({ index, error: 'productId must be a positive integer' });
        return;
      }
      const promoPrice = Number(item?.promoPrice);
      if (!Number.isFinite(promoPrice)) {
        errors.push({ index, error: 'promoPrice must be a finite number' });
        return;
      }

      const perItemApplyModifier = toBool(item?.applyModifier);
      const expires = item?.expiresAt ? new Date(item.expiresAt) : baseExpiresAt;
      if (Number.isNaN(expires.getTime())) {
        errors.push({ index, error: 'expiresAt in item must be a valid date' });
        return;
      }

      payloads.push({
        productId,
        promoPrice,
        comment: item?.comment !== undefined ? (item.comment || null) : defaultComment,
        expiresAt: expires,
        applyModifier: perItemApplyModifier ?? defaultApplyModifier,
      });
    });

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    const promos = await prisma.$transaction(
      payloads.map(payload =>
        prisma.promo.create({
          data: {
            product:   { connect: { id: payload.productId } },
            promoPrice: payload.promoPrice,
            comment:    payload.comment,
            expiresAt:  payload.expiresAt,
            ...(payload.applyModifier === undefined
              ? {}
              : { applyModifier: payload.applyModifier }),
          }
        })
      )
    );

    res.status(201).json({ created: promos.length, promos });
  }
)

/**
 * DELETE /admin/promos
 * Удалить все промо-акции
 */
router.delete(
  '/promos',
  role(['ADMIN']),
  async (req, res) => {
    const result = await prisma.promo.deleteMany()
    // result.count — сколько записей удалено
    res.json({ deleted: result.count })
  }
)

/**
 * DELETE /admin/products/:productId/promo/:promoId
 * Удалить конкретную акцию у товара
 */
router.delete(
  '/products/:productId/promo/:promoId',
  role(['ADMIN']),
  async (req, res) => {
    const promoId   = Number(req.params.promoId)
    const productId = Number(req.params.productId)

    // можно дополнительно проверить принадлежность
    const existing = await prisma.promo.findFirst({
      where: { id: promoId, productId }
    })
    if (!existing) {
      return res.status(404).json({ error: 'Акция не найдена' })
    }

    await prisma.promo.delete({ where: { id: promoId } })
    res.json({ deleted: 1 })
  }
)

export default router
