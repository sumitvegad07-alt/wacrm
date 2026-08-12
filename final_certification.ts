import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { orderReportConfig } from './src/lib/reports/orderReportConfig';

dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function runProof() {
  const { data: acc } = await supabase.from('orders').select('account_id').limit(1);
  const accountId = acc?.[0]?.account_id;

  console.log("=== #5 RUNTIME DUMP OF GENERATED FILTER DEFINITIONS ===");
  const { data } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
  const s = data?.settings || {};
  const productLevelsCount = s.product_settings?.levels_count ?? 1; // FALLBACK TO 1
  const customerHierarchyEnabled = s.order_settings?.enabled ?? s.order_settings?.hierarchy_enabled ?? false;

  let baseFilters = orderReportConfig.filters.filter(f => f.type !== 'territory');
  
  const isFilterVisible = (filterDef: any) => {
    if (['sales_type', 'customer_type', 'user_role', 'hierarchy_level'].includes(filterDef.key)) {
      if (!customerHierarchyEnabled) return false;
    }
    if (filterDef.key === 'product_category' && (productLevelsCount === null || productLevelsCount < 1)) return false;
    if (filterDef.key === 'product_subcategory' && (productLevelsCount === null || productLevelsCount < 2)) return false;
    return true;
  };

  const visibleFilters = baseFilters.filter(isFilterVisible);
  console.log(`Product Levels Configured: ${productLevelsCount}`);
  console.log("Visible Product Filters:");
  visibleFilters.filter(f => f.section === 'PRODUCT').forEach(f => console.log(`  - [VISIBLE] ${f.label} (${f.key})`));
  const hiddenFilters = baseFilters.filter(f => !isFilterVisible(f));
  console.log("Hidden Product Filters:");
  hiddenFilters.filter(f => f.section === 'PRODUCT').forEach(f => console.log(`  - [HIDDEN] ${f.label} (${f.key})`));
  console.log("\n=======================================================\n");

  console.log("=== #4 EXPLANATION OF TOTALS AND #6 FINAL RECONCILIATION ===");
  const { data: dbOrders } = await supabase.from('orders').select('sub_total, total_amount').eq('account_id', accountId);
  const sumGross = dbOrders?.reduce((a, o) => a + Number(o.sub_total||0), 0) || 0;
  const sumNet = dbOrders?.reduce((a, o) => a + Number(o.total_amount||0), 0) || 0;
  console.log(`Database Raw 'sub_total' (Gross Amount): ${sumGross}`);
  console.log(`Database Raw 'total_amount' (Net Amount): ${sumNet}`);
  
  const { data: rpcData } = await supabase.rpc('execute_report', {
    p_account_id: accountId, p_module: 'order', p_dimensions: [], 
    p_measures: ['gross_amount', 'net_amount', 'order_count'], p_filters: {}
  });
  
  const rpcGross = Number(rpcData?.[0]?.gross_amount || 0);
  const rpcNet = Number(rpcData?.[0]?.net_amount || 0);
  console.log(`RPC Report 'gross_amount': ${rpcGross}`);
  console.log(`RPC Report 'net_amount': ${rpcNet}`);
  console.log("-------------------------------------------------------");
}

runProof().catch(console.error);
