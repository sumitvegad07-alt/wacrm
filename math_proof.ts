import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runMathProof() {
  const { data: accounts } = await supabase.from('orders').select('account_id').limit(1);
  if (!accounts || accounts.length === 0) {
    console.log("No orders found");
    return;
  }
  const accountId = accounts[0].account_id;

  const results: any[] = [];

  // Helper to run RPC
  async function runRPC(filters: any) {
    const { data, error } = await supabase.rpc('execute_report', {
      p_account_id: accountId,
      p_module: 'order',
      p_dimensions: [],
      p_measures: ['order_count', 'net_amount'],
      p_filters: filters
    });
    if (error) throw error;
    return {
      count: Number(data?.[0]?.order_count || 0),
      amount: Number(data?.[0]?.net_amount || 0)
    };
  }

  // We can't run raw SQL CTE via supabase-js easily, but we can simulate the CTE via REST by getting the territory ID, finding all its descendants, and then querying orders.
  async function getTerritoryDescendants(territoryId: string) {
    const descendants = [territoryId];
    // Simple fetch all territories and build tree
    const { data } = await supabase.from('territories').select('id, parent_id').eq('account_id', accountId);
    if (!data) return descendants;
    
    let toProcess = [territoryId];
    while (toProcess.length > 0) {
      const current = toProcess.pop();
      const children = data.filter(t => t.parent_id === current).map(t => t.id);
      descendants.push(...children);
      toProcess.push(...children);
    }
    return descendants;
  }

  async function runSQLTerritory(territoryId: string) {
    const ids = await getTerritoryDescendants(territoryId);
    
    const { data: contacts } = await supabase.from('contacts').select('id').in('territory_id', ids);
    const contactIds = contacts?.map(c => c.id) || [];
    
    if (contactIds.length === 0) return { count: 0, amount: 0 };
    
    const { data: orders } = await supabase.from('orders').select('total_amount').in('contact_id', contactIds);
    return {
      count: orders?.length || 0,
      amount: orders?.reduce((acc, o) => acc + Number(o.total_amount || 0), 0) || 0
    };
  }

  async function runSQLCustomer(contactId: string) {
    const { data: orders } = await supabase.from('orders').select('total_amount').eq('contact_id', contactId);
    return {
      count: orders?.length || 0,
      amount: orders?.reduce((acc, o) => acc + Number(o.total_amount || 0), 0) || 0
    };
  }
  
  async function runSQLProductCategory(category: string) {
    // Orders with items matching product category
    const { data: products } = await supabase.from('products').select('id').eq('category', category);
    const pids = products?.map(p => p.id) || [];
    if (pids.length === 0) return { count: 0, amount: 0 };
    
    const { data: items } = await supabase.from('order_items').select('order_id').in('product_id', pids);
    const orderIds = [...new Set(items?.map(i => i.order_id) || [])];
    if (orderIds.length === 0) return { count: 0, amount: 0 };
    
    const { data: orders } = await supabase.from('orders').select('total_amount').in('id', orderIds);
    return {
      count: orders?.length || 0,
      amount: orders?.reduce((acc, o) => acc + Number(o.total_amount || 0), 0) || 0
    };
  }

  // 1. Country (Territory 1)
  const { data: countryContacts } = await supabase.from('contacts').select('territory_id').not('territory_id', 'is', null).limit(10);
  let tid = countryContacts?.[0]?.territory_id;
  
  if (tid) {
    const rpc = await runRPC({ territory_1: tid });
    const sql = await runSQLTerritory(tid);
    results.push({ Filter: 'Territory', RPCCount: rpc.count, SQLCount: sql.count, RPCAmount: rpc.amount, SQLAmount: sql.amount });
  }

  // 4. Customer
  const { data: customerOrders } = await supabase.from('orders').select('contact_id').limit(1);
  if (customerOrders?.length) {
    const cid = customerOrders[0].contact_id;
    const rpc = await runRPC({ customer: { contact_id: cid } }); 
    const sql = await runSQLCustomer(cid);
    results.push({ Filter: 'Customer', RPCCount: rpc.count, SQLCount: sql.count, RPCAmount: rpc.amount, SQLAmount: sql.amount });
  }

  // 5. Product Category
  const { data: orderItems } = await supabase.from('order_items').select('product_id').limit(1);
  if (orderItems?.length) {
    const { data: pcat } = await supabase.from('products').select('category').eq('id', orderItems[0].product_id).limit(1);
    if (pcat?.length) {
      const cat = pcat[0].category;
      const rpc = await runRPC({ product_category: cat });
      const sql = await runSQLProductCategory(cat);
      results.push({ Filter: 'Product Category', RPCCount: rpc.count, SQLCount: sql.count, RPCAmount: rpc.amount, SQLAmount: sql.amount });
    }
  }

  console.table(results);
}

runMathProof().catch(console.error);
