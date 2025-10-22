// src/utils/teleg.js
import bot from './telegramBot.js';

const tlog = (...a) => console.log('[telegram]', ...a);

/**
 * Безопасное уведомление агента.
 * Никогда не бросает наружу — ошибки логируются и подавляются.
 */
export async function notifyAgent(telegramId, message) {
  try {
    if (!telegramId || !message || !bot || typeof bot.sendMessage !== 'function') {
      return; // без бота или id — просто выходим
    }
    // форсим строку и HTML
    await bot.sendMessage(String(telegramId), message, { parse_mode: 'HTML' });
  } catch (e) {
    tlog('notifyAgent failed:', e?.code || e?.message || e);
    // намеренно не rethrow
  }
}
