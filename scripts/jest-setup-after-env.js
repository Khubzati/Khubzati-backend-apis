// Every Jest test file receives an isolated module registry, so each file that
// imports the Prisma singleton owns a separate connection pool. Disconnect that
// pool when the file finishes instead of waiting for the worker process to exit.
afterAll(async () => {
  const prisma = require('../src/lib/prisma');
  await prisma.$disconnect();
});
