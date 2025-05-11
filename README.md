# Alkotorg API

Node.js (Express) + PostgreSQL + Prisma.

## Запуск

1. Создай БД `alkotorg` в PostgreSQL.
2. Скопируй `.env.example` → `.env` и поправь креды.
3. Установи зависимости:

```bash
npm install
npx prisma migrate dev --name init
npm run dev
```

API появится на **localhost:4000**  
Swagger — **/api-docs**

### Тесты

```bash
npm test
```

## Telegram

Переменные в `.env`:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```
— `CHAT_ID` можно узнать у [@userinfobot](https://t.me/userinfobot).

##
