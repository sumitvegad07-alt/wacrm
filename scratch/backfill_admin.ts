import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: profile } = await supabase.from('profiles').select('id, user_id, account_id').eq('email', 'femcarevegad@gmail.com').single();
  if (profile) {
    const account_id = profile.account_id;
    
    // Check if Admin exists
    let { data: adminRole } = await supabase.from('employee_roles').select('id').eq('account_id', account_id).eq('name', 'Admin').single();
    if (!adminRole) {
      console.log('Admin role not found, creating...');
      const { data: newRole, error } = await supabase.from('employee_roles').insert({
        account_id,
        name: 'Admin',
        description: 'Full administrative access',
        permissions: { all: true }
      }).select('id').single();
      if (error) console.error(error);
      adminRole = newRole;
    }

    if (adminRole) {
      console.log('Assigning Admin role to profile...', adminRole.id);
      await supabase.from('profiles').update({ employee_role_id: adminRole.id }).eq('id', profile.id);
      console.log('Done!');
    }
  }
}
main();
