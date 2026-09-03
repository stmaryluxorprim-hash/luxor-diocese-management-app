'use client';

// ---------- Child portal (بوابة المخدوم) — client data layer ----------
// The child has no auth account. His card QR (= persons.national_id) is the
// bearer token: it is kept in localStorage and passed to every
// `child_portal_*` RPC (migration 0021). The RPCs are SECURITY DEFINER and
// return only that person's rows, so the anon key is enough.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Gender } from '@/lib/types';

export const CHILD_TOKEN_KEY = 'child_portal_token';

// ---------- Types returned by the RPCs ----------
export interface ChildPerson {
  id: string;
  national_id: string;
  name: string;
  birthdate: string | null;
  gender: Gender | null;
  phone: string | null;
  address: string | null;
  image_url: string | null;
  created_at: string;
}

export interface ChildEnrollment {
  id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  attendance_count: number;
  points: number;
  created_at: string;
  church_name: string;
  church_logo: string | null;
  service_name: string;
  service_photo: string | null;
  class_name: string;
  class_photo: string | null;
}

export interface ChildProfile {
  person: ChildPerson;
  enrollments: ChildEnrollment[];
}

export interface ChildAttendanceRow {
  id: string;
  enrollment_id: string;
  event_id: string | null;
  event_name: string | null;
  points_delta: number;
  attended_on: string; // YYYY-MM-DD (Cairo)
  created_at: string;
  recorded_by_name: string | null;
  class_name: string;
  service_name: string;
  church_name: string;
}

export interface ChildPointsRow {
  id: string;
  enrollment_id: string;
  source: 'cause' | 'attendance';
  reason: string | null;
  delta: number;
  created_at: string;
  recorded_by_name: string | null;
  class_name: string;
  service_name: string;
  church_name: string;
}

export type RequestKind = 'data' | 'photo';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface DataChangeRequest {
  id: string;
  person_id: string;
  kind: RequestKind;
  changes: Record<string, string | null>;
  previous: Record<string, string | null>;
  note: string | null;
  status: RequestStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'تمت الموافقة',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
};

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  data: 'تعديل البيانات',
  photo: 'تغيير الصورة',
};

export const FIELD_LABELS: Record<string, string> = {
  name: 'الاسم',
  birthdate: 'تاريخ الميلاد',
  gender: 'النوع',
  phone: 'الهاتف',
  address: 'العنوان',
  image_url: 'الصورة',
};

// ---------- Token (localStorage) ----------
export function getChildToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(CHILD_TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setChildToken(token: string) {
  try {
    window.localStorage.setItem(CHILD_TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
}
export function clearChildToken() {
  try {
    window.localStorage.removeItem(CHILD_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- Error mapping (RPC raise -> Arabic) ----------
const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: 'الكود غير صالح',
  unknown_code: 'هذا الكود غير مسجل — تأكد من كارت المخدوم',
  invalid_kind: 'نوع الطلب غير صالح',
  pending_exists: 'لديك طلب قيد المراجعة بالفعل — انتظر الرد عليه أو ألغِه أولاً',
  invalid_changes: 'البيانات المدخلة غير صالحة',
  no_changes: 'لم تغيّر أي بيانات',
  not_pending: 'هذا الطلب لم يعد قيد المراجعة',
  not_found: 'الطلب غير موجود',
  forbidden: 'ليس لديك صلاحية على هذا الطلب',
};

export function childErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  for (const key of Object.keys(ERROR_MESSAGES)) {
    if (msg.includes(key)) return ERROR_MESSAGES[key];
  }
  return fallback;
}

// ---------- Fetchers ----------
export async function fetchChildProfile(supabase: SupabaseClient, token: string): Promise<ChildProfile> {
  const { data, error } = await supabase.rpc('child_portal_profile', { p_national_id: token });
  if (error) throw error;
  return data as ChildProfile;
}

export async function fetchChildAttendance(supabase: SupabaseClient, token: string): Promise<ChildAttendanceRow[]> {
  const { data, error } = await supabase.rpc('child_portal_attendance', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as ChildAttendanceRow[];
}

export async function fetchChildPoints(supabase: SupabaseClient, token: string): Promise<ChildPointsRow[]> {
  const { data, error } = await supabase.rpc('child_portal_points', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as ChildPointsRow[];
}

export async function fetchChildRequests(supabase: SupabaseClient, token: string): Promise<DataChangeRequest[]> {
  const { data, error } = await supabase.rpc('child_portal_requests', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as DataChangeRequest[];
}

export async function submitChildRequest(
  supabase: SupabaseClient,
  token: string,
  kind: RequestKind,
  changes: Record<string, string | null>,
  note?: string
): Promise<DataChangeRequest> {
  const { data, error } = await supabase.rpc('child_portal_submit_request', {
    p_national_id: token,
    p_kind: kind,
    p_changes: changes,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as DataChangeRequest;
}

export async function cancelChildRequest(
  supabase: SupabaseClient,
  token: string,
  requestId: string
): Promise<DataChangeRequest> {
  const { data, error } = await supabase.rpc('child_portal_cancel_request', {
    p_national_id: token,
    p_request: requestId,
  });
  if (error) throw error;
  return data as DataChangeRequest;
}

// ---------- Small helpers ----------
export function ageFromBirthdate(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
