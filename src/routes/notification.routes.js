// src/routes/notification.routes.js
import { Router } from 'express';

import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middlewares/auth.js';
import {
  audienceMatchesUser,
  buildActiveNotificationWhere,
  computeNotificationState,
} from '../utils/notificationHelpers.js';
import notificationEvents from '../utils/notificationEvents.js';

const router = Router();
router.use(authMiddleware);

const notificationSelect = {
  id: true,
  title: true,
  message: true,
  status: true,
  startsAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
};

const HEARTBEAT_INTERVAL = 30_000;

router.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const send = (event, data = {}) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('connected', { ok: true });

  const handler = payload => {
    const data = payload.data || {};
    if (payload.type === 'notification-read' && data.userId !== req.user.id) {
      return;
    }
    send(payload.type, data);
  };

  notificationEvents.on('event', handler);

  const heartbeat = setInterval(() => {
    send('ping', { ts: Date.now() });
  }, HEARTBEAT_INTERVAL);

  req.on('close', () => {
    clearInterval(heartbeat);
    notificationEvents.off('event', handler);
    res.end();
  });
});

router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const includeRead =
      typeof req.query.includeRead === 'string'
        ? req.query.includeRead.toLowerCase() === 'true'
        : Boolean(req.query.includeRead);

    const notifications = await prisma.notification.findMany({
      where: buildActiveNotificationWhere(req.user, now, { includeRead }),
      orderBy: [
        { startsAt: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        ...notificationSelect,
        audiences: {
          select: {
            id: true,
            type: true,
            role: true,
            userId: true,
          },
          orderBy: { id: 'asc' },
        },
        reads: {
          where: { userId: req.user.id },
          select: {
            userId: true,
            readAt: true,
          },
        },
      },
    });

    res.json({
      count: notifications.length,
      items: notifications.map(n => ({
        ...n,
        readAt: n.reads[0]?.readAt ?? null,
        state: computeNotificationState(n, now),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const notificationId = Number(req.params.id);
    if (!Number.isInteger(notificationId) || notificationId < 1) {
      return res.status(400).json({ error: 'Некорректный идентификатор уведомления' });
    }

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: { audiences: true },
    });

    if (!notification || notification.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }

    const now = new Date();
    if (notification.startsAt && notification.startsAt > now) {
      return res.status(400).json({ error: 'Уведомление ещё не активно' });
    }
    if (notification.expiresAt && notification.expiresAt <= now) {
      return res.status(410).json({ error: 'Уведомление уже недействительно' });
    }
    if (!audienceMatchesUser(notification.audiences, req.user)) {
      return res.status(403).json({ error: 'Нет доступа к уведомлению' });
    }

    await prisma.notificationRead.upsert({
      where: {
        notificationId_userId: {
          notificationId,
          userId: req.user.id,
        },
      },
      update: { readAt: new Date() },
      create: {
        notificationId,
        userId: req.user.id,
      },
    });

    notificationEvents.emit('event', {
      type: 'notification-read',
      data: { notificationId, userId: req.user.id },
    });

    res.json({ read: true });
  } catch (err) {
    if (err?.code === 'P2002') {
      notificationEvents.emit('event', {
        type: 'notification-read',
        data: { notificationId: Number(req.params.id), userId: req.user.id },
      });
      return res.json({ read: true });
    }
    next(err);
  }
});

export default router;
