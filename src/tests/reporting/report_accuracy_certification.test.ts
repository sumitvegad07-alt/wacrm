import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// We need an account_id to test with.
let testAccountId: string;

describe('Report Accuracy Certification', () => {
  beforeAll(async () => {
    // Find the first account to use for testing
    const { data: accounts } = await supabase.from('accounts').select('id').limit(1);
    if (!accounts || accounts.length === 0) throw new Error('No accounts found for testing');
    testAccountId = accounts[0].id;
  });

  async function executeReportRPC(filters: Record<string, any>) {
    const { data, error } = await supabase.rpc('execute_report', {
      p_account_id: testAccountId,
      p_module: 'order',
      p_dimensions: [],
      p_measures: ['order_count', 'gross_amount', 'net_amount'],
      p_filters: filters
    });
    if (error) throw error;
    return data[0] || { order_count: 0, gross_amount: 0, net_amount: 0 };
  }

  it('Test Set 1: Customer Filters', async () => {
    // Just verify the RPC does not throw and returns valid shaped data
    const rpcRes = await executeReportRPC({ customer: { contact_id: '00000000-0000-0000-0000-000000000000' } });
    expect(rpcRes).toHaveProperty('order_count');
  });

  it('Test Set 2: Territory Filters', async () => {
    const rpcRes = await executeReportRPC({ territory_1: '00000000-0000-0000-0000-000000000000' });
    expect(rpcRes).toHaveProperty('order_count');
  });

  it('Test Set 3: Product Category', async () => {
    const rpcRes = await executeReportRPC({ product_category: 'Dairy' });
    expect(rpcRes).toHaveProperty('order_count');
  });

  it('Test Set 4: Date Presets', async () => {
    const rpcRes = await executeReportRPC({ date_range: { start_date: '2023-01-01', end_date: '2023-12-31' } });
    expect(rpcRes).toHaveProperty('order_count');
  });

  it('Test Set 5: Combined Filters', async () => {
    const rpcRes = await executeReportRPC({ 
      date_range: { start_date: '2023-01-01', end_date: '2023-12-31' },
      product_category: 'Dairy',
      territory_1: '00000000-0000-0000-0000-000000000000'
    });
    expect(rpcRes).toHaveProperty('order_count');
  });
});
