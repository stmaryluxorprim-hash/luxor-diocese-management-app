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

export type Gender = 'male' | 'female';

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'ذكر',
  female: 'أنثى',
};

// ---------- PERSON-CENTRIC MODEL (migration 0011) ----------

// persons — the central identity table.
// national_id IS the QR code, unique per person.
export interface Person {
  id: string;
  national_id: string;
  name: string;
  birthdate: string | null;
  gender: Gender | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  image_url: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// enrollments — a person bound to church + service + class.
// One person may have MANY enrollments. Attendance & points live here.
export interface Enrollment {
  id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  attendance_count: number;
  points: number;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// Enrollment joined with its person (the shape most pages work with)
export interface EnrollmentWithPerson extends Enrollment {
  person: Person;
}

// Result of the add_person_and_enroll RPC
export interface AddPersonResult {
  person_id: string;
  enrollment_id: string;
  national_id: string;
  person_created: boolean;
  already_enrolled: boolean;
}

// Egypt phone: displayed prefix +2 followed by exactly 11 digits (e.g. 01xxxxxxxxx)
export const PHONE_PREFIX = '+2';
export const PHONE_LOCAL_LENGTH = 11;

// ---------- Events & Causes (migrations 0013 + 0014) ----------

// Recurrence: 'once' (has event_date) or 'weekly' (weekdays[]).
// One weekday = every week; several = week days.
export type EventRecurrence = 'once' | 'weekly';

export const RECURRENCE_LABELS: Record<EventRecurrence, string> = {
  once: 'مرة واحدة',
  weekly: 'أسبوعياً',
};

// events — something attendable, bound to a scope:
//   service_id null => ALL services of the church (class null too)
//   class_id  null => ALL classes of the (church, service)
// Attendance is registered AGAINST an event and grants `points`.
export interface AppEvent {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  description: string | null;
  recurrence: EventRecurrence;
  event_date: string | null; // when recurrence = once
  weekdays: number[] | null; // 0=Sunday..6=Saturday, when recurrence = weekly
  start_time: string | null; // 'HH:MM:SS' Africa/Cairo
  end_time: string | null; // 'HH:MM:SS' Africa/Cairo
  points: number; // points granted per attendance
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// causes — the reason points are given/taken, bound to church / service / class.
// (same null = "all" scope semantics as events) with a bound points amount.
export interface Cause {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  description: string | null;
  points: number; // points amount bound to this cause
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// Does an event/cause scope apply to an enrollment's scope?
export const scopeApplies = (
  x: { church_id: string; service_id: string | null; class_id: string | null },
  e: { church_id: string; service_id: string; class_id: string }
): boolean =>
  x.church_id === e.church_id &&
  (x.service_id === null || x.service_id === e.service_id) &&
  (x.class_id === null || x.class_id === e.class_id);

// ---------- Log tables ----------

// enrollment_id already identifies church / service / class.
// Attendance rows record WHICH EVENT was attended; removing attendance
// DELETES the row (a DB trigger reverts the counters).
export interface AttendanceLog {
  id: string;
  enrollment_id: string;
  event_id: string | null; // null on legacy rows only
  points_delta: number;
  attended_on: string; // 'YYYY-MM-DD' in Africa/Cairo — unique per event per day
  recorded_by: string | null;
  created_at: string;
}

export interface PointsLog {
  id: string;
  enrollment_id: string;
  cause_id: string | null; // why the points changed (null on legacy rows)
  delta: number; // positive = add, negative = subtract
  recorded_by: string | null;
  created_at: string;
}

// ---------- Jobs (app-code constants, not stored in DB) ----------
// Jobs are the actions a servant performs on persons from the persons page.

export type Job = 'attendance' | 'call' | 'message' | 'points';

export const JOBS: { value: Job; label: string }[] = [
  { value: 'attendance', label: 'الحضور' },
  { value: 'call', label: 'الاتصال' },
  { value: 'message', label: 'الرسائل' },
  { value: 'points', label: 'النقاط' },
];

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
