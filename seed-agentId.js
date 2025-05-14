// prisma/scripts/seed-agentId.js
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Предполагаем, что userId в Store до этого был идентификатором агента
  await prisma.$executeRaw`
    UPDATE "Store"
    SET "agentId" = "userId"
    WHERE "agentId" IS NULL
  `
  console.log('✓ Поле agentId для всех старых магазинов заполнено')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
