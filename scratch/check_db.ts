import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: accounts } = await supabase.from('accounts').select('id, name');
  console.log('Accounts:', accounts);

  const { data: sections } = await supabase.from('custom_field_sections').select('*').eq('module_name', 'user');
  console.log('User Sections:', sections);

  const { data: fields, error } = await supabase.from('custom_fields').select('*').eq('module_name', 'user');
  if (error) console.error(error);
  console.log('User Fields Count:', fields?.length);
  if (fields?.length) console.log('First field:', fields[0]);
}
main();
