// src/utils/orderLog.js
import prisma from './prisma.js';

export const OrderLogAction = {
  CREATED: 'CREATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ITEM_UPDATED: 'ITEM_UPDATED',
  ITEM_REMOVED: 'ITEM_REMOVED',
  RETURNED_TO_CART: 'RETURNED_TO_CART',
  ORDER_DELETED: 'ORDER_DELETED',
};

export const OrderLogSource = {
  SITE: 'SITE',
  ADMIN_PANEL: 'ADMIN_PANEL',
  MOBILE_AGENT: 'MOBILE_AGENT',
};

export function detectOrderLogSource(role) {
  return role === 'USER' ? OrderLogSource.SITE : OrderLogSource.ADMIN_PANEL;
}

export function getOrderActorRole(role) {
  if (!role) return null;
  if (['ADMIN', 'AGENT', 'MANAGER', 'USER'].includes(role)) return role;
  return null;
}

export async function createOrderLogEntry(params, client = prisma) {
  const {
    orderId,
    action,
    source,
    actorId = null,
    actorRole = null,
    meta = null,
  } = params || {};

  if (!orderId) throw new Error('orderId is required to create order log entry');
  if (!action) throw new Error('action is required to create order log entry');
  if (!source) throw new Error('source is required to create order log entry');

  return client.orderLog.create({
    data: {
      orderId,
      action,
      source,
      actorId: actorId ?? undefined,
      actorRole: actorRole ?? undefined,
      meta: meta ?? undefined,
    },
    include: {
      actor: { select: { id: true, login: true, fullName: true, role: true } },
    },
  });
}
