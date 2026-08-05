import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const accountId = '441dcfe9-2f27-4a0b-aeb8-755c91b1076b'; // Wait, I need the actual account_id. Let's get it from the user's profile.
  const { data: userProfile } = await supabase.from('profiles').select('account_id').eq('email', 'femcarevegad@gmail.com').single();
  if (!userProfile) {
    console.log('User not found');
    return;
  }
  const accId = userProfile.account_id;

  // Create Sections
  const sections = [
    { name: 'Profile', module_name: 'user', position: 1 },
    { name: 'Login Details', module_name: 'user', position: 2 },
    { name: 'Contact Details', module_name: 'user', position: 3 }
  ];

  for (const s of sections) {
    const { data } = await supabase.from('custom_field_sections')
      .upsert({ account_id: accId, module_name: s.module_name, name: s.name, position: s.position }, { onConflict: 'account_id, module_name, name' })
      .select('id').single();
    s['id'] = data.id;
  }

  // Create Fields
  const fields = [
    // Profile
    { section_id: sections[0].id, field_name: 'Full Name', field_type: 'text', position: 1, is_active: true, system_key: 'full_name' },
    { section_id: sections[0].id, field_name: 'Employee ID / Code', field_type: 'text', position: 2, is_active: true, system_key: 'employee_code' },
    { section_id: sections[0].id, field_name: 'Employee Role', field_type: 'dropdown', position: 3, is_active: true, system_key: 'employee_role_id' },
    { section_id: sections[0].id, field_name: 'Status', field_type: 'radio', position: 4, is_active: true, system_key: 'status' },
    // Login Details
    { section_id: sections[1].id, field_name: 'Email Address (Login ID)', field_type: 'email', position: 1, is_active: true, system_key: 'email' },
    { section_id: sections[1].id, field_name: 'Password', field_type: 'password', position: 2, is_active: true, system_key: 'password' },
    { section_id: sections[1].id, field_name: 'Re-Password', field_type: 'password', position: 3, is_active: true, system_key: 'repassword' },
    // Contact Details
    { section_id: sections[2].id, field_name: 'Address', field_type: 'textarea', position: 1, is_active: true, system_key: null },
    { section_id: sections[2].id, field_name: 'Pincode', field_type: 'text', position: 2, is_active: true, system_key: null },
    { section_id: sections[2].id, field_name: 'Country', field_type: 'text', position: 3, is_active: true, system_key: null },
    { section_id: sections[2].id, field_name: 'State', field_type: 'text', position: 4, is_active: true, system_key: null },
    { section_id: sections[2].id, field_name: 'City', field_type: 'text', position: 5, is_active: true, system_key: null },
    { section_id: sections[2].id, field_name: 'Area', field_type: 'text', position: 6, is_active: true, system_key: null },
    { section_id: sections[2].id, field_name: 'Contact number', field_type: 'tel', position: 7, is_active: true, system_key: 'mobile' }
  ];

  for (const f of fields) {
    await supabase.from('custom_fields')
      .upsert({ 
        account_id: accId, 
        module_name: 'user', 
        section_id: f.section_id,
        field_name: f.field_name, 
        field_type: f.field_type, 
        position: f.position,
        is_active: f.is_active,
        system_key: f.system_key
      }, { onConflict: 'account_id, module_name, field_name' });
  }
  
  console.log('Seeded successfully!');
}
main();
