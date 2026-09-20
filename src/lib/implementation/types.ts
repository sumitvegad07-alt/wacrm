// Shared types for the Implementation Center ("Getting Started") engine.
export type ProductLine = 'crm' | 'wfa' | 'sfa';
export type StepStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'auto_completed' | 'skipped';
export type Operator = 'gt' | 'gte' | 'eq' | 'exists';
export type Combine = 'and' | 'or';

export type AnswerMap = Record<string, unknown>;

// Resolver values captured at enrollment. A step completes only when its live
// value grows beyond this baseline, so pre-existing defaults don't pre-complete.
export type BaselineMap = Record<string, number | boolean>;

export interface ValidationRule {
  id: string;
  step_id: string;
  source_key: string;
  operator: Operator;
  required_threshold: number | null;
  recommended_threshold: number | null;
  health_weight: number | null;
  params: Record<string, unknown> | null;
  combine: Combine;
}

export interface StepCondition {
  id: string;
  step_id: string;
  depends_on_question_key: string;
  comparator: 'eq' | 'neq' | 'in' | 'not_in' | 'truthy';
  value: unknown;
  effect: 'show' | 'hide' | 'require' | 'skip';
}

export interface StepQuestionOption {
  value: string;
  label: string;
  recommended_badge?: string;
  note?: string;
}
export interface StepQuestion {
  id: string;
  step_id: string;
  position: number;
  question_key: string;
  label: string;
  input_type: 'single_select' | 'multi_select' | 'text' | 'bool';
  options: StepQuestionOption[];
  required: boolean;
}
export interface StepTask {
  id: string; step_id: string; position: number;
  label: string; help_text: string | null; deep_link: string | null; optional: boolean;
}
export interface StepMedia {
  id: string; step_id: string; position: number;
  media_type: 'image' | 'video'; url: string; caption: string | null;
}
export interface TemplateStep {
  id: string; template_id: string; position: number; step_key: string;
  step_type: 'task' | 'discovery' | 'milestone_gate';
  title: string; description: string | null; video_url: string | null;
  quick_steps: string[]; help_text: string | null; help_context: string | null;
  estimated_minutes: number; is_optional: boolean; auto_complete: boolean; weight: number;
  tasks: StepTask[]; questions: StepQuestion[]; media: StepMedia[];
  rules: ValidationRule[]; conditions: StepCondition[];
}
export interface Milestone {
  id: string; template_id: string; position: number; milestone_key: string;
  title: string; message: string | null; icon: string | null; trigger_step_key: string;
}
export interface TemplateDefinition {
  id: string; product_line: ProductLine; template_key: string; version: number;
  name: string; display_name: string; description: string | null;
  estimated_minutes: number; support_whatsapp_url: string | null;
  steps: TemplateStep[]; milestones: Milestone[];
}

export interface StepProgressRow {
  step_id: string; status: StepStatus; auto: boolean;
  validation_snapshot: Record<string, unknown> | null;
}

// One rule's live evaluation.
export interface RuleEvaluation {
  source_key: string;
  value: number | boolean;
  requiredPass: boolean;
  recommendedPass: boolean | null; // null when no recommended_threshold
  recommendedThreshold: number | null;
  healthWeight: number | null;
}
export interface EvaluatedStep {
  step: TemplateStep;
  applicable: boolean;
  status: StepStatus;
  ruleResults: RuleEvaluation[];
  requiredSatisfied: boolean;
}
export interface EvaluatedTemplate {
  template: TemplateDefinition;
  steps: EvaluatedStep[];
  progressPct: number;
  score: number;
  healthPct: number;
  currentStepId: string | null;
  completed: boolean;
}

export type AnalyticsEventType =
  | 'template_started' | 'step_viewed' | 'step_started' | 'step_completed'
  | 'step_auto_completed' | 'step_skipped' | 'validation_failed' | 'video_played'
  | 'task_toggled' | 'question_answered' | 'help_requested' | 'milestone_reached'
  | 'template_completed';

// Optional injected resolver for testing evaluate() without Supabase.
export type ResolverOverride = (sourceKey: string, params?: Record<string, unknown> | null) => Promise<number | boolean>;
