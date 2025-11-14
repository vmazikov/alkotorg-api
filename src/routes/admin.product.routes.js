// src/routes/admin.product.routes.js
import fs from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import prisma from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';
import { normalizeName } from '../utils/strings.js';
import { toBool } from '../utils/parse.js';
import { IMAGE_DIR, buildImageUrl } from '../utils/imageStorage.js';

const router = Router();
const fsp = fs.promises;
const LEGACY_IMAGE_DIR = path.resolve(IMAGE_DIR, '..', 'img');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES_PER_UPLOAD = 10;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const MIME_EXTENSION_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdir(IMAGE_DIR, { recursive: true }, err => cb(err, IMAGE_DIR));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${randomUUID()}${ext}`);
  }
});

const imageUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Недопустимый тип файла. Разрешены только JPEG, PNG или WEBP'));
    } else {
      cb(null, true);
    }
  }
});

const formatImage = image => ({
  id: image.id,
  alt: image.alt,
  order: image.order,
  fileName: image.fileName,
  url: buildImageUrl(image.fileName),
  createdAt: image.createdAt
});

async function deleteFileSafe(fileName) {
  if (!fileName) return;
  const candidateDirs = [IMAGE_DIR, LEGACY_IMAGE_DIR];

  for (const dir of candidateDirs) {
    const target = path.join(dir, fileName);
    try {
      await fsp.unlink(target);
      return;
    } catch (err) {
      if (err.code === 'ENOENT') {
        continue;
      }
      console.warn(`Failed to remove image ${fileName} from ${dir}:`, err.message);
      return;
    }
  }
}

async function cleanupUploadedFiles(files = []) {
  await Promise.all(
    (files || []).map(file => fsp.unlink(file.path).catch(() => {}))
  );
}

async function getProductImages(productId) {
  const rows = await prisma.productImage.findMany({
    where: { productId },
    orderBy: { order: 'asc' }
  });
  return rows.map(formatImage);
}

async function downloadImageFromUrl(url) {
  if (!url) throw new Error('URL обязателен');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Некорректный URL');
  }

  const response = await fetch(parsed.toString(), { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Не удалось скачать изображение (${response.status})`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!contentType || !ALLOWED_MIME_TYPES.has(contentType)) {
    throw new Error('Недопустимый тип файла. Разрешены JPEG, PNG, WEBP');
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength && contentLength > MAX_FILE_SIZE) {
    throw new Error('Размер файла превышает 5 МБ');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('Размер файла превышает 5 МБ');
  }

  const extFromPath = path.extname(parsed.pathname).toLowerCase();
  const extension = extFromPath || MIME_EXTENSION_MAP[contentType] || '.jpg';
  const fileName = `${randomUUID()}${extension}`;
  await fsp.writeFile(path.join(IMAGE_DIR, fileName), buffer);
  return fileName;
}

// Защита: JWT + только ADMIN
router.use(authMiddleware);
router.use(role(['ADMIN']));

/**
 * GET /admin/products?withPromo=true
 * Возвращает все товары (включая архивные), опционально с последней акцией
 */
router.get('/', async (req, res, next) => {
  try {
    const includePromo = req.query.withPromo === 'true';
    const productsRaw = await prisma.product.findMany({
      orderBy: { id: 'asc' },
      include: {
        ...(includePromo ? { promos: true } : {}),
        images: { orderBy: { order: 'asc' } }
      },
    });
    const products = productsRaw.map(p => {
      const lastPromo = (p.promos?.length)
        ? p.promos[p.promos.length - 1]
        : null;
      const { promos, images, ...rest } = p;
      const formattedImages = images.map(formatImage);
      const cover = formattedImages[0]?.url ?? rest.img ?? null;
      return { ...rest, img: cover, promo: lastPromo, images: formattedImages };
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

/** PUT /admin/products/:id — обновление товара */
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = {};

    // Текстовые поля
    [
      'article','name','rawName','brand','type','img',
      'wineColor','sweetnessLevel','wineType','giftPackaging',
      'manufacturer','excerpt','rawMaterials','taste',
      'description'           // ← добавлено
    ].forEach(key => {
      if (req.body[key] !== undefined) {
        data[key] = req.body[key];
      }
    });

    // Числовые поля
    [ 'volume','degree','basePrice','stock' ].forEach(key => {
      if (req.body[key] !== undefined) {
        const v = req.body[key];
        data[key] = v === null ? null : Number(v);
      }
    });

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(data.rawName !== undefined
          ? { canonicalName: data.rawName ? normalizeName(data.rawName) : null }
          : {})
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/** PATCH /admin/products/:id/archive — пометить в архив */
router.patch('/:id/archive', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const archived = await prisma.product.update({
      where: { id },
      data: { isArchived: true },
    });
    res.json(archived);
  } catch (err) {
    next(err);
  }
});

/** PATCH /admin/products/:id/unarchive — вернуть из архива */
router.patch('/:id/unarchive', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const restored = await prisma.product.update({
      where: { id },
      data: { isArchived: false },
    });
    res.json(restored);
  } catch (err) {
    next(err);
  }
});

/** DELETE /admin/products/:id — удалить товар и все связи */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existingImages = await prisma.productImage.findMany({
      where: { productId: id },
      select: { fileName: true }
    });

    // Удаляем все связанные записи в нужном порядке
    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { productId: id } }),
      prisma.cartItem.deleteMany({ where: { productId: id } }),
      prisma.promo.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);

    await Promise.all(existingImages.map(img => deleteFileSafe(img.fileName)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** GET /admin/products/:id/images — список всех изображений товара */
router.get('/:id/images', async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true }
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const images = await getProductImages(productId);
    res.json(images);
  } catch (err) {
    next(err);
  }
});

/** POST /admin/products/:id/images — загрузка изображений */
router.post(
  '/:id/images',
  imageUpload.array('images', MAX_FILES_PER_UPLOAD),
  async (req, res, next) => {
    const productId = Number(req.params.id);
    try {
      if (!req.files?.length) {
        return res.status(400).json({ error: 'Файлы не получены' });
      }

      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true }
      });
      if (!product) {
        await cleanupUploadedFiles(req.files);
        return res.status(404).json({ error: 'Product not found' });
      }

      const { _max } = await prisma.productImage.aggregate({
        where: { productId },
        _max: { order: true }
      });
      const startOrder = (_max?.order ?? 0) + 1;

      const payloads = req.files.map((file, idx) => ({
        productId,
        fileName: file.filename,
        alt: file.originalname,
        order: startOrder + idx,
      }));

      const created = await prisma.$transaction(
        payloads.map(data => prisma.productImage.create({ data }))
      );

      res.status(201).json(created.map(formatImage));
    } catch (err) {
      await cleanupUploadedFiles(req.files);
      next(err);
    }
  }
);

/** POST /admin/products/:id/images/by-url — добавить изображение по ссылке */
router.post('/:id/images/by-url', async (req, res, next) => {
  const productId = Number(req.params.id);
  const { url, alt } = req.body ?? {};

  if (!url) {
    return res.status(400).json({ error: 'url обязателен' });
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true }
    });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const fileName = await downloadImageFromUrl(url);

    const { _max } = await prisma.productImage.aggregate({
      where: { productId },
      _max: { order: true },
    });

    const created = await prisma.productImage.create({
      data: {
        productId,
        fileName,
        alt: alt ?? null,
        order: (_max?.order ?? 0) + 1,
      }
    });

    res.status(201).json(formatImage(created));
  } catch (err) {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/** PUT /admin/products/:id/images/reorder — пересортировать изображения */
router.put('/:id/images/reorder', async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map(Number).filter(Number.isInteger)
      : [];

    if (!ids.length) {
      return res.status(400).json({ error: 'ids должны быть непустым массивом чисел' });
    }

    const existing = await prisma.productImage.findMany({
      where: { productId },
      select: { id: true }
    });
    const existingIds = new Set(existing.map(img => img.id));

    if (ids.some(id => !existingIds.has(id)) || existing.length !== ids.length) {
      return res.status(400).json({ error: 'Список ids должен содержать все изображения товара' });
    }

    await prisma.$transaction(
      ids.map((imageId, idx) =>
        prisma.productImage.update({
          where: { id: imageId },
          data: { order: idx + 1 }
        })
      )
    );

    const images = await getProductImages(productId);
    res.json(images);
  } catch (err) {
    next(err);
  }
});

/** PATCH /admin/products/:id/images/:imageId — обновить подпись */
router.patch('/:id/images/:imageId', async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const imageId = Number(req.params.imageId);
    const alt = req.body.alt;

    if (alt === undefined) {
      return res.status(400).json({ error: 'alt обязателен' });
    }

    const image = await prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) return res.status(404).json({ error: 'Image not found' });

    const updated = await prisma.productImage.update({
      where: { id: imageId },
      data: { alt },
    });

    res.json(formatImage(updated));
  } catch (err) {
    next(err);
  }
});

/** DELETE /admin/products/:id/images/:imageId — удалить изображение */
router.delete('/:id/images/:imageId', async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const imageId = Number(req.params.imageId);

    const image = await prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) return res.status(404).json({ error: 'Image not found' });

    await prisma.productImage.delete({ where: { id: imageId } });
    await deleteFileSafe(image.fileName);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** POST /admin/products/:id/promo — создать новую акцию */
router.post('/:id/promo', async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const { promoPrice, comment, expiresAt } = req.body;
    const applyModifier = toBool(req.body.applyModifier);
    const promo = await prisma.promo.create({
      data: {
        productId,
        promoPrice: Number(promoPrice),
        comment: comment || null,
        expiresAt: new Date(expiresAt),
        ...(applyModifier === undefined ? {} : { applyModifier }),
      },
    });
    res.status(201).json(promo);
  } catch (err) {
    next(err);
  }
});

/** PATCH /admin/products/:id/promo/:promoId — редактировать акцию */
router.patch('/:id/promo/:promoId', async (req, res, next) => {
  try {
    const promoId = Number(req.params.promoId);
    const { promoPrice, comment, expiresAt } = req.body;
    const applyModifier = toBool(req.body.applyModifier);
    const updated = await prisma.promo.update({
      where: { id: promoId },
      data: {
        promoPrice: Number(promoPrice),
        comment: comment || null,
        expiresAt: new Date(expiresAt),
        ...(applyModifier === undefined ? {} : { applyModifier }),
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
