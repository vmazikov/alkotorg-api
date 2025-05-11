
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();
export function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ message: 'No token' });
  try {
    req.user = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ message: 'Invalid token' });
  }
}
export const role = (r) => (req,res,next) => {
  if (!r.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' });
  next();
};
