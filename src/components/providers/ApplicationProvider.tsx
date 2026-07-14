import React, { createContext, useContext, ReactNode } from 'react';
import { CompositionRoot } from '../../lib/application/core/CompositionRoot';

export interface ApplicationContextProps {
  compositionRoot: CompositionRoot;
}

const ApplicationContext = createContext<ApplicationContextProps | null>(null);

export const ApplicationProvider: React.FC<{ compositionRoot: CompositionRoot, children: ReactNode }> = ({ 
  compositionRoot, 
  children 
}) => {
  return (
    <ApplicationContext.Provider value={{ compositionRoot }}>
      {children}
    </ApplicationContext.Provider>
  );
};

export const useApplication = () => {
  const context = useContext(ApplicationContext);
  if (!context) {
    throw new Error('useApplication must be used within an ApplicationProvider');
  }
  return context.compositionRoot;
};
