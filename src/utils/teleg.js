import TelegramBot from 'node-telegram-bot-api';
const bot = new TelegramBot(process.env.TG_TOKEN, { polling:false });

export function notifyAgent(agentTgId, text){
  if (!agentTgId) return;
  bot.sendMessage(agentTgId, text).catch(console.error);
}
