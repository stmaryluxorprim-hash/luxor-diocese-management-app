-- =====================================================================
-- 0029: MESSAGING & NOTIFICATIONS MODULE — الرسائل والإشعارات
--
-- One professional communication hub for the diocese:
--
--   • NOTIFICATIONS (إشعارات) — one-way notices to CHILDREN (بوابة
--     المخدوم) and/or SERVANTS, with title, body, icon/color, optional
--     link. Sent manually to a scope / a hand-picked list, by a CAMPAIGN,
--     by an AUTOMATION or by the system. Read state per recipient.
--   • CONVERSATIONS (محادثات) — two-way or one-way (announcement) chats:
--       direct : servants of a scope ↔ ONE child (team inbox — every
--                servant covering the child's enrollment can read/reply)
--       staff  : servant ↔ servant
--       group  : servant → many children (one_way = announcement channel,
--                two_way = group chat)
--     Messages are realtime; children read/write through anon RPCs keyed
--     by their QR (same model as 0021).
--   • AUTOMATIONS (الرسائل التلقائية) — PROGRAMMABLE rules the servant
--     configures from the UI: trigger + audience + channels + template.
--       time-based   : birthday (N days before, at HH:MM) · schedule
--                      (once / daily / weekly / monthly) · absent (missed
--                      an event occurrence, K consecutive) · inactive (no
--                      attendance for N days) · event_reminder (M minutes
--                      before an event starts)
--       event-based  : attendance recorded · points changed / milestone ·
--                      new enrollment (welcome) · exam result · store
--                      order · data request reviewed
--     Templates use [variables] rendered per recipient in SQL.
--     Channels: in_app (notification) · chat (message in the direct
--     conversation) · whatsapp / sms (rows in an OUTBOUND QUEUE the
--     servants send from their phone with a one-tap stepper, or an
--     optional webhook provider drains it).
--   • CAMPAIGNS (إرسال جماعي) — one bulk send to a scope with the same
--     rendering & channels; every recipient is logged.
--   • DELIVERY LOG — every dispatched item (who / what / channel /
--     status) with a dedupe key so nobody is ever messaged twice for the
--     same reason. Quiet hours defer deliveries to the morning.
--   • SCHEDULER — `messaging_tick()` (cheap, throttled, advisory-locked)
--     is called by the app on load / every few minutes and by the cron
--     API route; pg_cron is used automatically when the extension exists.
--
-- Idempotent — safe to re-run. Depends on 0019 (my_scope / is_owner /
-- enrollment_visible / scope_overlaps / scope_contains), 0021 (child
-- portal RPCs), 0022 (contact_log), 0024 (module_visible), 0027
-- (module_granted_for, exams), 0026 (store), 0028 (next_birthday).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. SETTINGS (إعدادات الوحدة) — per church + optional global row
-- ---------------------------------------------------------------------
create table if not exists public.messaging_settings (
  id                    uuid primary key default gen_random_uuid(),
  church_id             uuid references public.churches(id) on delete cascade,   -- null = global (owner)
  children_can_reply    boolean not null default true,     -- children may answer in two-way conversations
  children_can_start    boolean not null default true,     -- children may open a conversation with their servants
  quiet_hours_start     time,                              -- e.g. 22:00 (Cairo) — deliveries deferred
  quiet_hours_end       time,                              -- e.g. 08:00
  default_channels      text[] not null default array['in_app']::text[],
  signature             text,                              -- appended to whatsapp / sms texts
  webhook_url           text,                              -- optional provider that drains the outbound queue
  last_scheduler_run    timestamptz,
  edited_at             timestamptz not null default now(),
  edited_by             uuid references public.profiles(id)
);
create unique index if not exists uq_messaging_settings_church
  on public.messaging_settings (coalesce(church_id, '00000000-0000-0000-0000-000000000000'::uuid));
drop trigger if exists trg_messaging_settings_touch on public.messaging_settings;
create trigger trg_messaging_settings_touch before update on public.messaging_settings
for each row execute function public.touch_edited();

-- ---------------------------------------------------------------------
-- 1. TEMPLATES (قوالب الرسائل) — reusable texts with [variables]
-- ---------------------------------------------------------------------
create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid references public.churches(id) on delete cascade,      -- null = global
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id)  on delete cascade,
  name        text not null,
  category    text not null default 'general'
              check (category in ('general', 'birthday', 'absent', 'welcome', 'reminder', 'points', 'exam', 'announcement')),
  title       text,
  body        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.profiles(id),
  constraint message_templates_scope_chain check (
    not (service_id is not null and church_id is null) and not (class_id is not null and service_id is null))
);
create index if not exists idx_message_templates_church on public.message_templates(church_id, category);
drop trigger if exists trg_message_templates_touch on public.message_templates;
create trigger trg_message_templates_touch before update on public.message_templates
for each row execute function public.touch_edited();

-- ---------------------------------------------------------------------
-- 2. AUTOMATIONS (الرسائل التلقائية) — the programmable rules
-- ---------------------------------------------------------------------
create table if not exists public.message_automations (
  id                   uuid primary key default gen_random_uuid(),
  church_id            uuid references public.churches(id) on delete cascade,   -- null = every church (owner)
  service_id           uuid references public.services(id) on delete cascade,   -- null = all services
  class_id             uuid references public.classes(id)  on delete cascade,   -- null = all classes
  name                 text not null,
  description          text,
  is_active            boolean not null default true,
  trigger              text not null check (trigger in (
                         'birthday', 'schedule', 'absent', 'inactive', 'event_reminder',
                         'attendance', 'points', 'new_enrollment', 'exam_result', 'store_order', 'data_request')),
  trigger_config       jsonb not null default '{}'::jsonb,
  -- who receives it
  audience             text not null default 'children' check (audience in ('children', 'servants', 'both')),
  audience_filter      jsonb not null default '{}'::jsonb,   -- {gender, min_age, max_age, has_phone, roles[]}
  -- what is sent
  channels             text[] not null default array['in_app']::text[]
                       check (channels <@ array['in_app', 'chat', 'whatsapp', 'sms']::text[] and array_length(channels, 1) >= 1),
  title                text,
  body                 text not null,
  kind                 text not null default 'info'
                       check (kind in ('info', 'success', 'warning', 'celebration', 'reminder', 'alert', 'message')),
  icon                 text,                                  -- lucide key (optional)
  color                text,                                  -- hex (optional)
  link                 text,                                  -- in-app path opened from the notification
  -- behaviour
  respect_quiet_hours  boolean not null default true,
  cooldown_hours       integer not null default 0 check (cooldown_hours >= 0),   -- min gap per recipient (0 = dedupe only)
  starts_at            timestamptz not null default now(),
  ends_at              timestamptz,
  -- stats
  last_run_at          timestamptz,
  run_count            integer not null default 0,
  sent_count           integer not null default 0,
  created_at           timestamptz not null default now(),
  created_by           uuid references public.profiles(id),
  edited_at            timestamptz not null default now(),
  edited_by            uuid references public.profiles(id),
  constraint message_automations_scope_chain check (
    not (service_id is not null and church_id is null) and not (class_id is not null and service_id is null))
);
comment on table public.message_automations is
  'الرسائل التلقائية — قاعدة مبرمجة: محفّز + جمهور + قنوات + قالب بمتغيرات؛ تعمل بالمجدول أو بمحفّزات قاعدة البيانات';
create index if not exists idx_message_automations_active on public.message_automations(trigger) where is_active;
create index if not exists idx_message_automations_church on public.message_automations(church_id);
drop trigger if exists trg_message_automations_touch on public.message_automations;
create trigger trg_message_automations_touch before update on public.message_automations
for each row execute function public.touch_edited();

create or replace function public.check_messaging_scope_chain()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_id is not null and not exists (
    select 1 from public.services s where s.id = new.service_id and s.church_id = new.church_id
  ) then raise exception 'service does not belong to the church'; end if;
  if new.class_id is not null and not exists (
    select 1 from public.classes c where c.id = new.class_id and c.service_id = new.service_id and c.church_id = new.church_id
  ) then raise exception 'class does not belong to the service'; end if;
  return new;
end $$;
drop trigger if exists trg_message_automations_scope on public.message_automations;
create trigger trg_message_automations_scope before insert or update on public.message_automations
for each row execute function public.check_messaging_scope_chain();
drop trigger if exists trg_message_templates_scope on public.message_templates;
create trigger trg_message_templates_scope before insert or update on public.message_templates
for each row execute function public.check_messaging_scope_chain();

-- ---------------------------------------------------------------------
-- 3. CAMPAIGNS (إرسال جماعي) — one bulk send, logged
-- ---------------------------------------------------------------------
create table if not exists public.message_campaigns (
  id               uuid primary key default gen_random_uuid(),
  church_id        uuid references public.churches(id) on delete cascade,
  service_id       uuid references public.services(id) on delete cascade,
  class_id         uuid references public.classes(id)  on delete cascade,
  name             text not null,
  audience         text not null default 'children' check (audience in ('children', 'servants', 'both')),
  audience_filter  jsonb not null default '{}'::jsonb,
  channels         text[] not null default array['in_app']::text[],
  title            text,
  body             text not null,
  kind             text not null default 'info',
  link             text,
  recipients_count integer not null default 0,
  sent_count       integer not null default 0,
  queued_count     integer not null default 0,
  skipped_count    integer not null default 0,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id)
);
create index if not exists idx_message_campaigns_created on public.message_campaigns(created_at desc);

-- ---------------------------------------------------------------------
-- 4. NOTIFICATIONS (الإشعارات) — one row per recipient
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id                   uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid references public.profiles(id) on delete cascade,
  recipient_person_id  uuid references public.persons(id)  on delete cascade,
  enrollment_id        uuid references public.enrollments(id) on delete set null,
  -- denormalized scope (for RLS / realtime filters); null for servants without scope
  church_id            uuid references public.churches(id) on delete cascade,
  service_id           uuid references public.services(id) on delete cascade,
  class_id             uuid references public.classes(id)  on delete cascade,
  title                text not null,
  body                 text,
  kind                 text not null default 'info'
                       check (kind in ('info', 'success', 'warning', 'celebration', 'reminder', 'alert', 'message')),
  icon                 text,
  color                text,
  link                 text,
  data                 jsonb not null default '{}'::jsonb,
  source               text not null default 'manual' check (source in ('manual', 'automation', 'campaign', 'system')),
  automation_id        uuid references public.message_automations(id) on delete set null,
  campaign_id          uuid references public.message_campaigns(id) on delete set null,
  sender_id            uuid references public.profiles(id) on delete set null,
  read_at              timestamptz,
  created_at           timestamptz not null default now(),
  constraint notifications_one_recipient check (
    (recipient_profile_id is not null)::int + (recipient_person_id is not null)::int = 1)
);
comment on table public.notifications is 'الإشعارات — إشعار واحد لكل مستلم (خادم أو مخدوم) مع حالة القراءة';
create index if not exists idx_notifications_profile on public.notifications(recipient_profile_id, created_at desc) where recipient_profile_id is not null;
create index if not exists idx_notifications_person  on public.notifications(recipient_person_id, created_at desc)  where recipient_person_id is not null;
create index if not exists idx_notifications_unread_profile on public.notifications(recipient_profile_id) where read_at is null and recipient_profile_id is not null;
create index if not exists idx_notifications_unread_person  on public.notifications(recipient_person_id)  where read_at is null and recipient_person_id is not null;
create index if not exists idx_notifications_class on public.notifications(class_id, created_at desc);
create index if not exists idx_notifications_sender on public.notifications(sender_id, created_at desc);

-- ---------------------------------------------------------------------
-- 5. CONVERSATIONS + MEMBERS + MESSAGES (المحادثات)
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('direct', 'staff', 'group')),
  mode                  text not null default 'two_way' check (mode in ('two_way', 'one_way')),
  subject               text,
  -- scope (from the child's enrollment for direct; chosen for group; the creator's for staff)
  church_id             uuid references public.churches(id) on delete cascade,
  service_id            uuid references public.services(id) on delete cascade,
  class_id              uuid references public.classes(id)  on delete cascade,
  person_id             uuid references public.persons(id) on delete cascade,        -- direct: the child
  enrollment_id         uuid references public.enrollments(id) on delete cascade,    -- direct: which enrollment
  pair_key              text,                                                        -- staff: sorted pair of profile ids
  created_by            uuid references public.profiles(id) on delete set null,
  last_message_at       timestamptz,
  last_message_preview  text,
  last_sender_type      text,
  messages_count        integer not null default 0,
  is_archived           boolean not null default false,
  created_at            timestamptz not null default now()
);
comment on table public.conversations is 'المحادثات — direct (خدام ↔ مخدوم) · staff (خادم ↔ خادم) · group (خادم → مجموعة)';
create unique index if not exists uq_conversations_direct on public.conversations(person_id, enrollment_id) where kind = 'direct';
create unique index if not exists uq_conversations_staff_pair on public.conversations(pair_key) where kind = 'staff' and pair_key is not null;
create index if not exists idx_conversations_scope on public.conversations(class_id, last_message_at desc);
create index if not exists idx_conversations_church on public.conversations(church_id, last_message_at desc);
create index if not exists idx_conversations_person on public.conversations(person_id);

create table if not exists public.conversation_members (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  profile_id       uuid references public.profiles(id) on delete cascade,
  person_id        uuid references public.persons(id)  on delete cascade,
  role             text not null default 'member' check (role in ('owner', 'member')),
  last_read_at     timestamptz,
  muted            boolean not null default false,
  joined_at        timestamptz not null default now(),
  constraint conversation_members_one check ((profile_id is not null)::int + (person_id is not null)::int = 1)
);
create unique index if not exists uq_conversation_members_profile on public.conversation_members(conversation_id, profile_id) where profile_id is not null;
create unique index if not exists uq_conversation_members_person  on public.conversation_members(conversation_id, person_id)  where person_id is not null;
create index if not exists idx_conversation_members_profile on public.conversation_members(profile_id);
create index if not exists idx_conversation_members_person  on public.conversation_members(person_id);

create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.conversations(id) on delete cascade,
  church_id          uuid references public.churches(id) on delete cascade,
  service_id         uuid references public.services(id) on delete cascade,
  class_id           uuid references public.classes(id)  on delete cascade,
  sender_type        text not null check (sender_type in ('servant', 'child', 'system')),
  sender_profile_id  uuid references public.profiles(id) on delete set null,
  sender_person_id   uuid references public.persons(id)  on delete set null,
  body               text,
  attachment_url     text,
  kind               text not null default 'text' check (kind in ('text', 'image', 'system')),
  via                text check (via in ('automation', 'campaign')),   -- null = typed by hand
  automation_id      uuid references public.message_automations(id) on delete set null,
  created_at         timestamptz not null default now(),
  edited_at          timestamptz,
  deleted_at         timestamptz,
  constraint messages_has_content check (body is not null or attachment_url is not null or kind = 'system')
);
create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at desc);
create index if not exists idx_messages_class on public.messages(class_id, created_at desc);

-- keep the conversation summary fresh
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(coalesce(new.body, case when new.attachment_url is not null then '📷 صورة' else '' end), 140),
         last_sender_type = new.sender_type,
         messages_count = messages_count + 1,
         is_archived = false
   where id = new.conversation_id;
  -- the sender has read his own message
  if new.sender_profile_id is not null then
    insert into public.conversation_members (conversation_id, profile_id, last_read_at)
    values (new.conversation_id, new.sender_profile_id, new.created_at)
    on conflict (conversation_id, profile_id) where profile_id is not null
    do update set last_read_at = excluded.last_read_at;
  elsif new.sender_person_id is not null then
    update public.conversation_members set last_read_at = new.created_at
     where conversation_id = new.conversation_id and person_id = new.sender_person_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_messages_after_insert on public.messages;
create trigger trg_messages_after_insert after insert on public.messages
for each row execute function public.messages_after_insert();

-- ---------------------------------------------------------------------
-- 6. DELIVERY LOG + OUTBOUND QUEUE
-- ---------------------------------------------------------------------
create table if not exists public.message_deliveries (
  id              uuid primary key default gen_random_uuid(),
  automation_id   uuid references public.message_automations(id) on delete cascade,
  campaign_id     uuid references public.message_campaigns(id) on delete cascade,
  person_id       uuid references public.persons(id)  on delete cascade,
  profile_id      uuid references public.profiles(id) on delete cascade,
  enrollment_id   uuid references public.enrollments(id) on delete set null,
  church_id       uuid references public.churches(id) on delete cascade,
  service_id      uuid references public.services(id) on delete cascade,
  class_id        uuid references public.classes(id)  on delete cascade,
  dedupe_key      text not null,
  channels        text[] not null,
  title           text,
  body            text not null,
  kind            text not null default 'info',
  link            text,
  extra           jsonb not null default '{}'::jsonb,
  status          text not null default 'pending' check (status in ('pending', 'deferred', 'sent', 'queued', 'skipped', 'failed')),
  result          jsonb not null default '{}'::jsonb,        -- per channel: sent | queued | skipped:no_phone | failed
  deliver_at      timestamptz,                                -- deferred (quiet hours) until
  error           text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz,
  constraint message_deliveries_one_recipient check ((person_id is not null)::int + (profile_id is not null)::int = 1)
);
create unique index if not exists uq_message_deliveries_dedupe on public.message_deliveries(dedupe_key);
create index if not exists idx_message_deliveries_automation on public.message_deliveries(automation_id, created_at desc);
create index if not exists idx_message_deliveries_campaign   on public.message_deliveries(campaign_id, created_at desc);
create index if not exists idx_message_deliveries_person     on public.message_deliveries(person_id, created_at desc);
create index if not exists idx_message_deliveries_deferred   on public.message_deliveries(deliver_at) where status = 'deferred';
create index if not exists idx_message_deliveries_class      on public.message_deliveries(class_id, created_at desc);

create table if not exists public.outbound_queue (
  id             uuid primary key default gen_random_uuid(),
  delivery_id    uuid references public.message_deliveries(id) on delete cascade,
  automation_id  uuid references public.message_automations(id) on delete set null,
  campaign_id    uuid references public.message_campaigns(id) on delete set null,
  person_id      uuid references public.persons(id)  on delete cascade,
  profile_id     uuid references public.profiles(id) on delete cascade,
  church_id      uuid references public.churches(id) on delete cascade,
  service_id     uuid references public.services(id) on delete cascade,
  class_id       uuid references public.classes(id)  on delete cascade,
  channel        text not null check (channel in ('whatsapp', 'sms')),
  phone          text not null,
  recipient_name text not null,
  body           text not null,
  status         text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  sent_by        uuid references public.profiles(id),
  sent_at        timestamptz,
  provider_ref   text,
  created_at     timestamptz not null default now()
);
comment on table public.outbound_queue is 'قائمة الإرسال — رسائل واتساب / SMS جاهزة يرسلها الخادم من هاتفه بضغطة أو يسحبها مزود خارجي';
create index if not exists idx_outbound_queue_pending on public.outbound_queue(class_id, created_at) where status = 'pending';
create index if not exists idx_outbound_queue_created on public.outbound_queue(created_at desc);
