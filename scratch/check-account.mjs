import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function check() {
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('email', 'sumitvegad07@gmail.com')
    .single();

  if (profile) {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, name, customer_id, settings, created_at')
      .eq('id', profile.account_id)
      .single();
      
    console.log("Account Query Error:", error);
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log('Profile not found');
  }
}

check();
