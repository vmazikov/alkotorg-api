// src/middlewares/auth.js
import jwt    from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

/* ------------------------------------------------------------------ */
/* 1.  authMiddleware                                                 */
/* ------------------------------------------------------------------ */
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';

  // ожидаем формата "Bearer <token>"
  const [, token] = header.split(' ');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/* ------------------------------------------------------------------ */
/* 2.  role(allowedRoles)                                             */
/*     используется **после** authMiddleware                          */
/* ------------------------------------------------------------------ */
export const role =
  (allowed) =>
  (req, res, next) => {
    /* если authMiddleware забыли подключить */
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
