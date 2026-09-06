import type { Bucket, Frequency } from "./analytics-period";

// Shared shapes for the SFA analytics bundle. Kept out of the "use server"
// action file so that file can export only async functions (a Next.js
// requirement) while both the action and the client UI import these types.

export interface NamedValue {
  name: string;
  value: number;
  secondary?: number;
}

export interface StatusSlice {
  status: string;
  count: number;
  value: number;
}

export interface SfaAnalytics {
  freq: Frequency;
  kpis: {
    customerVisits: number;
    newCustomers: number;
    salesOrders: number;
    orderValue: number;
    salesValue: number;
    uniqueCustomersOrdered: number;
    paymentCollection: number;
    uniqueCustomerVisits: number;
  };
  orderValueSeries: Bucket[];
  salesSeries: Bucket[];
  paymentSeries: Bucket[];
  orderVsSales: { key: string; label: string; order: number; sales: number }[];
  ordersByStatus: StatusSlice[];
  topSalespeople: NamedValue[];
  topProducts: NamedValue[];
  topCustomers: NamedValue[];
}
