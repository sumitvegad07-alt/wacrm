import { useState } from 'react';
import { useApplication } from '../../components/providers/ApplicationProvider';
import { AccountUiDto } from '../../lib/presentation/dtos/AccountUiDto';
import { v4 as uuidv4 } from 'uuid';

export const useAccounts = () => {
  const application = useApplication();
  
  const [accounts, setAccounts] = useState<AccountUiDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const create = async (name: string, code?: string) => {
    setIsLoading(true);
    const tempId = uuidv4();
    
    const optimisticAccount = new AccountUiDto({
      id: tempId, name, code, type: 'Prospect', status: 'Active', 
      isArchived: false, sync_status: 'pending' as const, sync_version: 1
    });
    setAccounts(prev => [...prev, optimisticAccount]);

    // Stub result
    const result = { isSuccess: true, error: null };
    if (!result.isSuccess) {
      setAccounts(prev => prev.filter(a => a.id !== tempId));
    }
    
    setIsLoading(false);
    return result;
  };

  const updateHierarchy = async (id: string, parentId: string) => {
    // Optimistic assignment...
    const result = { isSuccess: true, error: null }; // Stubbed
    return result;
  };

  return { accounts, create, updateHierarchy, isLoading };
};
