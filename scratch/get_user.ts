import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await supabase.from('profiles').select('id, full_name, email, account_role').eq('account_id', '8bd02098-c473-4afd-9705-be344b0880c4');
  console.log('Profiles:', data);
}
main();
