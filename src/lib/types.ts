// Типы повторяют колонки миграций один в один:
// supabase/migrations/20260920180000_core_dictionaries.sql
// supabase/migrations/20260920180100_contacts_and_deals.sql

export type UserRole = "manager" | "head" | "admin" | "builder";

export type DealStatus = "open" | "postponed" | "won" | "lost";

export type StageKind = "open" | "won" | "lost";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  work_phone: string | null;
  pbx_login: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Stage {
  id: string;
  name: string;
  position: number;
  kind: StageKind;
  requires_qualification: boolean;
  requires_next_step: boolean;
  is_active: boolean;
  created_at: string;
}

export interface Deal {
  id: string;
  contact_id: string;
  owner_id: string | null;
  stage_id: string;
  status: DealStatus;
  title: string | null;
  object_text: string | null;
  source_id: string | null;
  utm: Record<string, unknown>;
  meta_campaign_id: string | null;
  meta_lead_id: string | null;
  budget: string | null;
  budget_currency: string;
  payment: string | null;
  horizon: string | null;
  residency: string | null;
  rooms: number | null;
  purpose: string | null;
  postponed_until: string | null;
  lost_reason_id: string | null;
  lost_comment: string | null;
  first_inbound_at: string | null;
  first_response_at: string | null;
  sla_due_at: string | null;
  sla_breached_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  manager: "Менеджер",
  head: "Руководитель",
  admin: "Администратор",
  builder: "Застройщик",
};

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  open: "В работе",
  postponed: "Отложена",
  won: "Выиграна",
  lost: "Проиграна",
};
