import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

const bot = token ? new TelegramBot(token, { polling: false }) : null;

export async function sendOrderTelegram(order) {
  if (!bot) return;
  const lines = [
    `🆕 *Новый заказ* #${order.id}`,
    `Магазин: ${order.storeId}`,
    `Дата: ${new Date(order.createdAt).toLocaleString('ru')}`,
    `Состав:`,
    ...order.items.map((i) => `• ${i.quantity} × ${i.productId} по ${i.price}₽`),
    `*Итого:* ${order.total}₽`,
  ];
  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
}
