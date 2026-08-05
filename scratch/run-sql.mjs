import { Client } from 'pg';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Parse Supabase Postgres connection string (from Supabase dashboard or usually we can construct it)
// Or use the Supabase DB URL if present
const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres'; // Assuming local if not defined? Wait, let's just log process.env to see what we have

async function run() {
  console.log(Object.keys(process.env));
}

run();
