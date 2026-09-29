import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from './permissions-registry';

describe('service permission keys', () => {
  it('exposes the asset rights the FSM screens gate on', () => {
    expect(PERMISSIONS.SERVICE_ASSETS.VIEW).toBe('view_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.CREATE).toBe('create_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.EDIT).toBe('edit_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.DELETE).toBe('delete_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.IMPORT).toBe('import_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.EXPORT).toBe('export_service_assets');
  });

  it('exposes the settings right', () => {
    expect(PERMISSIONS.SERVICE_SETTINGS.MANAGE).toBe('manage_service_settings');
  });

  it('uses no key that collides with an existing permission string', () => {
    const all: string[] = [];
    const walk = (o: Record<string, unknown>) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'string') all.push(v);
        else if (v && typeof v === 'object') walk(v as Record<string, unknown>);
      }
    };
    walk(PERMISSIONS as unknown as Record<string, unknown>);
    const seen = new Set<string>();
    const dupes = all.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    // Pre-existing intentional aliases are allowed; new service_ keys are not.
    expect(dupes.filter((k) => k.includes('service_'))).toEqual([]);
  });
});
