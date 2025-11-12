// src/scripts/backfill-product-aliases.cjs
require('dotenv').config({ path: '.env' });          // <-- важно
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normalizeName(raw = '') {
  let s = String(raw || '').toLowerCase().trim();
  s = s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  s = s.replace(/[\s,]*\(?\s*(x|×)?\s*\d+\s*(шт|штук|pcs)?\s*\)?\s*$/i, '');
  s = s.replace(/[,\.;:]\s*$/,'').trim();
  return s;
}

(async () => {
  const products = await prisma.product.findMany({
    select: { id:true, productId:true, name:true, rawName:true, canonicalName:true }
  });

  let createdAliases = 0, updatedNames = 0;

  for (const p of products) {
    if (p.productId) {
      await prisma.productExternalId.upsert({
        where: { externalId: p.productId },
        update: { isPrimary: true, syncedAt: new Date() },
        create: { productId: p.id, externalId: p.productId, isPrimary: true }
      });
      createdAliases++;
    }
    const rn = p.rawName ?? p.name ?? null;
    const cn = p.canonicalName ?? (rn ? normalizeName(rn) : null);
    if (rn !== p.rawName || cn !== p.canonicalName) {
      await prisma.product.update({
        where: { id: p.id },
        data: { rawName: rn, canonicalName: cn }
      });
      updatedNames++;
    }
  }

  console.log({ createdAliases, updatedNames });
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
