import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function check() {
  const { data, error } = await supabase.rpc('get_table_schema', { table_name: 'accounts' });
  if (error) {
    // try selecting all columns from one row
    const { data: row } = await supabase.from('accounts').select('*').limit(1).single();
    console.log(Object.keys(row || {}));
  } else {
    console.log(data);
  }
}

check();
