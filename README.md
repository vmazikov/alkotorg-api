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

## GenAPI

Для функции удаления фона добавь в `.env`:
```
GEN_API_TOKEN=<токен от gen-api.ru>
# GEN_API_IMPLEMENTATION=modnet   # опционально, slug реализации
# GEN_API_POLL_INTERVAL_MS=2000   # опционально, интервал лонг-пула
# GEN_API_POLL_TIMEOUT_MS=60000   # опционально, таймаут ожидания
```

##
