const prisma = require('../src/lib/prisma');
const {
  cleanupExpiredOnboardingUploads,
} = require('../src/services/onboardingUploadService');

async function main() {
  const results = await cleanupExpiredOnboardingUploads({ prisma });
  const cleaned = results.filter((result) => result.cleaned).length;
  const failed = results.length - cleaned;
  console.log(JSON.stringify({ examined: results.length, cleaned, failed }));
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
