import { SupabaseClient } from '@supabase/supabase-js';

export async function logQuotationActivity(
  supabase: SupabaseClient,
  quotationId: string,
  action: string,
  details?: Record<string, any>
) {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return false;
    
    // We try to get account_id of the quotation
    const { data: qData } = await supabase.from('quotations').select('account_id').eq('id', quotationId).single();
    
    const { error } = await supabase.from('module_activities').insert([
      {
        account_id: qData?.account_id || null,
        user_id: userData.user.id,
        module_name: 'quotation',
        record_id: quotationId,
        action,
        details,
        message: null
      }
    ]);
    if (error) {
      console.error('Error logging quotation activity:', error.message, error.code, error.details);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error in logQuotationActivity:', err);
    return false;
  }
}
