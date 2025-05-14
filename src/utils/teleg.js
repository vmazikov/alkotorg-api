// src/utils/teleg.js
import bot from './telegramBot.js';

export function notifyAgent(telegramId, message) {
  // telegramId — строка chat.id
  return bot.sendMessage(telegramId, message, { parse_mode: 'HTML' });
}