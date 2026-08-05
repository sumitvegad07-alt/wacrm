import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: profile } = await supabase.from('profiles').select('id, full_name, status, email').eq('email', 'pratap@dhakan.com').single();
  console.log('Profile:', profile);
}
main();
