import { describe, it, expect } from 'vitest';
import { orderReportConfig } from '@/lib/reports/orderReportConfig';

describe('Territory Level Lookup Suite', () => {
  it('maps country filter to territory level 1', () => {
    const countryFilter = orderReportConfig.filters.find(f => f.key === 'country');
    expect(countryFilter).toBeDefined();
    expect(countryFilter?.type).toBe('territory');
    expect(countryFilter?.territoryLevel).toBe(1);
  });

  it('maps state filter to territory level 2', () => {
    const stateFilter = orderReportConfig.filters.find(f => f.key === 'state');
    expect(stateFilter).toBeDefined();
    expect(stateFilter?.type).toBe('territory');
    expect(stateFilter?.territoryLevel).toBe(2);
  });

  it('maps city filter to territory level 3', () => {
    const cityFilter = orderReportConfig.filters.find(f => f.key === 'city');
    expect(cityFilter).toBeDefined();
    expect(cityFilter?.type).toBe('territory');
    expect(cityFilter?.territoryLevel).toBe(3);
  });

  it('maps area filter to territory level 4', () => {
    const areaFilter = orderReportConfig.filters.find(f => f.key === 'area');
    expect(areaFilter).toBeDefined();
    expect(areaFilter?.type).toBe('territory');
    expect(areaFilter?.territoryLevel).toBe(4);
  });
});
