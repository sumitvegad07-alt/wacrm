const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://gxurqwpfvfktmreqmzqb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4dXJxd3BmdmZrdG1yZXFtenFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MDcxNDMsImV4cCI6MjA5ODM4MzE0M30.pOsG7EmulCdDTQsScmI6wGR-ykO0OrNpkF2DVHV784Q';
const supabase = createClient(supabaseUrl, supabaseKey);

async function create() {
  const { data, error } = await supabase.auth.signUp({
    email: 'test@wacrm.com',
    password: 'password123',
  });
  console.log("Result:", JSON.stringify({ data, error }, null, 2));
}
create();
