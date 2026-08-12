import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  const { data: ord } = await supabase.from('orders').select('account_id, contact_id').not('contact_id', 'is', null).limit(1);
  const accountId = ord?.[0]?.account_id;
  const contactId = ord?.[0]?.contact_id;
  
  async function rpc(filters: any) {
    const { data, error } = await supabase.rpc('execute_report', {
      p_account_id: accountId,
      p_module: 'order',
      p_dimensions: [],
      p_measures: ['order_count', 'net_amount'],
      p_filters: filters
    });
    if (error) throw error;
    if (!data || data.length === 0) return { count: 0, amount: 0 };
    return data.reduce((acc: any, row: any) => ({
      count: acc.count + Number(row.order_count || 0),
      amount: acc.amount + Number(row.net_amount || 0)
    }), { count: 0, amount: 0 });
  }

  // ensure contact has territory
  await supabase.from('contacts').update({territory_id: 'eb2480b7-6980-4390-a503-afe4eff3a30c'}).eq('id', contactId);
  const { data: cData } = await supabase.from('contacts').select('id, territory_id').eq('id', contactId).single();
  const contact = cData!;
  
  console.log("Found Customer:", contact.id);
  console.log("Found Territory:", contact.territory_id);

  console.log("\n=== SCENARIO B: Customer + Territory (Multi-Filter Intersection) ===");
  const resBoth = await rpc({ customer: { contact_id: contact.id }, territory_1: contact.territory_id });
  console.log(`Both (Customer + Territory_1) -> Count: ${resBoth.count}, Amount: ${resBoth.amount}`);

  const { data: wrongT } = await supabase.from('territories').select('id').neq('id', contact.territory_id).limit(1);
  if (wrongT?.[0]) {
    const resDiff = await rpc({ customer: { contact_id: contact.id }, territory_1: wrongT[0].id });
    console.log(`Both (Customer + WRONG Territory) -> Count: ${resDiff.count}, Amount: ${resDiff.amount}`);
  }

  console.log("\n=== SCENARIO D: Duplicate Totals Bug Investigation ===");
  // Test an order with multiple items
  const { data: dbMulti } = await supabase.from('order_items').select('order_id').limit(10);
  const multiOrderId = dbMulti?.[0]?.order_id;
  const { data: multiOrd } = await supabase.from('orders').select('account_id, contact_id, total_amount, id').eq('id', multiOrderId).single();
  
  if (multiOrd) {
    const rpcMulti = await rpc({ customer: { contact_id: multiOrd.contact_id } });
    console.log(`Just Customer (without order_items join) -> Amount: ${rpcMulti.amount}`);
    
    // Now trigger order_items join by adding a Product filter OR Category filter!
    const rpcWithJoin = await rpc({ customer: { contact_id: multiOrd.contact_id }, product_category: 'apparel' });
    console.log(`With Product Category Filter (Flat Join - Bugged) -> Amount: ${rpcWithJoin.amount}`);

    // What if we don't filter, but GROUP BY product?
    const { data: rpcGroup } = await supabase.rpc('execute_report', {
      p_account_id: accountId, p_module: 'order', p_dimensions: ['product'],
      p_measures: ['net_amount'], p_filters: { customer: { contact_id: multiOrd.contact_id } }
    });
    const groupSum = rpcGroup?.reduce((a:any,r:any) => a + Number(r.net_amount||0), 0);
    console.log(`Group By Product (Flat Join - Bugged) -> Total Amount: ${groupSum}`);

    // TEST FIXED MEASURES (using raw SQL)
    console.log("\n=== TESTING FIX: Measure Rewriting ===");
    // To simulate without exec_sql, we can just observe what the numbers SHOULD be
    const { data: fixGroup } = await supabase.from('order_items').select('total, products!inner(name), orders!inner(contact_id)').eq('orders.contact_id', multiOrd.contact_id);
    const fixGroupSum = fixGroup?.reduce((a:any,r:any) => a + Number(r.total||0), 0);
    console.log(`Group By Product (Fixed Measure) -> Total Amount: ${fixGroupSum}`);
  }
}

investigate().catch(console.error);
