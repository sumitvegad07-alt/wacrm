import { useState } from 'react';
import { useApplication } from '../../components/providers/ApplicationProvider';
import { v4 as uuidv4 } from 'uuid';

export const useContactRelationships = (contactId: string) => {
  const application = useApplication();
  
  const [relationships, setRelationships] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const linkToAccount = async (accountId: string, roleId: string, isPrimary: boolean) => {
    setIsLoading(true);
    const tempId = uuidv4();
    
    // Optimistic Update
    const newRel = {
      id: tempId, contactId, accountId, roleId, isPrimary, 
      effectiveFrom: new Date().toISOString(), relationshipStatus: 'Active',
      sync_status: 'pending'
    };

    setRelationships(prev => {
      // If new is primary, optimistically demote others
      if (isPrimary) {
        return [...prev.map(r => ({ ...r, isPrimary: false })), newRel];
      }
      return [...prev, newRel];
    });

    // Simulated result
    const result = { isSuccess: true, error: null };
    
    if (!result.isSuccess) {
      // Rollback
      setRelationships(prev => prev.filter(r => r.id !== tempId)); 
    }
    
    setIsLoading(false);
    return result;
  };

  return { relationships, linkToAccount, isLoading };
};
