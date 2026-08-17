import type { ReportDefinition } from './types';

/**
 * Lead Report — volume and conversion by where leads come from.
 *
 * Every tab except Status shows the same three columns: how many leads, how many
 * of them converted, and the ratio between the two.
 *
 * The ratio is computed in SQL per group, so each row is correct — but it is NOT
 * summable. The table footer deliberately shows a dash for it (adding one source
 * at 100% to four at 0% would read 100% when the real overall figure is 11%). The
 * true overall ratio is the KPI card, which runs its own grand-total query.
 *
 * Status gets only the lead count: a status is a point in the lead's life, so
 * "converted leads that are still New" is not a meaningful figure.
 *
 * Leads have no `area` column the way contacts do, so the Area tab falls back
 * territory name → city → '-'. Registered in migration
 * 20260817150000_lead_and_deal_report_modules.sql.
 */

/** Volume, conversions, and the ratio between them. */
const CONVERSION_COLUMNS = ['lead_count', 'converted_count', 'conversion_ratio'] as const;

export const leadReportConfig: ReportDefinition = {
  moduleName: 'lead',
  label: 'Lead Reports',
  requiredModule: 'leads',

  dimensions: [
    { key: 'source', label: 'Lead Source', category: 'customer' },
    { key: 'status', label: 'Lead Status', category: 'customer' },
    { key: 'industry', label: 'Industry', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'date', label: 'Period', category: 'time' },
  ],

  measures: [
    { key: 'lead_count', label: '# lead', type: 'number' },
    { key: 'converted_count', label: '# converted lead', type: 'number' },
    { key: 'conversion_ratio', label: '# ratio', type: 'percent' },
  ],

  kpis: ['lead_count', 'converted_count', 'conversion_ratio'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'status', label: 'Status', type: 'lookup', lookupTable: 'lead_statuses', section: 'LEAD' },
    { key: 'source', label: 'Source', type: 'lookup', lookupTable: 'lead_sources', section: 'LEAD' },
    { key: 'industry', label: 'Industry', type: 'lookup', lookupTable: 'lead_industries', section: 'LEAD' },
    { key: 'country', label: 'Country', type: 'territory', section: 'AREA', territoryLevel: 1 },
    { key: 'state', label: 'State', type: 'territory', section: 'AREA', territoryLevel: 2 },
    { key: 'city', label: 'City', type: 'territory', section: 'AREA', territoryLevel: 3 },
    { key: 'area', label: 'Area', type: 'territory', section: 'AREA', territoryLevel: 4 },
    { key: 'user', label: 'Owned by', type: 'user', section: 'USER' },
  ],

  tabConfigs: [
    {
      key: 'source',
      label: 'Lead Source',
      dimension: 'source',
      defaultMeasures: [...CONVERSION_COLUMNS],
    },
    {
      key: 'status',
      label: 'Lead Status',
      dimension: 'status',
      // Count only — see the file header for why conversion has no meaning here.
      defaultMeasures: ['lead_count'],
    },
    {
      key: 'industry',
      label: 'Industry',
      dimension: 'industry',
      defaultMeasures: [...CONVERSION_COLUMNS],
    },
    {
      key: 'user',
      label: 'User',
      dimension: 'user',
      defaultMeasures: [...CONVERSION_COLUMNS],
    },
    {
      key: 'area',
      label: 'Area',
      dimension: 'area',
      defaultMeasures: [...CONVERSION_COLUMNS],
    },
    {
      key: 'time',
      label: 'Period',
      dimension: 'date',
      defaultMeasures: [...CONVERSION_COLUMNS],
    },
  ],
};
