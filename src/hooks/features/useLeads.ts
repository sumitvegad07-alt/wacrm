import { useState } from 'react';
import { useApplication } from '../../components/providers/ApplicationProvider';
import { CreateLeadCommand } from '../../lib/application/services/leads/management/CreateLeadCommandHandler';
import { QualifyLeadCommand } from '../../lib/application/services/leads/lifecycle/QualifyLeadCommandHandler';
import { ConvertLeadCommand } from '../../lib/application/services/leads/lifecycle/ConvertLeadCommandHandler';
import { LeadUiDto } from '../../lib/presentation/dtos/LeadUiDto';
import { v4 as uuidv4 } from 'uuid';

export const useLeads = () => {
  const application = useApplication();
  
  const [leads, setLeads] = useState<LeadUiDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const create = async (name: string, email?: string, phone?: string) => {
    setIsLoading(true);
    const tempId = uuidv4();
    
    // Optimistic Update
    const optimisticLead = new LeadUiDto({
      id: tempId, name, email, phone, status: 'Prospect', isArchived: false, sync_status: 'pending' as const, sync_version: 1
    });
    setLeads(prev => [...prev, optimisticLead]);

    // This would actually be resolved from the CompositionRoot. 
    // Since we're partially stubbing the real CompositionRoot integration for this sprint:
    // const result = await application.createLeadHandler.execute(new CreateLeadCommand(tempId, name, email, phone));
    
    // Stubbing the result to demonstrate React flow
    const result = { isSuccess: true, error: null };
    
    if (!result.isSuccess) {
      setLeads(prev => prev.filter(l => l.id !== tempId)); // Rollback
    }
    
    setIsLoading(false);
    return result;
  };

  const qualify = async (id: string, newStatus: string) => {
    // ... optimistic status update ...
  };

  const convert = async (id: string) => {
    // Expected to fail until CRM-002
    // const result = await application.convertLeadHandler.execute(new ConvertLeadCommand(id));
    return { isSuccess: false, error: new Error('Lead conversion is temporarily disabled until the Accounts module is migrated.') };
  };

  return { leads, create, qualify, convert, isLoading };
};
