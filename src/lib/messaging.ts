'use client';

// ---------- Messaging & notifications module — client data layer ----------
// Everything goes through SECURITY DEFINER RPCs from migration 0029 (scope +
// module visibility checked in SQL). Direct table reads (templates, automations,
// deliveries, queue, settings) rely on RLS.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ALL, type ScopeSelection } from '@/lib/queries';
import type {
  AppNotification, InboxRow, Message, Automation, AutomationInput, Campaign, Delivery, QueueItem,
  MessageTemplate, MessagingSettings, Badge, AudiencePreview, SendResult, Audience, Channel, NotificationKind,
  ConversationMode, AudienceFilter,
} from '@/lib/messaging-types';

// ---------- error mapping ----------
export const MIGRATION_HINT = 'تحتاج تشغيل تحديث قاعدة البيانات 0029_messaging.sql في Supabase أولاً';

export function isMigrationMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /messag|notification|conversation|outbound_queue|msg_|child_portal_(notif|conv|mess|send|badge)/.test(msg) &&
    /does not exist|not find|schema cache|relation/i.test(msg);
}

const ERRORS: [string, string][] = [
  ['module_not_visible', 'وحدة الرسائل غير مفعّلة لنطاقك'],
  ['empty_body', 'نص الرسالة فارغ'],
  ['no_channels', 'اختر قناة إرسال واحدة على الأقل'],
  ['invalid_audience', 'الجمهور غير صالح'],
  ['invalid_mode', 'نوع المحادثة غير صالح'],
  ['church_required', 'اختر الكنيسة أولاً'],
  ['enrollment_not_found', 'المخدوم غير موجود'],
  ['profile_not_found', 'الخادم غير موجود'],
  ['conversation_not_found', 'المحادثة غير موجودة'],
  ['conversation_archived', 'المحادثة مؤرشفة'],
  ['read_only', 'هذه المحادثة للإعلانات فقط ولا تقبل الردود'],
  ['cannot_start', 'بدء المحادثات من المخدومين غير مفعّل'],
  ['too_long', 'الرسالة طويلة جداً'],
  ['self', 'لا يمكن بدء محادثة مع نفسك'],
  ['invalid_status', 'الحالة غير صالحة'],
  ['not_found', 'العنصر غير موجود'],
  ['forbidden', 'ليس لديك صلاحية على هذه العملية'],
];

export function messagingErrorMessage(err: unknown, fallback = 'حدث خطأ، حاول مجدداً'): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (!msg) return fallback;
  if (isMigrationMissing(err)) return MIGRATION_HINT;
  for (const [key, label] of ERRORS) if (msg.includes(key)) return label;
  return fallback;
}

// ---------- helpers ----------
export const scopeArgs = (scope: ScopeSelection) => ({
  p_church: scope.church && scope.church !== ALL ? scope.church : null,
  p_service: scope.service && scope.service !== ALL ? scope.service : null,
  p_class: scope.class && scope.class !== ALL ? scope.class : null,
});

export const waNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `2${digits}` : digits;
};
export const waLink = (phone: string, text: string) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
export const smsLink = (phone: string, text: string) => `sms:${phone.replace(/\s/g, '')}?body=${encodeURIComponent(text)}`;

/** Client-side preview of [variables] using a sample context (server does the real render). */
export function renderPreview(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\[([^\]]+)\]/g, (m, k: string) => (k in ctx ? ctx[k] : m));
}
export const SAMPLE_CHILD_CTX: Record<string, string> = {
  'الاسم': 'مينا', 'الاسم الأول': 'مينا', 'الاسم الكامل': 'مينا جورج فهمي', 'ضمير': '', 'السن': '10', 'تاريخ الميلاد': '12/05/2015',
  'رقم الهاتف': '01001234567', 'اسم الفصل': 'رابعة ابتدائي', 'اسم الخدمة': 'مدارس الأحد', 'اسم الكنيسة': 'كنيسة العذراء',
  'النقاط': '120', 'عدد الحضور': '18', 'آخر حضور': '05/09/2026', 'أيام الغياب': '3', 'التاريخ': '08/09/2026', 'اليوم': 'الثلاثاء', 'الوقت': '09:00',
  'اسم الخادم': 'أبانوب', 'اسم المستلم': 'مينا', 'الدور': 'خادم فصل',
};

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso); const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
  if (diff < 86400 * 7) return `منذ ${Math.floor(diff / 86400)} يوم`;
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
}

// ---------- badge / notifications ----------
export async function fetchBadge(supabase: SupabaseClient): Promise<Badge> {
  const { data, error } = await supabase.rpc('msg_badge');
  if (error) throw error;
  return (data ?? { unread_notifications: 0, unread_messages: 0, pending_queue: 0, module_visible: false }) as Badge;
}

export async function fetchNotifications(supabase: SupabaseClient, limit = 100, unreadOnly = false): Promise<AppNotification[]> {
  let q = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  if (unreadOnly) q = q.is('read_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function markNotificationsRead(supabase: SupabaseClient, ids: string[] | null = null): Promise<number> {
  const { data, error } = await supabase.rpc('msg_notifications_read', { p_ids: ids });
  if (error) throw error;
  return (data ?? 0) as number;
}

// ---------- conversations ----------
export async function fetchInbox(supabase: SupabaseClient, kind: string | null = null, limit = 200): Promise<InboxRow[]> {
  const { data, error } = await supabase.rpc('msg_inbox', { p_limit: limit, p_kind: kind });
  if (error) throw error;
  return (data ?? []) as InboxRow[];
}

export async function fetchMessages(supabase: SupabaseClient, conversationId: string, limit = 300): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*, sender:profiles!messages_sender_profile_id_fkey(full_name, photo_url), person:persons!messages_sender_person_id_fkey(name, image_url)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  type Raw = Message & { sender?: { full_name: string; photo_url: string | null } | null; person?: { name: string; image_url: string | null } | null };
  return ((data ?? []) as Raw[]).map(({ sender, person, ...m }) => ({
    ...m,
    sender_name: m.sender_type === 'child' ? person?.name ?? null : m.sender_type === 'servant' ? sender?.full_name ?? null : null,
    sender_photo: m.sender_type === 'child' ? person?.image_url ?? null : sender?.photo_url ?? null,
  }));
}

export async function postMessage(supabase: SupabaseClient, conversationId: string, body: string, attachmentUrl: string | null = null): Promise<string> {
  const { data, error } = await supabase.rpc('msg_post', { p_conversation: conversationId, p_body: body, p_attachment_url: attachmentUrl });
  if (error) throw error;
  return data as string;
}

export async function markConversationRead(supabase: SupabaseClient, conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('msg_mark_read', { p_conversation: conversationId });
  if (error) throw error;
}

export async function openDirect(supabase: SupabaseClient, enrollmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('msg_open_direct', { p_enrollment: enrollmentId });
  if (error) throw error;
  return data as string;
}

export async function openStaff(supabase: SupabaseClient, profileId: string): Promise<string> {
  const { data, error } = await supabase.rpc('msg_open_staff', { p_profile: profileId });
  if (error) throw error;
  return data as string;
}

export async function createGroup(
  supabase: SupabaseClient,
  args: { subject: string; mode: ConversationMode; scope: ScopeSelection; filter?: AudienceFilter; firstMessage?: string | null },
): Promise<{ id: string; members: number }> {
  const { data, error } = await supabase.rpc('msg_create_group', {
    p_subject: args.subject, p_mode: args.mode, ...scopeArgs(args.scope),
    p_filter: args.filter ?? {}, p_first_message: args.firstMessage ?? null,
  });
  if (error) throw error;
  return data as { id: string; members: number };
}

export async function setConversationArchived(supabase: SupabaseClient, id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from('conversations').update({ is_archived: archived }).eq('id', id);
  if (error) throw error;
}

export async function setConversationMode(supabase: SupabaseClient, id: string, mode: ConversationMode): Promise<void> {
  const { error } = await supabase.from('conversations').update({ mode }).eq('id', id);
  if (error) throw error;
}

// ---------- bulk send ----------
export async function previewAudience(
  supabase: SupabaseClient, scope: ScopeSelection, audience: Audience, filter: AudienceFilter = {},
): Promise<AudiencePreview> {
  const { data, error } = await supabase.rpc('msg_audience_preview', { ...scopeArgs(scope), p_audience: audience, p_filter: filter });
  if (error) throw error;
  return data as AudiencePreview;
}

export async function sendBulk(
  supabase: SupabaseClient,
  args: {
    scope: ScopeSelection; audience: Audience; filter?: AudienceFilter; channels: Channel[];
    title: string | null; body: string; kind?: NotificationKind; link?: string | null; name?: string | null; respectQuiet?: boolean;
  },
): Promise<SendResult> {
  const { data, error } = await supabase.rpc('msg_send', {
    ...scopeArgs(args.scope), p_audience: args.audience, p_filter: args.filter ?? {}, p_channels: args.channels,
    p_title: args.title || null, p_body: args.body, p_kind: args.kind ?? 'info', p_link: args.link ?? null,
    p_name: args.name ?? null, p_respect_quiet: args.respectQuiet ?? true,
  });
  if (error) throw error;
  return data as SendResult;
}

export async function fetchCampaigns(supabase: SupabaseClient, limit = 100): Promise<Campaign[]> {
  const { data, error } = await supabase.from('message_campaigns').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

// ---------- automations ----------
export async function fetchAutomations(supabase: SupabaseClient): Promise<Automation[]> {
  const { data, error } = await supabase.from('message_automations').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Automation[];
}

export async function saveAutomation(supabase: SupabaseClient, input: AutomationInput, id?: string): Promise<Automation> {
  const row = { ...input, title: input.title || null, link: input.link || null, icon: input.icon || null, color: input.color || null };
  const q = id
    ? supabase.from('message_automations').update(row).eq('id', id)
    : supabase.from('message_automations').insert(row);
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  return data as Automation;
}

export async function toggleAutomation(supabase: SupabaseClient, id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('message_automations').update({ is_active: active }).eq('id', id);
  if (error) throw error;
}

export async function deleteAutomation(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('message_automations').delete().eq('id', id);
  if (error) throw error;
}

export async function runAutomationNow(supabase: SupabaseClient, id: string): Promise<{ sent: number; total: number }> {
  const { data, error } = await supabase.rpc('msg_run_now', { p_automation: id });
  if (error) throw error;
  return data as { sent: number; total: number };
}

export async function previewTemplate(
  supabase: SupabaseClient, title: string | null, body: string, enrollmentId: string | null = null,
): Promise<{ title: string | null; body: string; sample: string | null }> {
  const { data, error } = await supabase.rpc('msg_preview_template', { p_title: title, p_body: body, p_enrollment: enrollmentId });
  if (error) throw error;
  return data as { title: string | null; body: string; sample: string | null };
}

export async function runTick(supabase: SupabaseClient, force = false): Promise<unknown> {
  const { data, error } = await supabase.rpc('messaging_tick', { p_force: force });
  if (error) throw error;
  return data;
}

// ---------- deliveries / queue ----------
export async function fetchDeliveries(supabase: SupabaseClient, limit = 200, filter?: { automation_id?: string; campaign_id?: string }): Promise<Delivery[]> {
  let q = supabase.from('message_deliveries').select('*').order('created_at', { ascending: false }).limit(limit);
  if (filter?.automation_id) q = q.eq('automation_id', filter.automation_id);
  if (filter?.campaign_id) q = q.eq('campaign_id', filter.campaign_id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Delivery[];
}

export async function fetchQueue(supabase: SupabaseClient, status: string | null = 'pending', limit = 300): Promise<QueueItem[]> {
  let q = supabase.from('outbound_queue').select('*').order('created_at', { ascending: false }).limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as QueueItem[];
}

export async function markQueue(supabase: SupabaseClient, ids: string[], status: 'sent' | 'failed' | 'cancelled' | 'pending'): Promise<number> {
  const { data, error } = await supabase.rpc('msg_queue_mark', { p_ids: ids, p_status: status });
  if (error) throw error;
  return (data ?? 0) as number;
}

// ---------- templates ----------
export async function fetchTemplates(supabase: SupabaseClient): Promise<MessageTemplate[]> {
  const { data, error } = await supabase.from('message_templates').select('*').order('category').order('name');
  if (error) throw error;
  return (data ?? []) as MessageTemplate[];
}

export async function saveTemplate(
  supabase: SupabaseClient,
  input: Pick<MessageTemplate, 'name' | 'category' | 'title' | 'body' | 'church_id' | 'service_id' | 'class_id'>, id?: string,
): Promise<MessageTemplate> {
  const q = id ? supabase.from('message_templates').update(input).eq('id', id) : supabase.from('message_templates').insert(input);
  const { data, error } = await q.select('*').single();
  if (error) throw error;
  return data as MessageTemplate;
}

export async function deleteTemplate(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('message_templates').delete().eq('id', id);
  if (error) throw error;
}

// ---------- settings ----------
export async function fetchSettings(supabase: SupabaseClient): Promise<MessagingSettings[]> {
  const { data, error } = await supabase.from('messaging_settings').select('*');
  if (error) throw error;
  return (data ?? []) as MessagingSettings[];
}

export function effectiveSettings(rows: MessagingSettings[], churchId: string | null): MessagingSettings {
  const own = churchId ? rows.find((r) => r.church_id === churchId) : undefined;
  const global = rows.find((r) => r.church_id === null);
  return own ?? global ?? {
    id: '', church_id: churchId, children_can_reply: true, children_can_start: false,
    quiet_hours_start: '22:00', quiet_hours_end: '08:00', default_channels: ['in_app'],
    signature: null, webhook_url: null, last_scheduler_run: null, edited_at: '', edited_by: null,
  };
}

export async function saveSettings(
  supabase: SupabaseClient,
  churchId: string | null,
  patch: Partial<Pick<MessagingSettings, 'children_can_reply' | 'children_can_start' | 'quiet_hours_start' | 'quiet_hours_end' | 'default_channels' | 'signature' | 'webhook_url'>>,
): Promise<void> {
  // unique key is an expression index (coalesce(church_id, zero-uuid)) → select then insert/update
  let q = supabase.from('messaging_settings').select('id');
  q = churchId ? q.eq('church_id', churchId) : q.is('church_id', null);
  const { data: existing, error: e1 } = await q.maybeSingle();
  if (e1) throw e1;
  const { error } = existing
    ? await supabase.from('messaging_settings').update(patch).eq('id', existing.id)
    : await supabase.from('messaging_settings').insert({ church_id: churchId, ...patch });
  if (error) throw error;
}

// ---------- browser notifications ----------
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

export function showBrowserNotification(title: string, body: string | null, link: string | null) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body: body ?? undefined, icon: '/icons/icon-192.png', dir: 'rtl', lang: 'ar' });
    n.onclick = () => { window.focus(); if (link) window.location.href = link; n.close(); };
  } catch { /* ignore */ }
}
