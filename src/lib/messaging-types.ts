// ---------- Messaging module — enums & row types ----------
export type NotificationKind = 'info' | 'success' | 'warning' | 'celebration' | 'reminder' | 'alert' | 'message';
export type Channel = 'in_app' | 'chat' | 'whatsapp' | 'sms';
export type Audience = 'children' | 'servants' | 'both';
export type ConversationKind = 'direct' | 'staff' | 'group';
export type ConversationMode = 'two_way' | 'one_way';
export type AutomationTrigger =
  | 'birthday' | 'schedule' | 'absent' | 'inactive' | 'event_reminder'
  | 'attendance' | 'points' | 'new_enrollment' | 'exam_result' | 'store_order' | 'data_request';
export type DeliveryStatus = 'pending' | 'deferred' | 'sent' | 'queued' | 'skipped' | 'failed';
export type QueueStatus = 'pending' | 'sent' | 'failed' | 'cancelled';
export type TemplateCategory = 'general' | 'birthday' | 'absent' | 'welcome' | 'reminder' | 'points' | 'exam' | 'announcement';

export interface AppNotification {
  id: string; recipient_profile_id: string | null; recipient_person_id: string | null; enrollment_id: string | null;
  church_id: string | null; service_id: string | null; class_id: string | null;
  title: string; body: string | null; kind: NotificationKind; icon: string | null; color: string | null; link: string | null;
  data: Record<string, unknown>; source: 'manual' | 'automation' | 'campaign' | 'system';
  automation_id: string | null; campaign_id: string | null; sender_id: string | null;
  read_at: string | null; created_at: string;
}
export interface InboxRow {
  id: string; kind: ConversationKind; mode: ConversationMode; subject: string | null;
  church_id: string | null; service_id: string | null; class_id: string | null;
  person_id: string | null; enrollment_id: string | null; created_by: string | null;
  last_message_at: string | null; last_message_preview: string | null; last_sender_type: string | null;
  messages_count: number; is_archived: boolean;
  title: string | null; image_url: string | null; phone: string | null; class_name: string | null;
  unread: number; members_count: number;
}
export interface Message {
  id: string; conversation_id: string; sender_type: 'servant' | 'child' | 'system';
  sender_profile_id: string | null; sender_person_id: string | null;
  body: string | null; attachment_url: string | null; kind: 'text' | 'image' | 'system'; via: 'automation' | 'campaign' | null;
  created_at: string; edited_at: string | null; deleted_at: string | null;
  sender_name?: string | null; sender_photo?: string | null;
}
export interface TriggerConfig {
  at?: string; days_before?: number;
  repeat?: 'once' | 'daily' | 'weekly' | 'monthly'; date?: string; weekdays?: number[]; day_of_month?: number;
  event_id?: string; consecutive?: number; hours_after?: number; days?: number; minutes_before?: number;
  direction?: 'any' | 'add' | 'subtract'; min_abs?: number; milestone?: number;
  only?: 'any' | 'passed' | 'failed' | 'approved' | 'rejected';
}
export interface AudienceFilter {
  gender?: '' | 'male' | 'female'; has_phone?: boolean; min_age?: number | ''; max_age?: number | '';
  enrollment_ids?: string[]; shepherd_of?: string; roles?: string[]; profile_ids?: string[]; exclude_self?: boolean;
}
export interface Automation {
  id: string; church_id: string | null; service_id: string | null; class_id: string | null;
  name: string; description: string | null; is_active: boolean;
  trigger: AutomationTrigger; trigger_config: TriggerConfig; audience: Audience; audience_filter: AudienceFilter;
  channels: Channel[]; title: string | null; body: string; kind: NotificationKind; icon: string | null; color: string | null; link: string | null;
  respect_quiet_hours: boolean; cooldown_hours: number; starts_at: string; ends_at: string | null;
  last_run_at: string | null; run_count: number; sent_count: number;
  created_at: string; created_by: string | null; edited_at: string; edited_by: string | null;
}
export type AutomationInput = Omit<Automation, 'id' | 'last_run_at' | 'run_count' | 'sent_count' | 'created_at' | 'created_by' | 'edited_at' | 'edited_by'>;
export interface Campaign {
  id: string; church_id: string | null; service_id: string | null; class_id: string | null;
  name: string; audience: Audience; audience_filter: AudienceFilter; channels: Channel[];
  title: string | null; body: string; kind: NotificationKind; link: string | null;
  recipients_count: number; sent_count: number; queued_count: number; skipped_count: number; created_at: string; created_by: string | null;
}
export interface Delivery {
  id: string; automation_id: string | null; campaign_id: string | null; person_id: string | null; profile_id: string | null; enrollment_id: string | null;
  church_id: string | null; service_id: string | null; class_id: string | null;
  dedupe_key: string; channels: Channel[]; title: string | null; body: string; kind: NotificationKind; link: string | null;
  extra: Record<string, unknown>; status: DeliveryStatus; result: Record<string, string>;
  deliver_at: string | null; error: string | null; created_at: string; delivered_at: string | null;
}
export interface QueueItem {
  id: string; delivery_id: string | null; automation_id: string | null; campaign_id: string | null; person_id: string | null; profile_id: string | null;
  church_id: string | null; service_id: string | null; class_id: string | null;
  channel: 'whatsapp' | 'sms'; phone: string; recipient_name: string; body: string;
  status: QueueStatus; sent_by: string | null; sent_at: string | null; provider_ref: string | null; created_at: string;
}
export interface MessageTemplate {
  id: string; church_id: string | null; service_id: string | null; class_id: string | null;
  name: string; category: TemplateCategory; title: string | null; body: string;
  created_at: string; created_by: string | null; edited_at: string; edited_by: string | null;
}
export interface MessagingSettings {
  id: string; church_id: string | null; children_can_reply: boolean; children_can_start: boolean;
  quiet_hours_start: string | null; quiet_hours_end: string | null; default_channels: Channel[];
  signature: string | null; webhook_url: string | null; last_scheduler_run: string | null; edited_at: string; edited_by: string | null;
}
export interface Badge { unread_notifications: number; unread_messages: number; pending_queue: number; module_visible: boolean }
export interface AudiencePreview {
  children_count: number; children_with_phone: number; servants_count: number;
  children: { enrollment_id: string; person_id: string; name: string; phone: string | null; image_url: string | null }[];
  servants: { profile_id: string; name: string; phone: string | null; role: string; photo_url: string | null }[];
}
export interface SendResult { campaign_id: string; recipients: number; sent: number; queued: number; deferred: number; skipped: number }
