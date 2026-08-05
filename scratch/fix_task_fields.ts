import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const accountId = '8bd02098-c473-4afd-9705-be344b0880c4'; // Admin account

  // Rename Primary Details to Schedule & Priority
  const { data: secData, error: secErr } = await supabase
    .from('custom_field_sections')
    .update({ name: 'Schedule & Priority' })
    .eq('account_id', accountId)
    .eq('module_name', 'task')
    .eq('name', 'Primary Details');
  console.log('Renamed section:', secErr);

  // Delete Title
  const { data: delData, error: delErr } = await supabase
    .from('custom_fields')
    .delete()
    .eq('account_id', accountId)
    .eq('module_name', 'task')
    .eq('system_key', 'title');
  console.log('Deleted title:', delErr);
}
main();
