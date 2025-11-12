// src/routes/admin.notification.routes.js
import { Router } from 'express';

import prisma from '../utils/prisma.js';
import { authMiddleware, role } from '../middlewares/auth.js';
import { computeNotificationState } from '../utils/notificationHelpers.js';
import notificationEvents from '../utils/notificationEvents.js';

const router = Router();
router.use(authMiddleware);
router.use(role(['ADMIN']));

const ALLOWED_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const ALLOWED_AUDIENCE_TYPES = ['GLOBAL', 'ROLE', 'USER'];
const ALLOWED_ROLES = ['ADMIN', 'AGENT', 'USER', 'MANAGER'];

const baseNotificationInclude = {
  audiences: {
    include: {
      user: {
        select: {
          id: true,
          login: true,
          fullName: true,
          role: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  },
  createdBy: {
    select: {
      id: true,
      login: true,
      fullName: true,
      role: true,
    },
  },
  _count: {
    select: {
      reads: true,
    },
  },
};

router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const take = clampNumber(req.query.take, 50, 1, 200);
    const skip = clampNumber(req.query.skip, 0, 0, 10_000);
    const where = buildListWhere(req.query, now);

    const [total, items] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        take,
        skip,
        orderBy: [{ createdAt: 'desc' }],
        include: baseNotificationInclude,
      }),
    ]);

    res.json({
      total,
      count: items.length,
      items: items.map(item => presentNotification(item, now)),
    });
  } catch (err) {
    handleError(err, next, res);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Некорректный идентификатор уведомления' });
    }
    const notification = await prisma.notification.findUnique({
      where: { id },
      include: baseNotificationInclude,
    });
    if (!notification) {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }
    res.json(presentNotification(notification));
  } catch (err) {
    handleError(err, next, res);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const payload = extractNotificationPayload(req.body);
    const audiences = await normalizeAudiencesInput(payload.audiences, { required: true });

    const notification = await prisma.notification.create({
      data: {
        title: payload.title,
        message: payload.message,
        status: payload.status,
        startsAt: payload.startsAt ?? null,
        expiresAt: payload.expiresAt ?? null,
        createdById: req.user.id,
        audiences: {
          create: audiences,
        },
      },
      include: baseNotificationInclude,
    });

    res.status(201).json(presentNotification(notification));
    emitNotificationChange('notification-created', notification.id);
  } catch (err) {
    handleError(err, next, res);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Некорректный идентификатор уведомления' });
    }
    const payload = extractNotificationPayload(req.body, {
      allowMissingStatus: true,
      requireTitle: false,
      requireMessage: false,
    });
    const audiences = await normalizeAudiencesInput(payload.audiences, { required: false });

    const result = await prisma.$transaction(async tx => {
      const data = {};
      if (payload.title !== undefined) data.title = payload.title;
      if (payload.message !== undefined) data.message = payload.message;
      if (payload.status !== undefined) data.status = payload.status;
      if (payload.startsAt !== undefined) data.startsAt = payload.startsAt;
      if (payload.expiresAt !== undefined) data.expiresAt = payload.expiresAt;

      if (!Object.keys(data).length && audiences === null) {
        throw validationError('Нет данных для обновления');
      }

      await tx.notification.update({
        where: { id },
        data,
        include: baseNotificationInclude,
      });

      if (audiences) {
        await tx.notificationAudience.deleteMany({ where: { notificationId: id } });
        await tx.notificationAudience.createMany({
          data: audiences.map(a => ({
            ...a,
            notificationId: id,
          })),
        });
      }

      return tx.notification.findUnique({
        where: { id },
        include: baseNotificationInclude,
      });
    });

    if (!result) {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }

    res.json(presentNotification(result));
    emitNotificationChange('notification-updated', id);
  } catch (err) {
    handleError(err, next, res);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Некорректный идентификатор уведомления' });
    }
    const status = normalizeStatus(req.body.status, null);
    const notification = await prisma.notification.update({
      where: { id },
      data: { status },
      include: baseNotificationInclude,
    });
    res.json(presentNotification(notification));
    emitNotificationChange('notification-updated', id);
  } catch (err) {
    handleError(err, next, res);
  }
});

router.get('/:id/reads', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Некорректный идентификатор уведомления' });
    }

    const exists = await prisma.notification.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }

    const reads = await prisma.notificationRead.findMany({
      where: { notificationId: id },
      orderBy: { readAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            login: true,
            fullName: true,
            role: true,
          },
        },
      },
    });

    res.json({
      count: reads.length,
      items: reads,
    });
  } catch (err) {
    handleError(err, next, res);
  }
});

export default router;

function presentNotification(notification, now = new Date()) {
  if (!notification) return null;
  const { _count, ...rest } = notification;
  return {
    ...rest,
    readCount: _count?.reads ?? 0,
    state: computeNotificationState(rest, now),
  };
}

function clampNumber(value, fallback, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function buildListWhere(query, now) {
  const where = {};
  const and = [];

  if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => ALLOWED_STATUSES.includes(s));
    if (statuses.length) {
      where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
    }
  }

  if (query.q) {
    and.push({
      OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        { message: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

  if (query.state) {
    const state = String(query.state).toLowerCase();
    switch (state) {
      case 'active':
        and.push({ status: 'PUBLISHED' });
        and.push({
          OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        });
        and.push({
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        });
        break;
      case 'scheduled':
        and.push({ status: 'PUBLISHED' });
        and.push({ startsAt: { gt: now } });
        break;
      case 'expired':
        and.push({ status: 'PUBLISHED' });
        and.push({ expiresAt: { lte: now } });
        break;
      default:
        break;
    }
  }

  if (and.length) {
    where.AND = and;
  }
  return where;
}

function extractNotificationPayload(
  body = {},
  {
    requireTitle = true,
    requireMessage = true,
    allowMissingStatus = false,
  } = {}
) {
  const errors = [];
  const payload = {};

  if (body.title === undefined) {
    if (requireTitle) errors.push('title обязателен');
  } else if (typeof body.title !== 'string' || !body.title.trim()) {
    errors.push('title обязателен');
  } else {
    payload.title = body.title.trim();
  }

  if (body.message === undefined) {
    if (requireMessage) errors.push('message обязателен');
  } else if (typeof body.message !== 'string' || !body.message.trim()) {
    errors.push('message обязателен');
  } else {
    payload.message = body.message.trim();
  }

  if (!allowMissingStatus || body.status !== undefined) {
    try {
      payload.status = normalizeStatus(body.status, 'DRAFT');
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'startsAt')) {
    try {
      payload.startsAt = parseDateField(body.startsAt);
    } catch (err) {
      errors.push(err.message);
    }
  } else {
    payload.startsAt = undefined;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    try {
      payload.expiresAt = parseDateField(body.expiresAt);
    } catch (err) {
      errors.push(err.message);
    }
  } else {
    payload.expiresAt = undefined;
  }

  if (
    payload.startsAt !== undefined &&
    payload.expiresAt !== undefined &&
    payload.startsAt &&
    payload.expiresAt &&
    payload.startsAt >= payload.expiresAt
  ) {
    errors.push('expiresAt должен быть позже startsAt');
  }

  payload.audiences = body.audiences;

  if (errors.length) {
    throw validationError(errors.join('; '));
  }

  return payload;
}

function normalizeStatus(status, fallback = 'DRAFT') {
  const value = (status ?? fallback);
  if (value === null || value === undefined) {
    throw validationError('status обязателен');
  }
  const normalized = String(value).toUpperCase();
  if (!ALLOWED_STATUSES.includes(normalized)) {
    throw validationError(`Недопустимый статус: ${status}`);
  }
  return normalized;
}

function parseDateField(value) {
  if (value === null || value === '' || value === undefined) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    throw validationError('Некорректный формат даты');
  }
  return dt;
}

async function normalizeAudiencesInput(audiences, { required } = { required: false }) {
  if (audiences === undefined) {
    if (required) {
      throw validationError('Нужно указать хотя бы одну аудиторию');
    }
    return null;
  }
  if (!Array.isArray(audiences) || !audiences.length) {
    throw validationError('Нужно указать хотя бы одну аудиторию');
  }

  const dedupe = new Set();
  const normalized = [];
  const userIds = new Set();

  for (const raw of audiences) {
    if (!raw || typeof raw !== 'object') {
      throw validationError('Некорректная структура аудитории');
    }
    const type = String(raw.type || '').toUpperCase();
    if (!ALLOWED_AUDIENCE_TYPES.includes(type)) {
      throw validationError(`Недопустимый тип аудитории: ${raw.type}`);
    }

    let role = null;
    let userId = null;

    if (type === 'ROLE') {
      role = String(raw.role || '').toUpperCase();
      if (!ALLOWED_ROLES.includes(role)) {
        throw validationError(`Недопустимая роль: ${raw.role}`);
      }
    }
    if (type === 'USER') {
      userId = Number(raw.userId);
      if (!Number.isInteger(userId) || userId < 1) {
        throw validationError('userId должен быть положительным целым числом');
      }
      userIds.add(userId);
    }

    const key = `${type}:${role ?? ''}:${userId ?? ''}`;
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    normalized.push({ type, role, userId });
  }

  if (!normalized.length) {
    throw validationError('После очистки не осталось ни одной аудитории');
  }

  if (userIds.size) {
    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true },
    });
    if (users.length !== userIds.size) {
      const existing = new Set(users.map(u => u.id));
      const missing = Array.from(userIds).filter(id => !existing.has(id));
      throw validationError(`Не найдены пользователи: ${missing.join(', ')}`);
    }
  }

  return normalized;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function handleError(err, next, res) {
  if (err?.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Уведомление не найдено' });
  }
  return next(err);
}

function emitNotificationChange(type, notificationId) {
  notificationEvents.emit('event', {
    type,
    data: { notificationId },
  });
}
