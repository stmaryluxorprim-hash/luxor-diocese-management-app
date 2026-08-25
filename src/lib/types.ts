// ---------- Domain types (mirror of Supabase schema) ----------

export type AppRole = 'owner' | 'church_manager' | 'service_manager' | 'class_servant';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Church {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  church_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassRoom {
  id: string;
  church_id: string;
  service_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  user_id: string;
  phone: string;
  role: AppRole;
  status: ApprovalStatus;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Child {
  id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  name: string;
  phone: string | null;
  birthdate: string | null;
  address: string | null;
  notes: string | null;
  attendance_count: number;
  points: number;
  qr_code: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  id: string;
  child_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  attended_on: string;
  points_awarded: number;
  recorded_by: string | null;
  created_at: string;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: 'مالك التطبيق',
  church_manager: 'مدير كنيسة',
  service_manager: 'مسؤول خدمة',
  class_servant: 'خادم فصل',
};

export const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
};

// user_id -> synthetic email used for Supabase auth
export const userIdToEmail = (userId: string) =>
  `${userId.trim().toLowerCase()}@diocese.app`;
