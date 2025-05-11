// src/routes/store.routes.js
import { Router } from 'express'
import prisma from '../utils/prisma.js'
import { authMiddleware, role } from '../middlewares/auth.js'

const router = Router()

// Все запросы под этой веткой требуют авторизации
router.use(authMiddleware)

/**
 * GET /stores
 *
 * - ADMIN  → все магазины
 * - AGENT  → все магазины (потом можно добавить фильтр по клиентам агента)
 * - USER   → только свои (userId)
 * - MANAGER→ только тот, где он managerId
 */
router.get(
  '/',
  role(['ADMIN', 'AGENT', 'USER', 'MANAGER']),
  async (req, res, next) => {
    try {
      const { role: r, id: uid } = req.user
      const where = {}

      if (r === 'USER') {
        where.userId = uid
      } else if (r === 'MANAGER') {
        where.managerId = uid
      }
      // вручную переданный ?userId переопределит выборку
      if (req.query.userId) {
        where.userId = Number(req.query.userId)
      }

      const stores = await prisma.store.findMany({
        where,
        include: {
          // владелец (тот, кто создал магазин)
          user: {
            select: {
              id: true,
              login: true,
              fullName: true,
              phone: true,
              role: true,
            },
          },
          // менеджер, если назначен
          manager: {
            select: {
              id: true,
              login: true,
              fullName: true,
              phone: true,
              role: true,
            },
          },
        },
        orderBy: { id: 'asc' },
      })

      res.json(stores)
    } catch (err) {
      next(err)
    }
  }
)

/**
 * POST /stores
 * Создать новый магазин
 * Доступ: ADMIN, AGENT
 * body: { userId, title, address, managerId? }
 */
router.post(
  '/',
  role(['ADMIN', 'AGENT']),
  async (req, res, next) => {
    try {
      const { userId, title, address, managerId } = req.body
      const store = await prisma.store.create({
        data: {
          userId:   Number(userId),
          title,
          address,
          // managerId может быть null или undefined
          managerId: managerId != null ? Number(managerId) : undefined,
        },
        include: {
          user:    { select: { id: true, login: true, fullName: true, phone: true, role: true } },
          manager: { select: { id: true, login: true, fullName: true, phone: true, role: true } },
        },
      })

      res.status(201).json(store)
    } catch (err) {
      next(err)
    }
  }
)

/**
 * PUT /stores/:id
 * Обновить магазин
 * Доступ: ADMIN, AGENT
 * body: { title?, address?, managerId? }
 */
router.put(
  '/:id',
  role(['ADMIN', 'AGENT']),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const { title, address, managerId } = req.body

      const store = await prisma.store.update({
        where: { id },
        data : {
          // обновляем только переданные поля
          ...(title   != null ? { title }   : {}),
          ...(address != null ? { address } : {}),
          ...(managerId !== undefined
            ? { managerId: managerId != null ? Number(managerId) : null }
            : {}),
        },
        include: {
          user:    { select: { id: true, login: true, fullName: true, phone: true, role: true } },
          manager: { select: { id: true, login: true, fullName: true, phone: true, role: true } },
        },
      })

      res.json(store)
    } catch (err) {
      next(err)
    }
  }
)

export default router
