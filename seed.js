// seed.js
import bcrypt from 'bcrypt'
import prisma from './src/utils/prisma.js'

async function main() {
  const login = 'admin'
  const plain = 'admin123'
  const phone = '1234567890'

  const passwordHash = await bcrypt.hash(plain, 10)

  const user = await prisma.user.upsert({
    where: { phone },
    update: {
      login,
      passwordHash,
      role: 'ADMIN',
    },
    create: {
      login,
      passwordHash,
      phone,
      role: 'ADMIN',
    },
  })

  console.log('Admin user:', user.login, '– credentials:', plain)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
