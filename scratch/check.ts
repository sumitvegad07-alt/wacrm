import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: profile } = await supabase.from('profiles').select('account_id').eq('email', 'femcarevegad@gmail.com').single();
  if (profile) {
    const { data: roles } = await supabase.from('employee_roles').select('*').eq('account_id', profile.account_id);
    console.log('Roles:', roles);
  }
}
main();
