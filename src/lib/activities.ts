import { SupabaseClient } from '@supabase/supabase-js';

export async function logModuleActivity(
  supabase: SupabaseClient,
  params: {
    moduleName: string;
    recordId: string;
    action: string;
    message?: string;
    details?: Record<string, any>;
  }
) {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return false;
    
    // Try to get account_id
    const { data: accountData } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', userData.user.id)
      .single();
      
    const { error } = await supabase.from('module_activities').insert([{
      account_id: accountData?.account_id || null,
      user_id: userData.user.id,
      module_name: params.moduleName,
      record_id: params.recordId,
      action: params.action,
      message: params.message || null,
      details: params.details || {}
    }]);

    if (error) {
      console.error('Failed to log module activity:', error.message, error.code, error.details);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception logging module activity:', err);
    return false;
  }
}
