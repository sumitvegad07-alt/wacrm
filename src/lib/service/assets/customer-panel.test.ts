import { describe, it, expect } from 'vitest';
import {
  PANEL_PAGE_SIZE,
  addAssetHref,
  assetHref,
  describePanelError,
  panelFooter,
  panelHeading,
  shouldShowCustomerAssets,
  viewAllAssetsHref,
} from './customer-panel';
import { AssetError } from './errors';
import { parseAssetFilters } from './filters';

const ok = { hasFSM: true, canView: true, accountId: 'acc-1', contactId: 'con-1' };
const GENERIC = 'Could not load assets. Please try again.';

describe('shouldShowCustomerAssets (the gate that decides whether anything is fetched)', () => {
  it('is true only when every condition holds', () => {
    expect(shouldShowCustomerAssets(ok)).toBe(true);
  });
  it('is false for a tenant without the fsm line, whatever else is true', () => {
    expect(shouldShowCustomerAssets({ ...ok, hasFSM: false })).toBe(false);
  });
  it('is false without the view right', () => {
    expect(shouldShowCustomerAssets({ ...ok, canView: false })).toBe(false);
  });
  it('is false while the account or the customer is not known yet', () => {
    expect(shouldShowCustomerAssets({ ...ok, accountId: null })).toBe(false);
    expect(shouldShowCustomerAssets({ ...ok, accountId: undefined })).toBe(false);
    expect(shouldShowCustomerAssets({ ...ok, accountId: '' })).toBe(false);
    expect(shouldShowCustomerAssets({ ...ok, contactId: undefined })).toBe(false);
    expect(shouldShowCustomerAssets({ ...ok, contactId: '' })).toBe(false);
  });
  it('is false for the loading defaults of useAuth', () => {
    expect(shouldShowCustomerAssets({ hasFSM: false, canView: false, accountId: null, contactId: 'con-1' })).toBe(false);
  });
});

describe('panelHeading', () => {
  it('shows the count only when there are assets', () => {
    expect(panelHeading(0)).toBe('Assets');
    expect(panelHeading(1)).toBe('Assets (1)');
    expect(panelHeading(40)).toBe('Assets (40)');
  });
});

describe('links', () => {
  it('Add Asset opens the form, which locks the customer', () => {
    expect(addAssetHref('con-1')).toBe('/service/assets/new?contactId=con-1');
  });
  it('View all opens the list filtered to the customer, and the list parses it', () => {
    const id = '3f2a9c1e-0000-4000-8000-000000000001';
    const href = viewAllAssetsHref(id);
    expect(href).toBe(`/service/assets?contactId=${id}`);
    expect(parseAssetFilters(new URLSearchParams(href.split('?')[1])).contactId).toBe(id);
  });
  it('encodes ids rather than trusting them', () => {
    expect(addAssetHref('a b&c')).toBe('/service/assets/new?contactId=a%20b%26c');
    expect(assetHref('x/y')).toBe('/service/assets/x%2Fy');
  });
  it('an asset row links to its own page', () => {
    expect(assetHref('abc')).toBe('/service/assets/abc');
  });
});

describe('panelFooter', () => {
  it('has no View all for an empty panel', () => {
    expect(panelFooter(0, 0)).toEqual({ showViewAll: false, hiddenCount: 0 });
  });
  it('has View all and nothing hidden when everything fits', () => {
    expect(panelFooter(3, 3)).toEqual({ showViewAll: true, hiddenCount: 0 });
    expect(panelFooter(PANEL_PAGE_SIZE, PANEL_PAGE_SIZE)).toEqual({ showViewAll: true, hiddenCount: 0 });
  });
  it('says how many are not shown when there are more than a page', () => {
    expect(panelFooter(31, PANEL_PAGE_SIZE)).toEqual({ showViewAll: true, hiddenCount: 6 });
  });
  it('never reports a negative count', () => {
    expect(panelFooter(2, 5).hiddenCount).toBe(0);
  });
});

describe('describePanelError', () => {
  it('keeps the network message, which is already written for people', () => {
    expect(describePanelError(new AssetError('network', 'Check your connection.'))).toBe('Check your connection.');
  });
  it('explains a permission failure', () => {
    expect(describePanelError(new AssetError('permission', 'raw rls text'))).toBe(
      "You don't have permission to view assets.",
    );
  });
  it('never leaks raw database text', () => {
    const raw = 'relation "customer_assets" does not exist';
    expect(describePanelError(new AssetError('unknown', raw, { raw }))).toBe(GENERIC);
    expect(describePanelError(new Error('boom'))).toBe(GENERIC);
    expect(describePanelError('x')).toBe(GENERIC);
  });
});
