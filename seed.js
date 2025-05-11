// seed.js
import bcrypt from 'bcrypt';
import prisma from './src/utils/prisma.js';

const email = 'admin@mail.com';
const plain = 'admin123';
const phone = '1234567890';

const hash = await bcrypt.hash(plain, 10);
await prisma.user.create({
  data: { email, passwordHash: hash, phone: phone, role: 'ADMIN' },
});
console.log('User created:', email, plain);
await prisma.$disconnect();
