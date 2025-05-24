// src/routes/admin.promo.routes.js
import { Router }   from 'express'
import prisma       from '../utils/prisma.js'
import { role }     from '../middlewares/auth.js'

const router = Router()

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
