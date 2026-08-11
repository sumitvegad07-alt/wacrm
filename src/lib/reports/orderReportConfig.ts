import type { ReportDefinition } from './types';

export const orderReportConfig: ReportDefinition = {
  moduleName: 'order',
  label: 'Order Reports',
  requiredModule: 'orders',
  
  dimensions: [
    { key: 'customer', label: 'Customer', category: 'customer' },
    { key: 'user', label: 'User', category: 'user' },
    { key: 'country', label: 'Country', category: 'area' },
    { key: 'state', label: 'State', category: 'area' },
    { key: 'city', label: 'City', category: 'area' },
    { key: 'area', label: 'Area', category: 'area' },
    { key: 'date', label: 'Time', category: 'time' },
    { key: 'product', label: 'Product', category: 'product' },
    { key: 'product_category', label: 'Product Category', category: 'product' },
    { key: 'product_subcategory', label: 'Product Sub-Category', category: 'product' },
  ],
  
  measures: [
    { key: 'order_count', label: '# of order', type: 'number' },
    { key: 'product_count', label: '# of product', type: 'number' },
    { key: 'product_quantity', label: 'Quantity', type: 'number' },
    { key: 'gross_amount', label: 'Sub Amount', type: 'currency' },
    { key: 'net_amount', label: 'Amount', type: 'currency' },
    { key: 'discount_amount', label: 'Discount Amount', type: 'currency' },
    { key: 'tax_amount', label: 'Tax Amount', type: 'currency' },
  ],
  
  kpis: ['net_amount', 'gross_amount', 'order_count'],

  filters: [
    { key: 'date_range', label: 'Period', type: 'date_range', section: 'PERIOD' },
    { key: 'sales_type', label: 'Sales Type', type: 'select', section: 'SALES TYPE', options: [
      { label: 'Primary', value: 'primary' },
      { label: 'Secondary', value: 'secondary' },
    ]},
    { key: 'country', label: 'Country', type: 'select', section: 'AREA' },
    { key: 'state', label: 'State', type: 'select', section: 'AREA' },
    { key: 'city', label: 'City', type: 'select', section: 'AREA' },
    { key: 'area', label: 'Area', type: 'select', section: 'AREA' },
    { key: 'user', label: 'Ordered by', type: 'user', section: 'USER' },
    { key: 'user_role', label: 'Ordered by role', type: 'select', section: 'USER', options: [
      { label: 'Admin', value: 'admin' },
      { label: 'Sales Rep', value: 'sales_rep' },
      { label: 'Manager', value: 'manager' },
    ]},
    { key: 'customer', label: 'Customer', type: 'customer', section: 'CUSTOMER' },
    { key: 'product', label: 'Product', type: 'product', section: 'PRODUCT' },
    { key: 'product_category', label: 'Category', type: 'select', section: 'PRODUCT' },
    { key: 'product_subcategory', label: 'Sub-Category', type: 'select', section: 'PRODUCT' },
  ]
};

