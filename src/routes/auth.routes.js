// src/routes/auth.routes.js
import { Router }  from 'express';
import bcrypt      from 'bcrypt';
import jwt         from 'jsonwebtoken';
import dotenv      from 'dotenv';
import prisma      from '../utils/prisma.js';

dotenv.config();

const r            = Router();
const JWT_EXPIRES  = '12h';

/* ------------------------------------------------------------------ */
/* util: формируем payload для фронта + подпись токена                */
/* ------------------------------------------------------------------ */
function makeToken(user) {
  const payload = {
    id           : user.id,
    role         : user.role,
    priceModifier: user.priceModifier ?? 0
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/* ------------------------------------------------------------------ */
/* 1. POST  /auth/login                                               */
/*    body { login, password }                                        */
/* ------------------------------------------------------------------ */
r.post('/login', async (req, res) => {
  const { login = '', password = '' } = req.body;

  const user = await prisma.user.findUnique({
    where: { login: login.trim().toLowerCase() }
  });

  /* одинаковое сообщение, чтобы не палить user */
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res
      .status(401)
      .json({ error: 'Invalid credentials', code: 'AUTH_INVALID_CREDENTIALS' });
  }

  const token = makeToken(user);

  return res.json({
    token,
    user: {
      id           : user.id,
      role         : user.role,
      fullName     : user.fullName,
      login        : user.login,
      phone        : user.phone,
      priceModifier: user.priceModifier ?? 0
    },
    expiresIn: JWT_EXPIRES
  });
});

/* ------------------------------------------------------------------ */
/* 2. POST  /auth/register                                            */
/*    body { fullName, login, phone, password, role?, priceModifier?, */
/*           agentId? }                                               */
/* ------------------------------------------------------------------ */
r.post('/register', async (req, res) => {
  const {
    fullName      = '',
    login         = '',
    phone         = '',
    password      = '',
    role          = 'USER',
    priceModifier = 0,
    agentId
  } = req.body;

  if (!login.trim() || !password.trim()) {
    return res
      .status(400)
      .json({ error: 'Login and password required', code: 'REGISTER_MISSING_FIELDS' });
  }

  /* проверяем уникальность login / phone */
  const clash = await prisma.user.findFirst({
    where: {
      OR: [
        { login: login.trim().toLowerCase() },
        phone ? { phone: phone.trim() } : { id: -1 }
      ]
    }
  });
  if (clash) {
    return res
      .status(409)
      .json({ error: 'Login or phone already in use', code: 'REGISTER_CONFLICT' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      fullName,
      login : login.trim().toLowerCase(),
      phone : phone.trim(),
      passwordHash,
      role,
      priceModifier: +priceModifier,
      agentId     : agentId ? +agentId : null
    }
  });

  const token = makeToken(user);

  return res.status(201).json({
    token,
    user: {
      id           : user.id,
      role         : user.role,
      fullName     : user.fullName,
      login        : user.login,
      phone        : user.phone,
      priceModifier: user.priceModifier ?? 0
    },
    expiresIn: JWT_EXPIRES
  });
});

/* ------------------------------------------------------------------ */
/* 3. GET  /auth/me   — вернуть payload, зашитый в валидный токен     */
/* ------------------------------------------------------------------ */
r.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');

  if (!token) {
    return res
      .status(401)
      .json({ error: 'No token provided', code: 'AUTH_NO_TOKEN' });
  }

  try {
    const data = jwt.verify(token, process.env.JWT_SECRET);
    return res.json(data);
  } catch (err) {
    return res
      .status(401)
      .json({ error: 'Invalid or expired token', code: 'AUTH_INVALID_TOKEN' });
  }
});

export default r;
