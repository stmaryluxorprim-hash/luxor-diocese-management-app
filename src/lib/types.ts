// ---------- Domain types (mirror of Supabase schema) ----------

export type AppRole = 'owner' | 'church_manager' | 'service_manager' | 'class_servant';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

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
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassRoom {
  id: string;
  church_id: string;
  service_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
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
  photo_url: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Gender = 'boy' | 'girl';

export const GENDER_LABELS: Record<Gender, string> = {
  boy: 'ولد',
  girl: 'بنت',
};

// Mirrors the column order of public.children (migration 0010)
export interface Child {
  id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  qr_code: string | null;
  name: string;
  gender: Gender | null;
  birthdate: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  attendance_count: number;
  points: number;
  image_url: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// Egypt phone: displayed prefix +2 followed by exactly 11 digits (e.g. 01xxxxxxxxx)
export const PHONE_PREFIX = '+2';
export const PHONE_LOCAL_LENGTH = 11;

// ---------- Log tables ----------

export interface AttendanceLog {
  id: string;
  child_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  action: 'add' | 'remove';
  points_delta: number;
  recorded_by: string | null;
  created_at: string;
}

export interface PointsLog {
  id: string;
  child_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  delta: number; // positive = add, negative = subtract
  recorded_by: string | null;
  created_at: string;
}

// ---------- Jobs (app-code constants, not stored in DB) ----------
// Jobs are the actions a servant performs on children from the children page.

export type Job = 'attendance' | 'call' | 'message' | 'points';

export const JOBS: { value: Job; label: string }[] = [
  { value: 'attendance', label: 'الحضور' },
  { value: 'call', label: 'الاتصال' },
  { value: 'message', label: 'الرسائل' },
  { value: 'points', label: 'النقاط' },
];

export const DEFAULT_ATTENDANCE_POINTS = 5;

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
  suspended: 'موقوف',
};

// Upload a photo to the public 'photos' bucket and return its public URL
export const PHOTOS_BUCKET = 'photos';

// user_id -> synthetic email used for Supabase auth
export const userIdToEmail = (userId: string) =>
  `${userId.trim().toLowerCase()}@diocese.app`;
