#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { IMAGE_DIR } from '../src/utils/imageStorage.js';

const prisma = new PrismaClient();
const fsp = fs.promises;

async function ensureDir() {
  await fsp.mkdir(IMAGE_DIR, { recursive: true });
}

function sanitizeLocalName(value = '') {
  if (!value) return null;
  if (value.startsWith('/img/')) return value.replace('/img/', '');
  if (value.startsWith('img/')) return value.slice(4);
  if (value.startsWith('uploads/img/')) return value.replace('uploads/img/', '');
  if (value.startsWith('uploads/card-img/')) return value.replace('uploads/card-img/', '');
  if (value.startsWith('card-img/')) return value.replace('card-img/', '');
  return null;
}

async function tryReuseLocalFile(value) {
  const localName = sanitizeLocalName(value);
  if (!localName) return null;
  const candidate = path.join(IMAGE_DIR, localName);
  try {
    await fsp.access(candidate);
    return localName;
  } catch {
    return null;
  }
}

async function copyAbsoluteOrRelative(value) {
  if (!value) return null;
  const candidate = path.isAbsolute(value)
    ? value
    : path.resolve(value);
  try {
    await fsp.access(candidate);
  } catch {
    return null;
  }
  const ext = path.extname(candidate) || '.jpg';
  const fileName = `${randomUUID()}${ext}`;
  await fsp.copyFile(candidate, path.join(IMAGE_DIR, fileName));
  return fileName;
}

async function downloadRemote(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось скачать ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  let ext = '.jpg';
  try {
    const parsed = new URL(url);
    const maybeExt = path.extname(parsed.pathname);
    if (maybeExt) ext = maybeExt;
  } catch {
    // игнорируем
  }
  const fileName = `${randomUUID()}${ext}`;
  await fsp.writeFile(path.join(IMAGE_DIR, fileName), buffer);
  return fileName;
}

async function resolveFile(imgValue) {
  if (!imgValue) return null;
  const reused = await tryReuseLocalFile(imgValue);
  if (reused) return reused;

  if (imgValue.startsWith('http://') || imgValue.startsWith('https://')) {
    return downloadRemote(imgValue);
  }

  return copyAbsoluteOrRelative(imgValue);
}

async function main() {
  await ensureDir();
  const products = await prisma.product.findMany({
    where: { img: { not: null } },
    select: { id: true, img: true },
    orderBy: { id: 'asc' }
  });

  async function clearLegacyImage(productId) {
    await prisma.product.update({
      where: { id: productId },
      data: { img: null },
    });
  }

  for (const product of products) {
    try {
      const existingCount = await prisma.productImage.count({ where: { productId: product.id } });
      if (existingCount > 0) {
        console.log(`Пропускаю товар ${product.id} — изображения уже есть`);
        continue;
      }

      const fileName = await resolveFile(product.img);
      if (!fileName) {
        console.warn(`Не удалось обработать ${product.id}: ${product.img}`);
        await clearLegacyImage(product.id);
        continue;
      }

      const { _max } = await prisma.productImage.aggregate({
        where: { productId: product.id },
        _max: { order: true },
      });

      await prisma.productImage.create({
        data: {
          productId: product.id,
          fileName,
          order: (_max?.order ?? 0) + 1,
          alt: null,
        }
      });

      await prisma.product.update({
        where: { id: product.id },
        data: { img: null },
      });

      console.log(`✔ Товар ${product.id}: ${imgValueBrief(product.img)} → ${fileName}`);
    } catch (err) {
      console.error(`✖ Ошибка для товара ${product.id}:`, err.message);
      try {
        await clearLegacyImage(product.id);
      } catch (cleanupErr) {
        console.error(`Не удалось очистить img у товара ${product.id}:`, cleanupErr.message);
      }
    }
  }
}

function imgValueBrief(value) {
  if (!value) return '';
  if (value.length <= 60) return value;
  return `${value.slice(0, 57)}...`;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
