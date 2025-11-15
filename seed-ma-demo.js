// scripts/seed-ma-demo.js
import prisma from './src/utils/prisma.js';
import jwt from 'jsonwebtoken';

const AGENT_HEX = '07d2dbdf5fb4924fb6074d71646c5e92'; // пример
const SHOP_HEX  = '56f704e2fa4e7c449ca53efd8dc0af29';
const PROD1_HEX = '1b9be2572d4880b43b33305579575f69';
const PROD2_HEX = '10f6e77d5932d24b8b8a00e61a661b50';
const article1 = 'DEMO-ART-001';
const article2 = 'DEMO-ART-002';

async function main() {
  // 1) агент
  const agent = await prisma.user.upsert({
    where: { login: 'agent_demo' },
    update: { maAgentId: AGENT_HEX, role: 'AGENT' },
    create: {
      login: 'agent_demo',
      passwordHash: '$2b$10$K7m5e5p8T6Wc6o0u9fH0UO3wqk2G1mYkIYQ6xw0m7t0t8p7m7m7m.', // заглушка
      role: 'AGENT',
      phone: '+79990000000',
      maAgentId: AGENT_HEX
    }
  });

  // 2) покупатель
  const user = await prisma.user.upsert({
    where: { login: 'client_demo' },
    update: { agentId: agent.id },
    create: {
      login: 'client_demo',
      passwordHash: agent.passwordHash,
      role: 'USER',
      phone: '+79990000001',
      agentId: agent.id
    }
  });

  // 3) магазин
  const store = await prisma.store.upsert({
    where: { id: 999999 }, // чтобы не конфликтовать — или делай create
    update: { },
    create: {
      id: 999999,
      title: 'МАГАЗИН ДЕМО',
      address: 'ул. Тестовая, 1',
      userId: user.id,
      agentId: agent.id,
      maShopId: SHOP_HEX
    }
  });

  // 4) товары (важно: Product.productId = MA hex)
  const p1 = await prisma.product.upsert({
    where: { productId: PROD1_HEX },
    update: { basePrice: 100, stock: 100, article: article1 },
    create: { productId: PROD1_HEX, name: 'Товар #1', basePrice: 100, stock: 100, article: article1 }
  });
  const p2 = await prisma.product.upsert({
    where: { productId: PROD2_HEX },
    update: { basePrice: 250, stock: 50, article: article2 },
    create: { productId: PROD2_HEX, name: 'Товар #2', basePrice: 250, stock: 50, article: article2 }
  });

  // 5) заказ NEW с позициями
  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      userId: user.id,
      status: 'NEW',
      total: 0,
      agentComment: 'Демо заказ',
      items: {
        create: [
          { productId: p1.id, price: 0, quantity: 6 },
          { productId: p2.id, price: 0, quantity: 2 }
        ]
      }
    },
    include: { items: true }
  });

  // 6) выдаём тестовый JWT агента
  const token = jwt.sign({ id: agent.id, role: 'AGENT' }, process.env.JWT_SECRET, { expiresIn: '2h' });

  console.log(JSON.stringify({
    agentId: agent.id,
    storeId: store.id,
    orderId: order.id,
    jwt: token
  }, null, 2));
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
