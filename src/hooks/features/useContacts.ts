import { useState, useCallback } from 'react';
import { useApplication } from '../../components/providers/ApplicationProvider';
import { CreateContactCommand } from '../../lib/application/services/contacts/CreateContactCommandHandler';
import { ContactUiDto } from '../../lib/presentation/dtos/ContactUiDto';
import { v4 as uuidv4 } from 'uuid'; // Standard practice for client-side IDs

export const useContacts = () => {
  const application = useApplication();
  
  // Note: Real implementation would pull this from a local query handler (WatermelonDB subscription)
  // For this integration sprint, we manage optimistic state locally
  const [contacts, setContacts] = useState<ContactUiDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (name: string, phone?: string, email?: string) => {
    setIsLoading(true);
    setError(null);
    
    // Generate ID for optimistic UI
    const tempId = uuidv4();
    const command = new CreateContactCommand(tempId, name, phone, email);
    
    // 1. Optimistic Update (create DTO manually)
    const optimisticEntity = { id: tempId, name, phone, email, sync_status: 'pending' };
    const optimisticDto = new ContactUiDto(optimisticEntity);
    setContacts(prev => [...prev, optimisticDto]);

    // 2. Dispatch to Application Service
    const result = await application.createContactHandler.execute(command);
    
    // 3. Handle Rollback on failure
    if (!result.isSuccess) {
      setError(result.getErrorOrThrow().message);
      setContacts(prev => prev.filter(c => c.id !== tempId)); // Rollback
    }
    
    setIsLoading(false);
    return result;
  }, [application]);

  return {
    contacts,
    create,
    isLoading,
    error
  };
};
