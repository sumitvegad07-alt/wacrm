import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: profilesData, error: profilesErr } = await supabase.rpc('execute_sql', { sql: 'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ''profiles'';' });
  if (profilesErr) console.log('Profiles Err:', profilesErr.message);
  else console.log('Profiles columns:', profilesData);

  const { data: devicesData, error: devicesErr } = await supabase.rpc('execute_sql', { sql: 'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ''employee_devices'';' });
  if (devicesErr) console.log('Devices Err:', devicesErr.message);
  else console.log('Devices columns:', devicesData);
}
main();
