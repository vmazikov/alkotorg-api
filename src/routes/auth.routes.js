// src/routes/auth.routes.js
import { Router }  from 'express';
import bcrypt      from 'bcrypt';
import jwt         from 'jsonwebtoken';
import dotenv      from 'dotenv';
import prisma      from '../utils/prisma.js';

dotenv.config();

const router = Router();
const JWT_EXPIRES = '12h';

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
function signToken(user) {
  /** кладём всё, что чаще всего нужно на фронте */
  const payload = {
    id            : user.id,
    role          : user.role,
    priceModifier : user.priceModifier ?? 0,   // для расчёта цены
  };

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/* ------------------------------------------------------------------ */
/* POST  /auth/login  — логин                                         */
/* ------------------------------------------------------------------ */
router.post('/login', async (req, res) => {
  const { email = '', password = '' } = req.body;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const passOk = await bcrypt.compare(password, user.passwordHash);
  if (!passOk) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user);

  return res.json({
    token,
    user: {
      id            : user.id,
      role          : user.role,
      email         : user.email,
      priceModifier : user.priceModifier ?? 0,
    },
    expiresIn: JWT_EXPIRES,
  });
});

/* ------------------------------------------------------------------ */
/* POST  /auth/register  — создание пользователя (опц., для админа)   */
/* ------------------------------------------------------------------ */
router.post('/register', async (req, res) => {
  const { email, password, role = 'USER', priceModifier = 0 } = req.body;

  /* simple guard */
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail and password required' });
  }

  const exist = await prisma.user.findUnique({ where: { email } });
  if (exist) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash, role, priceModifier },
  });

  const token = signToken(user);

  return res.status(201).json({
    token,
    user: {
      id            : user.id,
      role          : user.role,
      email         : user.email,
      priceModifier : user.priceModifier ?? 0,
    },
    expiresIn: JWT_EXPIRES,
  });
});

/* ------------------------------------------------------------------ */
/* GET  /auth/me  — получение данных текущего пользователя из токена  */
/* ------------------------------------------------------------------ */
router.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return res.json(payload);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
