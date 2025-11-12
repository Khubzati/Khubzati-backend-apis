require('dotenv').config({ path: `${process.cwd()}/.env` });

// Construct database URL for Prisma
const dbUrl = process.env.VITE_SUPABASE_URL ?
  `postgresql://postgres:${process.env.VITE_SUPABASE_ANON_KEY}@${process.env.VITE_SUPABASE_URL.replace('https://', '').replace('.supabase.co', '.supabase.co:6543')}/postgres?pgbouncer=true` :
  process.env.DATABASE_URL;

// Set DATABASE_URL for Prisma if not already set
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = dbUrl;
}

module.exports = {
  dbHost: process.env.DB_HOST,
  dbName: process.env.DB_NAME,
  dbPassword: process.env.DB_PASSWORD,
  dbPort: process.env.DB_PORT,
  dbUsername: process.env.DB_USERNAME,
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: dbUrl,
};
