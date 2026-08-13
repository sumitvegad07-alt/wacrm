const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://gxurqwpfvfktmreqmzqb.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4dXJxd3BmdmZrdG1yZXFtenFiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjgwNzE0MywiZXhwIjoyMDk4MzgzMTQzfQ.oVpMN4kGJdVvyIQAr1wQE4xuVgOmzOiL0DyGBURrrJU');

async function test() {
  const { data, error } = await supabase.from('orders').select('status').not('status', 'is', null);
  const statuses = new Set(data.map(d => d.status));
  console.log('Statuses:', Array.from(statuses));
}
test();
