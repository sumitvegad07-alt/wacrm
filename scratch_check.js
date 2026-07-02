const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  const { data: convs } = await supabase.from('conversations').select('id, bot_status, contact_id');
  console.log('Conversations:', convs);
  const { data: settings } = await supabase.from('bot_settings').select('*');
  console.log('Bot Settings:', settings);
}
test();
