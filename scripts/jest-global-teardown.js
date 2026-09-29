module.exports = async () => {
  const prisma = require('../src/lib/prisma');
  await prisma.$disconnect();
};
