import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/utils/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

beforeAll(async () => {
  await prisma.user.deleteMany();
  const hash = await bcrypt.hash('pass', 10);
  await prisma.user.create({ data: { email: 'test@mail.com', passwordHash: hash } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('login returns token', async () => {
  const res = await request(app).post('/auth/login').send({ email: 'test@mail.com', password: 'pass' });
  expect(res.statusCode).toBe(200);
  expect(res.body.token).toBeDefined();
  const decoded = jwt.decode(res.body.token);
  expect(decoded.email).toBe('test@mail.com');
});
