import type { ReportDefinition } from './types';

export const paymentReportConfig: ReportDefinition = {
  moduleName: 'payment',
  label: 'Payment Reports',
  requiredModule: 'payments',
  
  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'user', label: 'Collected By', category: 'user' },
    { key: 'payment_type', label: 'Payment Type', category: 'product' }, // Using product category visually for now
    { key: 'source', label: 'Source', category: 'area' },
    { key: 'date', label: 'Time', category: 'time' },
    { key: 'status', label: 'Status', category: 'product' },
  ],
  
  measures: [
    { key: 'payment_count', label: '# of payments', type: 'number' },
    { key: 'amount', label: 'Requested Amount', type: 'currency' },
    { key: 'verified_amount', label: 'Verified Amount', type: 'currency' },
    { key: 'customer_count', label: '# of customers', type: 'number' },
    { key: 'avg_payment', label: 'Avg Payment', type: 'currency' },
  ],
  
  kpis: ['verified_amount', 'amount', 'payment_count'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'status', label: 'Status', type: 'select', section: 'SALES TYPE', options: [
      { label: 'Pending', value: 'Pending' },
      { label: 'Approved', value: 'Approved' },
      { label: 'Rejected', value: 'Rejected' },
      { label: 'Cancelled', value: 'Cancelled' },
    ]},
    { key: 'source', label: 'Source', type: 'select', section: 'SALES TYPE', options: [
      { label: 'Admin', value: 'admin' },
      { label: 'Visit', value: 'visit' },
      { label: 'Customer', value: 'customer' },
    ]},
    { key: 'user', label: 'Collected by', type: 'user', section: 'USER' },
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
  ],

  tabConfigs: [
    {
      key: 'customer',
      label: 'Customer',
      dimension: 'customer',
      defaultMeasures: ['payment_count', 'amount', 'verified_amount'],
    },
    {
      key: 'user',
      label: 'User',
      dimension: 'user',
      defaultMeasures: ['payment_count', 'customer_count', 'amount', 'verified_amount'],
    },
    {
      key: 'payment_type',
      label: 'Payment Type',
      dimension: 'payment_type',
      defaultMeasures: ['payment_count', 'amount', 'verified_amount'],
    },
    {
      key: 'time',
      label: 'Time',
      dimension: 'date',
      defaultMeasures: ['payment_count', 'amount', 'verified_amount'],
    },
    {
      key: 'source',
      label: 'Source',
      dimension: 'source',
      defaultMeasures: ['payment_count', 'amount', 'verified_amount'],
    },
  ]
};
