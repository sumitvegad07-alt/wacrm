import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const sql = \
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
  \;
  const { data, error } = await supabase.rpc('execute_sql', { query: sql });
  if (error) {
     console.error('RPC failed, trying query directly? Supabase JS has no generic query. Error:', error);
  } else {
     console.log('Success:', data);
  }
}
main();
