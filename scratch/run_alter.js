require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const sql = "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES profiles(id) ON DELETE SET NULL;";
  const { data, error } = await supabase.rpc('execute_sql', { query: sql });
  if (error) {
     console.error('RPC failed:', error.message);
  } else {
     console.log('Success:', data);
  }
}
main();
