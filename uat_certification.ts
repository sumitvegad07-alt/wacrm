import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runUAT() {
  const { data: accounts } = await supabase.from('orders').select('account_id').limit(1);
  if (!accounts || accounts.length === 0) return console.log("No test data found.");
  const accountId = accounts[0].account_id;

  async function rpc(filters: any, groupBy: string[] = []) {
    const { data, error } = await supabase.rpc('execute_report', {
      p_account_id: accountId,
      p_module: 'order',
      p_dimensions: groupBy,
      p_measures: ['order_count', 'gross_amount', 'net_amount', 'discount_amount', 'tax_amount'],
      p_filters: filters
    });
    if (error) throw error;
    if (!data || data.length === 0) return { count: 0, sub_total: 0, total_amount: 0, discount: 0, tax: 0 };
    return data.reduce((acc: any, row: any) => ({
      count: acc.count + Number(row.order_count || 0),
      sub_total: acc.sub_total + Number(row.gross_amount || 0),
      total_amount: acc.total_amount + Number(row.net_amount || 0),
      discount: acc.discount + Number(row.discount_amount || 0),
      tax: acc.tax + Number(row.tax_amount || 0)
    }), { count: 0, sub_total: 0, total_amount: 0, discount: 0, tax: 0 });
  }

  const results: any[] = [];
  function assertResult(scenario: string, report: any, sql: any) {
    const pass = report.count === sql.count && Math.abs(report.sub_total - sql.sub_total) < 0.1 && Math.abs(report.total_amount - sql.total_amount) < 0.1;
    results.push({ Scenario: scenario, RPCCount: report.count, SQLCount: sql.count, RPCAmount: report.total_amount, SQLAmount: sql.total_amount, Status: pass ? 'PASS' : 'FAIL' });
  }

  // UAT 1: No filter
  const allRPC = await rpc({});
  const { data: allSql } = await supabase.from('orders').select('sub_total, total_amount, discount_total, tax_total').eq('account_id', accountId);
  const sqlTotals = allSql?.reduce((a: any, o: any) => ({ count: a.count + 1, sub_total: a.sub_total + Number(o.sub_total||0), total_amount: a.total_amount + Number(o.total_amount||0) }), {count:0, sub_total:0, total_amount:0});
  assertResult('1. No Filter', allRPC, sqlTotals);

  // UAT 2: Customer Filter (Test 1 customer)
  const { data: custOrders } = await supabase.from('orders').select('contact_id').eq('account_id', accountId).limit(1);
  if (custOrders?.length) {
    const cid = custOrders[0].contact_id;
    const rep = await rpc({ customer: { contact_id: cid } });
    const { data: dbOrders } = await supabase.from('orders').select('sub_total, total_amount').eq('contact_id', cid);
    const sqlC = dbOrders?.reduce((a: any, o: any) => ({ count: a.count + 1, sub_total: a.sub_total + Number(o.sub_total||0), total_amount: a.total_amount + Number(o.total_amount||0) }), {count:0, sub_total:0, total_amount:0});
    assertResult('2. Customer Filter', rep, sqlC);
  }

  // UAT 7: Group By Validation
  const repGroup = await rpc({}, ['customer']);
  assertResult('7. Group By Customer (Totals)', repGroup, sqlTotals);

  console.table(results);
}
runUAT().catch(console.error);
