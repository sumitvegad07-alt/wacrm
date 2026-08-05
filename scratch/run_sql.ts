import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const sql = "ALTER TABLE employee_devices ADD COLUMN IF NOT EXISTS application_version TEXT, ADD COLUMN IF NOT EXISTS database_version TEXT;";
  const { data, error } = await supabase.rpc('execute_sql', { sql });
  console.log('Result:', data, error);
}
main();
