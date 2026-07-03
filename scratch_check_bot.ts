import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkStatus() {
  const { data: settings } = await supabase.from('bot_settings').select('*');
  console.log('Bot Settings:', settings);

  const { data: convs } = await supabase.from('conversations').select('id, contact_id, bot_status').order('updated_at', { ascending: false }).limit(5);
  console.log('Recent Conversations:', convs);

  const { data: messages } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(5);
  console.log('Recent Messages:', messages);
}

checkStatus().catch(console.error);
