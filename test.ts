import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: profile } = await supabase.from('profiles').select('account_id').eq('email', 'femcarevegad@gmail.com').single();
  if (profile) {
    const { data: account } = await supabase.from('accounts').select('*').eq('id', profile.account_id).single();
    console.log(account);
  } else {
    console.log('No profile');
  }
}
main();
