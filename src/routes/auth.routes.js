
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import prisma from '../utils/prisma.js';
dotenv.config();
const r = Router();
r.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  if (!(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user.id, role: user.role, email: user.email } });
});
export default r;
