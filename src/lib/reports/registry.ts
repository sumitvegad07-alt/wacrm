// Central lookup of report definitions by module name. The per-page report viewers
// import their own config directly; this registry is for surfaces that resolve a
// report dynamically from a module string — e.g. the /print/report template.
import type { ReportDefinition } from './types';
import { salesReportConfig } from './salesReportConfig';
import { orderReportConfig } from './orderReportConfig';
import { quotationReportConfig } from './quotationReportConfig';
import { paymentReportConfig } from './paymentReportConfig';
import { ageingReportConfig } from './ageingReportConfig';
import { leadReportConfig } from './leadReportConfig';
import { dealReportConfig } from './dealReportConfig';
import { visitReportConfig } from './visitReportConfig';
import { dsrReportConfig } from './dsrReportConfig';
import { expenseReportConfig } from './expenseReportConfig';
import { taskReportConfig } from './taskReportConfig';

const ALL: ReportDefinition[] = [
  salesReportConfig, orderReportConfig, quotationReportConfig, paymentReportConfig,
  ageingReportConfig, leadReportConfig, dealReportConfig, visitReportConfig,
  dsrReportConfig, expenseReportConfig, taskReportConfig,
];

const BY_MODULE = new Map(ALL.map((r) => [r.moduleName, r]));

export function getReportByModule(moduleName: string): ReportDefinition | undefined {
  return BY_MODULE.get(moduleName);
}
