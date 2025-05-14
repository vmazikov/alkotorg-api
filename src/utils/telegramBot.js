// src/utils/telegramBot.js
import TelegramBot from 'node-telegram-bot-api';
import prisma      from './prisma.js';
import bcrypt      from 'bcrypt';

// Убедитесь, что в .env есть TELEGRAM_BOT_TOKEN вида 123456:ABC-DEF...
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN не задан в env');
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Главное меню с inline-кнопками
const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🔗 Привязаться', callback_data: 'BIND' },
        { text: '❌ Отвязаться',   callback_data: 'UNBIND' }
      ],
      [
        { text: 'ℹ️ Помощь', callback_data: 'HELP' }
      ]
    ]
  }
};

// /start — показываем меню
bot.onText(/\/start/, msg => {
  bot.sendMessage(
    msg.chat.id,
    `Привет, ${msg.from.first_name}!\nЯ — бот уведомлений о заказах.\n\n` +
    `Нажми кнопку ниже, чтобы привязать аккаунт или получить помощь.`,
    mainMenu
  );
});

// /help — справка
bot.onText(/\/help/, msg => {
  bot.sendMessage(
    msg.chat.id,
    `Команды бота:\n` +
    `/start — главное меню\n` +
    `/help  — показать эту справку\n\n` +
    `Или используй кнопки:\n` +
    `🔗 Привязаться — авторизация агента\n` +
    `❌ Отвязаться  — отключить уведомления`,
    { reply_markup: { remove_keyboard: true } }
  );
});

// Inline-кнопки
bot.on('callback_query', async query => {
  const chatId = query.message.chat.id;
  const data   = query.data;

  if (data === 'HELP') {
    // Как /help, но в HTML
    return bot.sendMessage(
      chatId,
      `Команды бота:\n` +
      `/start — главное меню\n` +
      `/help  — эта справка\n\n` +
      `Чтобы привязаться, нажмите 🔗 «Привязаться» и отправьте:\n` +
      `<code>login:пароль</code>\n\n` +
      `Или используйте команду /bind login пароль`,
      { parse_mode: 'HTML', reply_markup: mainMenu }
    );
  }

  if (data === 'UNBIND') {
    // Отвязка
    try {
      const user = await prisma.user.findUnique({
        where: { telegramId: String(chatId) }
      });
      if (!user) {
        return bot.sendMessage(
          chatId,
          'ℹ️ Вы ещё не привязаны.',
          mainMenu
        );
      }
      await prisma.user.update({
        where: { id: user.id },
        data:  { telegramId: null }
      });
      return bot.sendMessage(
        chatId,
        '✅ Успешно отвязано, уведомления выключены.',
        mainMenu
      );
    } catch (e) {
      console.error('Error unbinding:', e);
      return bot.sendMessage(
        chatId,
        '❌ Не удалось отвязаться. Попробуйте позже.',
        mainMenu
      );
    }
  }

  if (data === 'BIND') {
    // Просим ввести login:пароль
    return bot.sendMessage(
      chatId,
      'Для привязки отправьте в чат ваш логин и пароль в формате:\n' +
      `<code>login:пароль</code>`,
      { parse_mode: 'HTML', reply_markup: mainMenu }
    );
  }
});

// Обработка текстовых сообщений — пробуем распарсить login:пароль
bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();

  // Игнорируем команды и пустые
  if (!text || text.startsWith('/')) return;

  // Пытаемся разделить по двоеточию
  const [login, pass] = text.split(':', 2);
  if (!login || !pass) {
    return bot.sendMessage(
      chatId,
      '❌ Неверный формат. Используйте:<code>login:пароль</code>',
      { parse_mode: 'HTML', reply_markup: mainMenu }
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { login }
    });
    if (!user || user.role !== 'AGENT') {
      return bot.sendMessage(
        chatId,
        '❌ Пользователь не найден или не является агентом.',
        mainMenu
      );
    }
    const ok = await bcrypt.compare(pass, user.passwordHash);
    if (!ok) {
      return bot.sendMessage(
        chatId,
        '❌ Неверный пароль.',
        mainMenu
      );
    }
    await prisma.user.update({
      where: { id: user.id },
      data:  { telegramId: String(chatId) }
    });
    return bot.sendMessage(
      chatId,
      '✅ Успешно привязано! Теперь вы будете получать уведомления.',
      mainMenu
    );
  } catch (e) {
    console.error('Error binding:', e);
    return bot.sendMessage(
      chatId,
      '❌ Ошибка сервера. Попробуйте позже.',
      mainMenu
    );
  }
});

export default bot;
