import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTests() {
  console.log("=== CREATING TEST DATA ===");
  const accountId = '868df324-df3c-4144-8c88-f58c73d9eeb0';

  // We need 3 products
  const { data: pA } = await supabase.from('products').insert({ account_id: accountId, name: 'Product A - Test', category: 'TestCat', base_price: 200, tax_rate: 0 }).select().single();
  const { data: pB } = await supabase.from('products').insert({ account_id: accountId, name: 'Product B - Test', category: 'TestCat', base_price: 800, tax_rate: 0 }).select().single();
  const { data: pC } = await supabase.from('products').insert({ account_id: accountId, name: 'Product C - Test', category: 'TestCat', base_price: 500, tax_rate: 0 }).select().single();

  // We need a customer
  const { data: cData } = await supabase.from('contacts').select('id').limit(1);
  const contactId = cData![0].id;

  // Order A = 1000
  const { data: ordA } = await supabase.from('orders').insert({
    account_id: accountId, contact_id: contactId, status: 'completed',
    sub_total: 1000, total_amount: 1000, date: new Date().toISOString()
  }).select().single();

  await supabase.from('order_items').insert([
    { order_id: ordA!.id, product_id: pA!.id, quantity: 1, price: 200, sub_total: 200, total: 200 },
    { order_id: ordA!.id, product_id: pB!.id, quantity: 1, price: 800, sub_total: 800, total: 800 }
  ]);

  // Order B = 1000
  const { data: ordB } = await supabase.from('orders').insert({
    account_id: accountId, contact_id: contactId, status: 'completed',
    sub_total: 1000, total_amount: 1000, date: new Date().toISOString()
  }).select().single();

  await supabase.from('order_items').insert([
    { order_id: ordB!.id, product_id: pA!.id, quantity: 1, price: 500, sub_total: 500, total: 500 },
    { order_id: ordB!.id, product_id: pC!.id, quantity: 1, price: 500, sub_total: 500, total: 500 }
  ]);

  console.log("Data Created!");

  // Test 1: No product join (Orders only)
  const { data: noJoin } = await supabase.from('orders')
    .select('id, total_amount')
    .in('id', [ordA!.id, ordB!.id]);
  const order_count = noJoin?.length || 0;
  const net_order_amount = noJoin?.reduce((a, r) => a + r.total_amount, 0) || 0;
  console.log("\n--- No product join (Orders only) ---");
  console.table([{ order_count, net_order_amount }]);

  // Test 2: Product A filter (using manual filter for simulation)
  const { data: oiA } = await supabase.from('order_items').select('order_id, total').in('order_id', [ordA!.id, ordB!.id]).eq('product_id', pA!.id);
  const matchedOrderIds = oiA?.map(i => i.order_id) || [];
  const { data: filteredOrders } = await supabase.from('orders').select('id, total_amount').in('id', matchedOrderIds);
  const f_order_count = filteredOrders?.length || 0;
  const f_net_order_amount = filteredOrders?.reduce((a, r) => a + r.total_amount, 0) || 0;
  const product_revenue = oiA?.reduce((a, r) => a + r.total, 0) || 0;
  console.log("\n--- Product A filter ---");
  console.table([{ order_count: f_order_count, net_order_amount: f_net_order_amount, product_revenue }]);

  // Test 3: Product grouping
  const { data: oiAll } = await supabase.from('order_items').select('total, products!inner(name)').in('order_id', [ordA!.id, ordB!.id]);
  const grouped = oiAll?.reduce((acc: any, row: any) => {
    const p = row.products.name;
    acc[p] = (acc[p] || 0) + row.total;
    return acc;
  }, {});
  console.log("\n--- Product grouping ---");
  console.table(Object.keys(grouped || {}).map(k => ({ product: k, product_revenue: grouped[k] })));

  // Cleanup
  await supabase.from('orders').delete().in('id', [ordA!.id, ordB!.id]);
  await supabase.from('products').delete().in('id', [pA!.id, pB!.id, pC!.id]);
  console.log("\nCleanup Done.");
}

runTests().catch(console.error);
