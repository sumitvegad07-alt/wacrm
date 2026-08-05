'use client';

import { useState, useEffect, useCallback } from 'react';

export type AssignmentMode = 'area' | 'direct';

export interface ExtraSettingsState {
  assignmentMode: AssignmentMode;
  customerHierarchy: boolean;
  setAssignmentMode: (mode: AssignmentMode) => void;
  setCustomerHierarchy: (enabled: boolean) => void;
}

const ASSIGNMENT_KEY = 'wacrm_assignment_mode';
const HIERARCHY_KEY = 'wacrm_customer_hierarchy';

export function useExtraSettings(): ExtraSettingsState {
  const [assignmentMode, setAssignmentModeState] = useState<AssignmentMode>('area');
  const [customerHierarchy, setCustomerHierarchyState] = useState<boolean>(true);

  // Load initial state from localStorage on client hydration
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem(ASSIGNMENT_KEY) as AssignmentMode | null;
      if (savedMode === 'area' || savedMode === 'direct') {
        setAssignmentModeState(savedMode);
      }
      const savedHierarchy = localStorage.getItem(HIERARCHY_KEY);
      if (savedHierarchy !== null) {
        setCustomerHierarchyState(savedHierarchy === 'true');
      }
    }
  }, []);

  // Listen to custom event for real-time synchronization across components (e.g. sidebar and settings page)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleSync = () => {
      const savedMode = localStorage.getItem(ASSIGNMENT_KEY) as AssignmentMode | null;
      if (savedMode === 'area' || savedMode === 'direct') {
        setAssignmentModeState(savedMode);
      }
      const savedHierarchy = localStorage.getItem(HIERARCHY_KEY);
      if (savedHierarchy !== null) {
        setCustomerHierarchyState(savedHierarchy === 'true');
      }
    };

    window.addEventListener('wacrm_extra_settings_changed', handleSync);
    window.addEventListener('storage', handleSync);

    return () => {
      window.removeEventListener('wacrm_extra_settings_changed', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  const setAssignmentMode = useCallback((mode: AssignmentMode) => {
    setAssignmentModeState(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(ASSIGNMENT_KEY, mode);
      window.dispatchEvent(new Event('wacrm_extra_settings_changed'));
    }
  }, []);

  const setCustomerHierarchy = useCallback((enabled: boolean) => {
    setCustomerHierarchyState(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem(HIERARCHY_KEY, String(enabled));
      window.dispatchEvent(new Event('wacrm_extra_settings_changed'));
    }
  }, []);

  return {
    assignmentMode,
    customerHierarchy,
    setAssignmentMode,
    setCustomerHierarchy,
  };
}
