import { describe, it, expect } from 'vitest';
import { templateLineAllowed } from './access';

describe('templateLineAllowed', () => {
  it('WFA template allowed on SFA plan (SFA includes WFA)', () => expect(templateLineAllowed('SFA', 'wfa')).toBe(true));
  it('WFA template not allowed on CRM plan', () => expect(templateLineAllowed('CRM', 'wfa')).toBe(false));
  it('legacy/unknown plan → full access', () => expect(templateLineAllowed('Pro', 'wfa')).toBe(true));
});
