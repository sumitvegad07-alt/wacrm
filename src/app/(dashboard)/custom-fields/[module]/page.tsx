'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { CustomFieldsModuleBuilder } from '@/components/custom-fields/custom-fields-module-builder';
import { RequirePermission } from '@/components/auth/require-permission';

export default function CustomFieldsModulePage() {
  const params = useParams();
  const moduleName = (typeof params.module === 'string' ? params.module : params.module?.[0]) || 'contact';

  return (
    <RequirePermission permission="edit_custom_fields">
      <CustomFieldsModuleBuilder moduleName={moduleName} />
    </RequirePermission>
  );
}
