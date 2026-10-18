import {
  Coins,
  FileText,
  GitBranch,
  KeyRound,
  LayoutGrid,
  Palette,
  Percent,
  PlugZap,
  Shield,
  ShoppingCart,
  Tags,
  ToggleRight,
  User,
  UsersRound,
  BrainCircuit,
  Wallet,
  Map,
  Route,
  SlidersHorizontal,
  Banknote,
  CalendarOff,
  Bell,
  MapPin,
  type LucideIcon,
} from 'lucide-react';
import { CATALOG_LINES, type SurfaceGate } from '@/lib/plans/surface-gates';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'appearance',
  'notifications',
  'password',
  'whatsapp',
  'ai',
  'templates',
  'fields',
  'document_templates',
  'deals',
  'deal_pipelines',
  'leads',
  'tasks',
  'orders',
  'payments',
  'pricing',
  'members',
  'api',
  'expense_types',
  'leave_types',
  'territories',
  'route',
  'attendance_locations',
  'module_settings',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/**
 * Rail grouping, plus the two gates a section has to pass.
 *
 * `gate` is the plan entitlement (product line and/or admin module toggle) and
 * `permission` the RBAC right. Both were missing: the settings page rendered
 * every panel for anyone who could reach /settings, so `?tab=payments` opened
 * Payment Settings on a CRM-only plan, `?tab=territories` opened the Territory
 * Master on a plan with no WFA line, and `?tab=leads` / `?tab=deal_pipelines`
 * opened the CRM settings on a WFA- or SFA-only plan. The `?tab=` values are
 * deep-linkable and were in the open.
 *
 * A section with no `gate` is a base feature on every plan; one with no
 * `permission` is personal (Appearance, Notifications, Change Password).
 */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace' | 'hidden';
  gate?: SurfaceGate;
  permission?: string;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top', permission: PERMISSIONS.SETTINGS.MANAGE_ORG },
  // Personal preferences — everyone, on every plan.
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account' },
  notifications: { id: 'notifications', label: 'Notifications', icon: Bell, group: 'account' },
  password: { id: 'password', label: 'Change Password', icon: KeyRound, group: 'hidden' },
  // ── CRM line ──
  whatsapp: { id: 'whatsapp', label: 'Whatsapp', icon: PlugZap, group: 'workspace', gate: { line: 'crm', configModule: 'whatsapp' }, permission: PERMISSIONS.SETTINGS.MANAGE_WHATSAPP_SETTINGS },
  ai: { id: 'ai', label: 'Knowledge Base', icon: BrainCircuit, group: 'hidden', gate: { line: 'crm', configModule: 'whatsapp' }, permission: PERMISSIONS.WHATSAPP.VIEW_AI_ASSISTANT }, // hidden in rail
  templates: { id: 'templates', label: 'Templates', icon: FileText, group: 'hidden', gate: { line: 'crm', configModule: 'whatsapp' }, permission: PERMISSIONS.WHATSAPP.VIEW_TEMPLATES }, // hidden in rail
  deal_pipelines: { id: 'deal_pipelines', label: 'Deals', icon: GitBranch, group: 'workspace', gate: { line: 'crm' }, permission: PERMISSIONS.MASTERS.EDIT_PIPELINES },
  leads: { id: 'leads', label: 'Leads Settings', icon: User, group: 'workspace', gate: { line: 'crm' }, permission: PERMISSIONS.MASTERS.EDIT_LEAD_SOURCES },
  // ── Base on every plan ──
  fields: { id: 'fields', label: 'Tags', icon: Tags, group: 'workspace', permission: PERMISSIONS.SETTINGS.MANAGE_TAGS },
  document_templates: { id: 'document_templates', label: 'Template', icon: FileText, group: 'workspace', permission: PERMISSIONS.MASTERS.EDIT_DOCUMENT_TEMPLATES },
  // Currency, not deals, despite the key (the Deals tab renders it above the pipelines).
  deals: { id: 'deals', label: 'Currency', icon: Coins, group: 'hidden', permission: PERMISSIONS.SETTINGS.MANAGE_ORG },
  tasks: { id: 'tasks', label: 'Task Settings', icon: FileText, group: 'workspace', permission: PERMISSIONS.MASTERS.EDIT_TASK_TYPES },
  // Attendance, Leave and Holiday are sold in every column, CRM included.
  leave_types: { id: 'leave_types', label: 'Leave Settings', icon: CalendarOff, group: 'workspace', permission: PERMISSIONS.MASTERS.EDIT_LEAVE_TYPES },
  // ── SFA line ──
  orders: { id: 'orders', label: 'Orders Settings', icon: ShoppingCart, group: 'hidden', gate: { line: 'sfa' }, permission: PERMISSIONS.SETTINGS.MANAGE_ORDER_SETTINGS },
  payments: { id: 'payments', label: 'Payments', icon: Banknote, group: 'workspace', gate: { line: 'sfa', configModule: 'payment' }, permission: PERMISSIONS.MASTERS.EDIT_PAYMENT_TYPES },
  route: { id: 'route', label: 'Route Settings', icon: Route, group: 'workspace', gate: { line: 'sfa', configModule: 'route' }, permission: PERMISSIONS.SETTINGS.MANAGE_ROUTE_SETTINGS },
  // Catalogue Settings carries the tax slabs, discount rules and the Scheme /
  // Stock opt-ins — it follows the catalogue, which is CRM or SFA, never WFA.
  pricing: { id: 'pricing', label: 'Catalogue Settings', icon: Percent, group: 'workspace', gate: { anyLine: CATALOG_LINES }, permission: PERMISSIONS.MASTERS.EDIT_TAX_SLABS },
  // ── WFA line ──
  expense_types: { id: 'expense_types', label: 'Expense Settings', icon: Wallet, group: 'workspace', gate: { line: 'wfa', configModule: 'expense' }, permission: PERMISSIONS.MASTERS.EDIT_EXPENSE_TYPES },
  territories: { id: 'territories', label: 'Territory', icon: Map, group: 'workspace', gate: { line: 'wfa', configModule: 'territory' }, permission: PERMISSIONS.MASTERS.EDIT_TERRITORIES },
  attendance_locations: { id: 'attendance_locations', label: 'Attendance Locations', icon: MapPin, group: 'workspace', gate: { line: 'wfa' }, permission: PERMISSIONS.MASTERS.EDIT_ATTENDANCE_LOCATIONS },
  // ── Admin ──
  members: { id: 'members', label: 'Team', icon: UsersRound, group: 'hidden', permission: PERMISSIONS.TEAM.MANAGE_EMPLOYEES },
  api: { id: 'api', label: 'API Settings', icon: KeyRound, group: 'workspace', permission: PERMISSIONS.SETTINGS.MANAGE_API_KEYS },
  module_settings: { id: 'module_settings', label: 'Organization Settings', icon: ToggleRight, group: 'workspace', permission: PERMISSIONS.SETTINGS.MANAGE_ORG },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (raw === 'deals') return 'deal_pipelines';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
