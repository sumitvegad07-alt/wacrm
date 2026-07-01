'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { QuotationForm } from '@/components/quotations/quotation-form';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function EditQuotationPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const [initialData, setInitialData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadQuotation() {
      const { data, error } = await supabase
        .from('quotations')
        .select('*')
        .eq('id', params.id as string)
        .single();

      if (error || !data) {
        toast.error('Failed to load quotation');
        router.push('/quotations');
      } else {
        setInitialData(data);
      }
      setLoading(false);
    }
    loadQuotation();
  }, [params.id, router, supabase]);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!initialData) return null;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <QuotationForm 
        open={true} 
        onOpenChange={(o) => !o && router.push(`/quotations/${initialData.id}`)} 
        quotationId={initialData.id} 
        onSaved={() => router.push(`/quotations/${initialData.id}`)} 
      />
    </div>
  );
}
