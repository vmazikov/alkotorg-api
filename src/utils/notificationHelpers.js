// src/utils/notificationHelpers.js
const ROLE_AUDIENCE_TYPES = ['GLOBAL', 'ROLE', 'USER'];

export function computeNotificationState(notification, now = new Date()) {
  if (!notification) return 'unknown';

  switch (notification.status) {
    case 'ARCHIVED':
      return 'archived';
    case 'DRAFT':
      return 'draft';
    case 'PUBLISHED': {
      const startsAt = notification.startsAt ? new Date(notification.startsAt) : null;
      const expiresAt = notification.expiresAt ? new Date(notification.expiresAt) : null;

      if (startsAt && startsAt > now) return 'scheduled';
      if (expiresAt && expiresAt <= now) return 'expired';
      return 'active';
    }
    default:
      return 'unknown';
  }
}

export function buildActiveNotificationWhere(user, now = new Date(), options = {}) {
  const { includeRead = false } = options;
  return {
    status: 'PUBLISHED',
    AND: [
      {
        OR: [
          { startsAt: null },
          { startsAt: { lte: now } },
        ],
      },
      {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      {
        audiences: {
          some: {
            OR: [
              { type: 'GLOBAL' },
              { type: 'ROLE', role: user.role },
              { type: 'USER', userId: user.id },
            ],
          },
        },
      },
      ...(!includeRead
        ? [{
            reads: {
              none: { userId: user.id },
            },
          }]
        : []),
    ],
  };
}

export function audienceMatchesUser(audiences = [], user) {
  if (!user || !audiences?.length) return false;
  return audiences.some(audience => {
    if (!audience) return false;
    if (!ROLE_AUDIENCE_TYPES.includes(audience.type)) {
      return false;
    }

    if (audience.type === 'GLOBAL') return true;
    if (audience.type === 'ROLE') return audience.role === user.role;
    if (audience.type === 'USER') return audience.userId === user.id;
    return false;
  });
}
