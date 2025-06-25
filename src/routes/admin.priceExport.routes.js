// src/routes/admin.priceExport.routes.js  (или добавьте в существующий файл)
import { Router } from 'express';
import xlsx       from 'xlsx';
import prisma     from '../utils/prisma.js';
import { role }   from '../middlewares/auth.js';

const router = Router();

/**
 * GET /admin/price/export?scope=all|active|archived
 * ↳ attachment: price_export_<timestamp>.xlsx
 */
router.get(
  '/',
  role(['ADMIN']),
  async (req, res, next) => {
    try {
      const scope = (req.query.scope ?? 'all').toString().toLowerCase();

      const where =
        scope === 'active'
          ? { isArchived: false }
          : scope === 'archived'
          ? { isArchived: true }
          : {};               // all

      // тянем продукты с промо
      const products = await prisma.product.findMany({
        where,
        include: { promos: true },
        orderBy: { id: 'asc' },
      });

      /* ---------- Price sheet ---------- */
      const priceRows = products.map(p => ({
        id:                p.id,
        productId:         p.productId,
        article:           p.article,
        productVolumeId:   p.productVolumeId,
        name:              p.name,
        brand:             p.brand,
        type:              p.type,
        volume:            p.volume,
        degree:            p.degree,
        quantityInBox:     p.quantityInBox,
        basePrice:         p.basePrice,
        stock:             p.stock,
        nonModify:         p.nonModify,
        isArchived:        p.isArchived,
        bottleType:        p.bottleType,
        countryOfOrigin:   p.countryOfOrigin,
        region:            p.region,
        whiskyType:        p.whiskyType,
        wineColor:         p.wineColor,
        sweetnessLevel:    p.sweetnessLevel,
        wineType:          p.wineType,
        giftPackaging:     p.giftPackaging,
        manufacturer:      p.manufacturer,
        excerpt:           p.excerpt,
        rawMaterials:      p.rawMaterials,
        spirtType:         p.spirtType,
        taste:             p.taste,
        tasteProduct:      p.tasteProduct,
        aromaProduct:      p.aromaProduct,
        colorProduct:      p.colorProduct,
        сombinationsProduct: p.сombinationsProduct,
        description:       p.description,
        isNew:             p.isNew,
        dateAdded:         p.dateAdded,
      }));

      const wb  = xlsx.utils.book_new();
      const ws1 = xlsx.utils.json_to_sheet(priceRows);
      xlsx.utils.book_append_sheet(wb, ws1, 'Price');

      /* ---------- Promos sheet ---------- */
      const promoRows = [];
      products.forEach(p =>
        p.promos.forEach(pr =>
          promoRows.push({
            productId:  p.productId,
            promoPrice: pr.promoPrice,
            comment:    pr.comment,
            expiresAt:  pr.expiresAt,
          })
        )
      );
      const ws2 = xlsx.utils.json_to_sheet(promoRows);
      xlsx.utils.book_append_sheet(wb, ws2, 'Promos');

      /* ---------- отправляем файл ---------- */
      const fileName = `price_export_${Date.now()}.xlsx`;
      const buffer   = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res
        .setHeader(
          'Content-Disposition',
          `attachment; filename="${fileName}"`
        )
        .setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        .send(buffer);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
