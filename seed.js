// seed.js
import bcrypt from 'bcrypt';
import prisma from './src/utils/prisma.js';

const email = 'admin@mail.com';
const plain = 'admin123';

const hash = await bcrypt.hash(plain, 10);
await prisma.user.create({
  data: { email, passwordHash: hash, role: 'ADMIN' },
});
console.log('User created:', email, plain);
await prisma.$disconnect();
