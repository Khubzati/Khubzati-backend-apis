require('dotenv').config({ path: `${process.cwd()}/.env` });

// Extract database URL from Supabase URL
const dbUrl = process.env.VITE_SUPABASE_URL ? 
  `postgresql://postgres:${process.env.VITE_SUPABASE_ANON_KEY}@${process.env.VITE_SUPABASE_URL.replace('https://', '').replace('.supabase.co', '.supabase.co:6543')}/postgres?pgbouncer=true` :
  '';

// Direct connection URL for migrations
const directUrl = process.env.VITE_SUPABASE_URL ? 
  `postgresql://postgres:${process.env.VITE_SUPABASE_ANON_KEY}@${process.env.VITE_SUPABASE_URL.replace('https://', '').replace('.supabase.co', '.supabase.co:5432')}/postgres` :
  '';

module.exports = {
  dbUrl,
  directUrl,
  nodeEnv: process.env.NODE_ENV,
};