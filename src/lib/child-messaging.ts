'use client';

// ---------- Child portal — messaging & notifications data layer ----------
// All calls are anon RPCs keyed by the scanned national id (migration 0029 §16).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationKind, ConversationMode, NotificationKind } from '@/lib/messaging-types';

export interface ChildNotification {
  id: string; title: string; body: string | null; kind: NotificationKind; icon: string | null; color: string | null;
  link: string | null; data: Record<string, unknown>; source: string; read_at: string | null; created_at: string; sender_name: string | null;
}

export interface ChildConversation {
  id: string; kind: ConversationKind; mode: ConversationMode; subject: string | null;
  church_id: string | null; service_id: string | null; class_id: string | null; enrollment_id: string | null;
  title: string; class_name: string | null; service_name: string | null; church_name: string | null; image_url: string | null;
  last_message_at: string | null; last_message_preview: string | null; last_sender_type: string | null;
  messages_count: number; can_reply: boolean; unread: number;
}

export interface ChildMessage {
  id: string; sender_type: 'servant' | 'child' | 'system'; mine: boolean; sender_name: string; sender_photo: string | null;
  body: string | null; attachment_url: string | null; kind: 'text' | 'image' | 'system'; via: string | null; created_at: string; deleted: boolean;
}

export interface ChildThread {
  conversation: { id: string; kind: ConversationKind; mode: ConversationMode; subject: string | null; can_reply: boolean; title: string };
  messages: ChildMessage[];
}

export interface ChildMsgBadge { unread_notifications: number; unread_messages: number; module_granted: boolean }

const CHILD_ERRORS: [string, string][] = [
  ['read_only', 'هذه المحادثة للقراءة فقط'],
  ['one_way', 'هذه المحادثة للإعلانات فقط'],
  ['cannot_start', 'بدء محادثة جديدة غير متاح حالياً — انتظر رسالة من خدامك'],
  ['empty_body', 'اكتب رسالة أولاً'],
  ['too_long', 'الرسالة طويلة جداً'],
  ['module_not_granted', 'الرسائل غير مفعّلة لفصلك'],
  ['forbidden', 'لا يمكنك الوصول لهذه المحادثة'],
  ['not_found', 'غير موجود'],
];

export function childMsgError(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  for (const [k, v] of CHILD_ERRORS) if (msg.includes(k)) return v;
  return fallback;
}

export async function fetchChildBadge(supabase: SupabaseClient, token: string): Promise<ChildMsgBadge> {
  const { data, error } = await supabase.rpc('child_portal_badge', { p_national_id: token });
  if (error) throw error;
  return (data ?? { unread_notifications: 0, unread_messages: 0, module_granted: false }) as ChildMsgBadge;
}

export async function fetchChildNotifications(supabase: SupabaseClient, token: string, limit = 100): Promise<ChildNotification[]> {
  const { data, error } = await supabase.rpc('child_portal_notifications', { p_national_id: token, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ChildNotification[];
}

export async function markChildNotificationsRead(supabase: SupabaseClient, token: string, ids: string[] | null = null): Promise<number> {
  const { data, error } = await supabase.rpc('child_portal_notifications_read', { p_national_id: token, p_ids: ids });
  if (error) throw error;
  return (data ?? 0) as number;
}

export async function fetchChildConversations(supabase: SupabaseClient, token: string): Promise<ChildConversation[]> {
  const { data, error } = await supabase.rpc('child_portal_conversations', { p_national_id: token });
  if (error) throw error;
  return (data ?? []) as ChildConversation[];
}

/** Also marks the thread as read on the server. */
export async function fetchChildThread(supabase: SupabaseClient, token: string, conversationId: string, limit = 200): Promise<ChildThread> {
  const { data, error } = await supabase.rpc('child_portal_messages', { p_national_id: token, p_conversation: conversationId, p_limit: limit });
  if (error) throw error;
  return data as ChildThread;
}

export async function sendChildMessage(supabase: SupabaseClient, token: string, conversationId: string, body: string, attachmentUrl: string | null = null): Promise<string> {
  const { data, error } = await supabase.rpc('child_portal_send', { p_national_id: token, p_conversation: conversationId, p_body: body, p_attachment_url: attachmentUrl });
  if (error) throw error;
  return data as string;
}

export async function openChildDirect(supabase: SupabaseClient, token: string, enrollmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('child_portal_open_direct', { p_national_id: token, p_enrollment: enrollmentId });
  if (error) throw error;
  return data as string;
}
