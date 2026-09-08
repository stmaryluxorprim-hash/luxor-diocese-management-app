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

-- ---------------------------------------------------------------------
-- 7. HELPERS — settings lookup, Cairo clock, quiet hours, rendering,
--    per-recipient context, visibility
-- ---------------------------------------------------------------------
create or replace function public.msg_settings_for(p_church uuid)
returns public.messaging_settings language sql stable security definer set search_path = public as $$
  select s from public.messaging_settings s
   where s.church_id = p_church or s.church_id is null
   order by (s.church_id is not null) desc
   limit 1
$$;
revoke all on function public.msg_settings_for(uuid) from public, anon, authenticated;

create or replace function public.msg_cairo(p_at timestamptz default now())
returns timestamp language sql immutable as $$ select p_at at time zone 'Africa/Cairo' $$;

create or replace function public.msg_arabic_weekday(p_date date)
returns text language sql immutable as $$
  select (array['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[extract(dow from p_date)::int + 1]
$$;

create or replace function public.msg_fmt_time(p_time time)
returns text language sql immutable as $$
  select case when p_time is null then ''
              else to_char(p_time, 'HH12:MI') || case when p_time < '12:00' then ' ص' else ' م' end end
$$;

-- When quiet hours are active for this church → the instant they end (Cairo);
-- otherwise null. Handles windows that cross midnight (22:00 → 08:00).
create or replace function public.msg_quiet_until(p_church uuid, p_at timestamptz default now())
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  s public.messaging_settings;
  loc timestamp := public.msg_cairo(p_at);
  t time := loc::time;
  d date := loc::date;
  end_local timestamp;
begin
  s := public.msg_settings_for(p_church);
  if s.id is null or s.quiet_hours_start is null or s.quiet_hours_end is null or s.quiet_hours_start = s.quiet_hours_end then
    return null;
  end if;
  if s.quiet_hours_start < s.quiet_hours_end then           -- same day window (e.g. 13:00 → 16:00)
    if t >= s.quiet_hours_start and t < s.quiet_hours_end then end_local := d + s.quiet_hours_end; end if;
  else                                                       -- crosses midnight (e.g. 22:00 → 08:00)
    if t >= s.quiet_hours_start then end_local := (d + 1) + s.quiet_hours_end;
    elsif t < s.quiet_hours_end then end_local := d + s.quiet_hours_end; end if;
  end if;
  if end_local is null then return null; end if;
  return end_local at time zone 'Africa/Cairo';
end $$;
revoke all on function public.msg_quiet_until(uuid, timestamptz) from public, anon, authenticated;

-- [variable] substitution — every key of the context replaces "[key]"
create or replace function public.msg_render(p_template text, p_ctx jsonb)
returns text language plpgsql immutable as $$
declare
  out text := coalesce(p_template, '');
  k text; v text;
begin
  if p_ctx is null then return out; end if;
  for k, v in select key, value from jsonb_each_text(p_ctx) loop
    out := replace(out, '[' || k || ']', coalesce(v, ''));
  end loop;
  return out;
end $$;

-- generic date / time variables (Cairo)
create or replace function public.msg_clock_context(p_at timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'التاريخ', to_char(public.msg_cairo(p_at)::date, 'DD/MM/YYYY'),
    'اليوم',   public.msg_arabic_weekday(public.msg_cairo(p_at)::date),
    'الوقت',   public.msg_fmt_time(public.msg_cairo(p_at)::time))
$$;

-- the child's variables (from one enrollment)
create or replace function public.msg_child_context(p_enrollment uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.msg_clock_context() || jsonb_build_object(
    'الاسم',          split_part(trim(p.name), ' ', 1),
    'الاسم الأول',    split_part(trim(p.name), ' ', 1),
    'الاسم الكامل',   p.name,
    'السن',           coalesce(extract(year from age((now() at time zone 'Africa/Cairo')::date, p.birthdate))::int::text, ''),
    'تاريخ الميلاد',  coalesce(to_char(p.birthdate, 'DD/MM/YYYY'), ''),
    'رقم الهاتف',     coalesce(p.phone, ''),
    'الرقم القومي',   p.national_id,
    'اسم الفصل',      cl.name,
    'اسم الخدمة',     sv.name,
    'اسم الكنيسة',    ch.name,
    'النقاط',         e.points::text,
    'عدد الحضور',     e.attendance_count::text,
    'آخر حضور',       coalesce((select to_char(max(a.attended_on), 'DD/MM/YYYY') from public.attendance_log a where a.enrollment_id = e.id), '—'),
    'أيام الغياب',    coalesce(((now() at time zone 'Africa/Cairo')::date
                        - coalesce((select max(a.attended_on) from public.attendance_log a where a.enrollment_id = e.id), e.created_at::date))::text, ''),
    'ضمير',           case when p.gender = 'female' then 'ة' else '' end)
    from public.enrollments e
    join public.persons p on p.id = e.person_id
    join public.classes cl on cl.id = e.class_id
    join public.services sv on sv.id = e.service_id
    join public.churches ch on ch.id = e.church_id
   where e.id = p_enrollment
$$;
revoke all on function public.msg_child_context(uuid) from public, anon, authenticated;

-- a servant's variables
create or replace function public.msg_profile_context(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.msg_clock_context() || jsonb_build_object(
    'اسم الخادم',    pr.full_name,
    'اسم المستلم',   pr.full_name,
    'الاسم',         split_part(trim(pr.full_name), ' ', 1),
    'الاسم الأول',   split_part(trim(pr.full_name), ' ', 1),
    'الاسم الكامل',  pr.full_name,
    'الدور',         case pr.role when 'owner' then 'مالك التطبيق' when 'church_manager' then 'مدير كنيسة'
                                  when 'service_manager' then 'مسؤول خدمة' else 'خادم فصل' end,
    'اسم الكنيسة',   coalesce(ch.name, ''),
    'اسم الخدمة',    coalesce(sv.name, ''),
    'اسم الفصل',     coalesce(cl.name, ''))
    from public.profiles pr
    left join public.churches ch on ch.id = pr.church_id
    left join public.services sv on sv.id = pr.service_id
    left join public.classes  cl on cl.id = pr.class_id
   where pr.id = p_profile
$$;
revoke all on function public.msg_profile_context(uuid) from public, anon, authenticated;

-- can the CALLER see this scope (enrollment semantics, InitPlan-friendly)
create or replace function public.msg_scope_visible(p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.enrollment_visible(p_church, p_service, p_class, s.role, s.church_id, s.service_id, s.class_id)
      from public.my_scope() s), false)
$$;
grant execute on function public.msg_scope_visible(uuid, uuid, uuid) to authenticated;

-- is this conversation visible to the caller? member OR (direct / group) inside his scope
create or replace function public.msg_conversation_visible(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conv
       and (exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.profile_id = auth.uid())
            or (c.kind in ('direct', 'group') and public.msg_scope_visible(c.church_id, c.service_id, c.class_id)))
  )
$$;
grant execute on function public.msg_conversation_visible(uuid) to authenticated;

-- can the caller reach servant B? = their scopes overlap; the owner is reachable by everyone
create or replace function public.msg_profile_reachable(p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when t.status <> 'approved' then false
      when s.role = 'owner' or t.role = 'owner' then true
      when t.church_id <> s.church_id then false
      when s.role = 'church_manager' or t.role = 'church_manager' then true
      when s.service_id is not null and t.service_id is not null and s.service_id <> t.service_id then false
      when s.role = 'service_manager' or t.role = 'service_manager' then true
      when s.class_id is not null and t.class_id is not null and s.class_id <> t.class_id then false
      else true end
      from public.profiles t, public.my_scope() s
     where t.id = p_target), false)
$$;
grant execute on function public.msg_profile_reachable(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. RLS — the database is the wall; the UI mostly goes through RPCs
-- ---------------------------------------------------------------------
alter table public.messaging_settings   enable row level security;
alter table public.message_templates    enable row level security;
alter table public.message_automations  enable row level security;
alter table public.message_campaigns    enable row level security;
alter table public.notifications        enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.message_deliveries   enable row level security;
alter table public.outbound_queue       enable row level security;

drop policy if exists messaging_settings_select on public.messaging_settings;
create policy messaging_settings_select on public.messaging_settings for select using (
  (select public.module_visible('messaging'))
  and (church_id is null or (select public.scope_overlaps(church_id, null, null)))
);
drop policy if exists messaging_settings_write on public.messaging_settings;
create policy messaging_settings_write on public.messaging_settings for all using (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner()))
       or (church_id is not null and (select role from public.my_scope()) in ('owner', 'church_manager')
           and (select public.scope_contains(church_id, null, null))))
) with check (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner()))
       or (church_id is not null and (select role from public.my_scope()) in ('owner', 'church_manager')
           and (select public.scope_contains(church_id, null, null))))
);

drop policy if exists message_templates_select on public.message_templates;
create policy message_templates_select on public.message_templates for select using (
  (select public.module_visible('messaging'))
  and (church_id is null or (select public.scope_overlaps(church_id, service_id, class_id)))
);
drop policy if exists message_templates_write on public.message_templates;
create policy message_templates_write on public.message_templates for all using (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner())) or (church_id is not null and (select public.scope_contains(church_id, service_id, class_id))))
) with check (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner())) or (church_id is not null and (select public.scope_contains(church_id, service_id, class_id))))
);

drop policy if exists message_automations_select on public.message_automations;
create policy message_automations_select on public.message_automations for select using (
  (select public.module_visible('messaging'))
  and (church_id is null or (select public.scope_overlaps(church_id, service_id, class_id)))
);
drop policy if exists message_automations_write on public.message_automations;
create policy message_automations_write on public.message_automations for all using (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner())) or (church_id is not null and (select public.scope_contains(church_id, service_id, class_id))))
) with check (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner())) or (church_id is not null and (select public.scope_contains(church_id, service_id, class_id))))
);

drop policy if exists message_campaigns_select on public.message_campaigns;
create policy message_campaigns_select on public.message_campaigns for select using (
  (select public.module_visible('messaging'))
  and (created_by = auth.uid()
       or (church_id is null and (select public.is_owner()))
       or (church_id is not null and (select public.scope_overlaps(church_id, service_id, class_id))))
);

-- notifications: mine always; the module lets me see what I sent and what the children in my scope received
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select using (
  recipient_profile_id = auth.uid()
  or ((select public.module_visible('messaging'))
      and (sender_id = auth.uid()
           or (recipient_person_id is not null and (select public.msg_scope_visible(church_id, service_id, class_id)))))
);
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update using (
  recipient_profile_id = auth.uid()
) with check (
  recipient_profile_id = auth.uid()
);
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete using (
  recipient_profile_id = auth.uid()
  or ((select public.module_visible('messaging')) and sender_id = auth.uid())
  or ((select public.module_visible('messaging')) and (select role from public.my_scope()) in ('owner', 'church_manager', 'service_manager')
      and recipient_person_id is not null and (select public.msg_scope_visible(church_id, service_id, class_id)))
);

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select using (
  (select public.module_visible('messaging')) and (select public.msg_conversation_visible(id))
);
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update using (
  (select public.module_visible('messaging')) and (select public.msg_conversation_visible(id))
) with check (
  (select public.module_visible('messaging')) and (select public.msg_conversation_visible(id))
);
drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations for delete using (
  (select public.module_visible('messaging'))
  and (created_by = auth.uid() or (select role from public.my_scope()) in ('owner', 'church_manager', 'service_manager'))
  and (select public.msg_conversation_visible(id))
);

drop policy if exists conversation_members_select on public.conversation_members;
create policy conversation_members_select on public.conversation_members for select using (
  (select public.module_visible('messaging')) and (select public.msg_conversation_visible(conversation_id))
);
drop policy if exists conversation_members_update_own on public.conversation_members;
create policy conversation_members_update_own on public.conversation_members for update using (
  profile_id = auth.uid()
) with check (
  profile_id = auth.uid()
);

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (
  (select public.module_visible('messaging')) and (select public.msg_conversation_visible(conversation_id))
);
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert with check (
  (select public.module_visible('messaging'))
  and sender_type = 'servant' and sender_profile_id = auth.uid()
  and (select public.msg_conversation_visible(conversation_id))
);
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update using (
  sender_profile_id = auth.uid()
) with check (
  sender_profile_id = auth.uid()
);

drop policy if exists message_deliveries_select on public.message_deliveries;
create policy message_deliveries_select on public.message_deliveries for select using (
  (select public.module_visible('messaging'))
  and (profile_id = auth.uid()
       or (church_id is null and (select public.is_owner()))
       or (select public.msg_scope_visible(church_id, service_id, class_id)))
);
drop policy if exists outbound_queue_select on public.outbound_queue;
create policy outbound_queue_select on public.outbound_queue for select using (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner())) or (select public.msg_scope_visible(church_id, service_id, class_id)))
);
drop policy if exists outbound_queue_update on public.outbound_queue;
create policy outbound_queue_update on public.outbound_queue for update using (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner())) or (select public.msg_scope_visible(church_id, service_id, class_id)))
) with check (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner())) or (select public.msg_scope_visible(church_id, service_id, class_id)))
);
drop policy if exists outbound_queue_delete on public.outbound_queue;
create policy outbound_queue_delete on public.outbound_queue for delete using (
  (select public.module_visible('messaging'))
  and ((church_id is null and (select public.is_owner())) or (select public.msg_scope_visible(church_id, service_id, class_id)))
);

-- ---------------------------------------------------------------------
-- 9. DISPATCH ENGINE — msg_deliver(): ONE recipient, rendered text,
--    channels → notification / chat message / outbound queue, logged in
--    message_deliveries with a dedupe key. Quiet hours → deferred.
--    Returns 'sent' | 'queued' | 'deferred' | 'skipped' | 'duplicate'.
-- ---------------------------------------------------------------------
create or replace function public.msg_ensure_direct_conversation(p_enrollment uuid, p_creator uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  e public.enrollments;
  v_id uuid;
begin
  select * into e from public.enrollments where id = p_enrollment;
  if e.id is null then raise exception 'enrollment_not_found'; end if;
  select id into v_id from public.conversations where kind = 'direct' and person_id = e.person_id and enrollment_id = e.id;
  if v_id is null then
    insert into public.conversations (kind, mode, church_id, service_id, class_id, person_id, enrollment_id, created_by)
    values ('direct', 'two_way', e.church_id, e.service_id, e.class_id, e.person_id, e.id, p_creator)
    on conflict (person_id, enrollment_id) where kind = 'direct' do update set is_archived = false
    returning id into v_id;
    insert into public.conversation_members (conversation_id, person_id) values (v_id, e.person_id)
    on conflict do nothing;
  end if;
  if p_creator is not null then
    insert into public.conversation_members (conversation_id, profile_id) values (v_id, p_creator)
    on conflict do nothing;
  end if;
  return v_id;
end $$;
revoke all on function public.msg_ensure_direct_conversation(uuid, uuid) from public, anon, authenticated;

create or replace function public.msg_deliver(
  p_dedupe_key   text,
  p_channels     text[],
  p_title        text,
  p_body         text,
  p_kind         text,
  p_link         text,
  p_ctx          jsonb,                 -- variables for rendering
  p_person       uuid,                  -- child recipient (or null)
  p_enrollment   uuid,                  -- child's enrollment (scope + chat)
  p_profile      uuid,                  -- servant recipient (or null)
  p_source       text,                  -- manual | automation | campaign | system
  p_automation   uuid default null,
  p_campaign     uuid default null,
  p_sender       uuid default null,
  p_respect_quiet boolean default true,
  p_icon         text default null,
  p_color        text default null,
  p_extra        jsonb default '{}'::jsonb,
  p_when         timestamptz default now()
)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_title text; v_body text;
  v_church uuid; v_service uuid; v_class uuid;
  v_phone text; v_name text;
  v_result jsonb := '{}'::jsonb;
  v_status text := 'skipped';
  v_quiet timestamptz;
  v_delivery uuid;
  v_conv uuid;
  s public.messaging_settings;
  ch text;
  v_channels text[] := coalesce(p_channels, array['in_app']);
begin
  if p_person is null and p_profile is null then return 'skipped'; end if;

  if p_person is not null then
    select e.church_id, e.service_id, e.class_id, p.phone, p.name
      into v_church, v_service, v_class, v_phone, v_name
      from public.enrollments e join public.persons p on p.id = e.person_id
     where e.id = p_enrollment and e.person_id = p_person;
    if v_name is null then
      select p.phone, p.name into v_phone, v_name from public.persons p where p.id = p_person;
      if v_name is null then return 'skipped'; end if;
    end if;
  else
    select pr.church_id, pr.service_id, pr.class_id, pr.phone, pr.full_name
      into v_church, v_service, v_class, v_phone, v_name
      from public.profiles pr where pr.id = p_profile and pr.status = 'approved';
    if v_name is null then return 'skipped'; end if;
    -- servants have no direct conversation → "chat" becomes in_app
    if 'chat' = any(v_channels) then v_channels := array_remove(v_channels, 'chat') || array['in_app']; end if;
  end if;

  v_title := nullif(trim(public.msg_render(p_title, p_ctx)), '');
  v_body  := public.msg_render(p_body, p_ctx);

  begin
    insert into public.message_deliveries (automation_id, campaign_id, person_id, profile_id, enrollment_id,
      church_id, service_id, class_id, dedupe_key, channels, title, body, kind, link, extra, status, deliver_at)
    values (p_automation, p_campaign, p_person, p_profile, p_enrollment,
      v_church, v_service, v_class, p_dedupe_key, v_channels, v_title, v_body, coalesce(p_kind, 'info'), p_link,
      coalesce(p_extra, '{}'::jsonb) || jsonb_build_object('source', p_source, 'sender', p_sender, 'icon', p_icon, 'color', p_color,
                                                          'respect_quiet', p_respect_quiet),
      'pending', null)
    returning id into v_delivery;
  exception when unique_violation then
    return 'duplicate';
  end;

  if p_respect_quiet and v_church is not null then
    v_quiet := public.msg_quiet_until(v_church, p_when);
    if v_quiet is not null and v_quiet > now() then
      update public.message_deliveries set status = 'deferred', deliver_at = v_quiet where id = v_delivery;
      return 'deferred';
    end if;
  end if;

  s := public.msg_settings_for(v_church);

  foreach ch in array (select array(select distinct unnest(v_channels))) loop
    if ch = 'in_app' then
      insert into public.notifications (recipient_profile_id, recipient_person_id, enrollment_id, church_id, service_id, class_id,
        title, body, kind, icon, color, link, data, source, automation_id, campaign_id, sender_id)
      values (p_profile, p_person, p_enrollment, v_church, v_service, v_class,
        coalesce(v_title, left(v_body, 60)), case when v_title is null then null else v_body end,
        coalesce(p_kind, 'info'), p_icon, p_color, p_link,
        jsonb_build_object('delivery_id', v_delivery) || coalesce(p_extra, '{}'::jsonb), p_source, p_automation, p_campaign, p_sender);
      v_result := v_result || jsonb_build_object('in_app', 'sent'); v_status := 'sent';
    elsif ch = 'chat' and p_person is not null and p_enrollment is not null then
      v_conv := public.msg_ensure_direct_conversation(p_enrollment, p_sender);
      insert into public.messages (conversation_id, church_id, service_id, class_id, sender_type, sender_profile_id, body, kind, via, automation_id)
      values (v_conv, v_church, v_service, v_class,
              case when p_sender is null then 'system' else 'servant' end, p_sender,
              case when v_title is null then v_body else v_title || E'\n' || v_body end,
              'text', case when p_automation is not null then 'automation' when p_campaign is not null then 'campaign' else null end, p_automation);
      v_result := v_result || jsonb_build_object('chat', 'sent'); v_status := 'sent';
    elsif ch in ('whatsapp', 'sms') then
      if v_phone is null or length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then
        v_result := v_result || jsonb_build_object(ch, 'skipped:no_phone');
      else
        insert into public.outbound_queue (delivery_id, automation_id, campaign_id, person_id, profile_id, church_id, service_id, class_id,
          channel, phone, recipient_name, body)
        values (v_delivery, p_automation, p_campaign, p_person, p_profile, v_church, v_service, v_class,
          ch, v_phone, v_name,
          case when v_title is null then v_body else v_title || E'\n' || v_body end
            || case when s.signature is not null and length(trim(s.signature)) > 0 then E'\n' || s.signature else '' end);
        v_result := v_result || jsonb_build_object(ch, 'queued');
        if v_status <> 'sent' then v_status := 'queued'; end if;
      end if;
    end if;
  end loop;

  update public.message_deliveries
     set status = v_status, result = v_result, delivered_at = now(), deliver_at = null
   where id = v_delivery;
  return v_status;
end $$;
revoke all on function public.msg_deliver(text, text[], text, text, text, text, jsonb, uuid, uuid, uuid, text, uuid, uuid, uuid, boolean, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- re-deliver DEFERRED rows whose quiet hours are over (text already rendered → ctx null)
create or replace function public.msg_release_deferred(p_limit integer default 500)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  d public.message_deliveries;
  n integer := 0;
begin
  for d in select * from public.message_deliveries where status = 'deferred' and deliver_at <= now() order by deliver_at limit p_limit loop
    delete from public.message_deliveries where id = d.id;
    perform public.msg_deliver(d.dedupe_key, d.channels, d.title, d.body, d.kind, d.link, null,
      d.person_id, d.enrollment_id, d.profile_id, coalesce(d.extra->>'source', 'automation'),
      d.automation_id, d.campaign_id, nullif(d.extra->>'sender', '')::uuid, false,
      d.extra->>'icon', d.extra->>'color', d.extra - 'source' - 'sender' - 'icon' - 'color' - 'respect_quiet', now());
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.msg_release_deferred(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. AUDIENCE — which enrollments / profiles a scope + filter covers
--     filter: {gender, has_phone, min_age, max_age, enrollment_ids[], shepherd_of, roles[], profile_ids[], exclude_self}
-- ---------------------------------------------------------------------
create or replace function public.msg_audience_children(
  p_church uuid, p_service uuid, p_class uuid, p_filter jsonb default '{}'::jsonb)
returns table (enrollment_id uuid, person_id uuid, church_id uuid, service_id uuid, class_id uuid, name text, phone text, image_url text)
language sql stable security definer set search_path = public as $$
  select distinct on (e.person_id) e.id, e.person_id, e.church_id, e.service_id, e.class_id, p.name, p.phone, p.image_url
    from public.enrollments e
    join public.persons p on p.id = e.person_id
   where (p_church  is null or e.church_id  = p_church)
     and (p_service is null or e.service_id = p_service)
     and (p_class   is null or e.class_id   = p_class)
     and (coalesce(p_filter->>'gender', '') = '' or p.gender::text = p_filter->>'gender')
     and (not coalesce((p_filter->>'has_phone')::boolean, false)
          or (p.phone is not null and length(regexp_replace(p.phone, '\D', '', 'g')) >= 10))
     and (coalesce(p_filter->>'min_age', '') = ''
          or (p.birthdate is not null and extract(year from age(p.birthdate))::int >= (p_filter->>'min_age')::int))
     and (coalesce(p_filter->>'max_age', '') = ''
          or (p.birthdate is not null and extract(year from age(p.birthdate))::int <= (p_filter->>'max_age')::int))
     and (jsonb_typeof(p_filter->'enrollment_ids') is distinct from 'array' or jsonb_array_length(p_filter->'enrollment_ids') = 0
          or e.id::text in (select jsonb_array_elements_text(p_filter->'enrollment_ids')))
     and (coalesce(p_filter->>'shepherd_of', '') = ''
          or exists (select 1 from public.shepherd_groups g where g.enrollment_id = e.id and g.servant_id = (p_filter->>'shepherd_of')::uuid))
   order by e.person_id, e.created_at, e.id
$$;
revoke all on function public.msg_audience_children(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.msg_audience_servants(
  p_church uuid, p_service uuid, p_class uuid, p_filter jsonb default '{}'::jsonb)
returns table (profile_id uuid, church_id uuid, service_id uuid, class_id uuid, name text, phone text, role text, photo_url text)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.church_id, pr.service_id, pr.class_id, pr.full_name, pr.phone, pr.role::text, pr.photo_url
    from public.profiles pr
   where pr.status = 'approved'
     and (p_church  is null or pr.church_id = p_church or pr.role = 'owner')
     and (p_service is null or pr.service_id is null or pr.service_id = p_service)
     and (p_class   is null or pr.class_id   is null or pr.class_id   = p_class)
     and (jsonb_typeof(p_filter->'roles') is distinct from 'array' or jsonb_array_length(p_filter->'roles') = 0
          or pr.role::text in (select jsonb_array_elements_text(p_filter->'roles')))
     and (jsonb_typeof(p_filter->'profile_ids') is distinct from 'array' or jsonb_array_length(p_filter->'profile_ids') = 0
          or pr.id::text in (select jsonb_array_elements_text(p_filter->'profile_ids')))
     and (not coalesce((p_filter->>'exclude_self')::boolean, false) or pr.id <> auth.uid())
   order by pr.role, pr.full_name
$$;
revoke all on function public.msg_audience_servants(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.msg_audience_preview(
  p_church uuid, p_service uuid, p_class uuid, p_audience text, p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  kids jsonb := '[]'::jsonb; staff jsonb := '[]'::jsonb;
  n_kids int := 0; n_staff int := 0; n_phone int := 0;
begin
  select * into s from public.my_scope();
  if s.role is null or not public.module_visible('messaging') then raise exception 'forbidden'; end if;
  if p_church is null and s.role <> 'owner' then p_church := s.church_id; end if;
  if p_church is not null and not public.msg_scope_visible(p_church, p_service, p_class) then raise exception 'forbidden'; end if;
  if p_audience in ('children', 'both') then
    select count(*), count(*) filter (where phone is not null and length(regexp_replace(phone, '\D', '', 'g')) >= 10),
           coalesce(jsonb_agg(jsonb_build_object('enrollment_id', enrollment_id, 'person_id', person_id, 'name', name, 'phone', phone, 'image_url', image_url)
                    order by name) filter (where rn <= 400), '[]'::jsonb)
      into n_kids, n_phone, kids
      from (select a.*, row_number() over (order by a.name) rn from public.msg_audience_children(p_church, p_service, p_class, coalesce(p_filter, '{}'::jsonb)) a) x;
  end if;
  if p_audience in ('servants', 'both') then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('profile_id', profile_id, 'name', name, 'phone', phone, 'role', role, 'photo_url', photo_url) order by role, name), '[]'::jsonb)
      into n_staff, staff from public.msg_audience_servants(p_church, p_service, p_class, coalesce(p_filter, '{}'::jsonb));
  end if;
  return jsonb_build_object('children_count', n_kids, 'children_with_phone', n_phone, 'servants_count', n_staff,
                            'children', kids, 'servants', staff);
end $$;
grant execute on function public.msg_audience_preview(uuid, uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 11. SERVANT RPC: msg_send — manual notification / campaign
-- ---------------------------------------------------------------------
create or replace function public.msg_send(
  p_church uuid, p_service uuid, p_class uuid,
  p_audience text, p_filter jsonb,
  p_channels text[], p_title text, p_body text,
  p_kind text default 'info', p_link text default null, p_name text default null,
  p_respect_quiet boolean default true, p_icon text default null, p_color text default null
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s record;
  a record;
  v_campaign uuid;
  v_res text;
  n_total int := 0; n_sent int := 0; n_queued int := 0; n_skipped int := 0; n_deferred int := 0;
begin
  select * into s from public.my_scope();
  if s.role is null then raise exception 'forbidden'; end if;
  if not public.module_visible('messaging') then raise exception 'module_not_visible'; end if;
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'empty_body'; end if;
  if p_channels is null or array_length(p_channels, 1) is null then raise exception 'no_channels'; end if;
  if p_church is null and s.role <> 'owner' then p_church := s.church_id; end if;
  if p_church is not null and not public.msg_scope_visible(p_church, p_service, p_class) then raise exception 'forbidden'; end if;
  if p_audience not in ('children', 'servants', 'both') then raise exception 'invalid_audience'; end if;

  insert into public.message_campaigns (church_id, service_id, class_id, name, audience, audience_filter, channels, title, body, kind, link, created_by)
  values (p_church, p_service, p_class, coalesce(nullif(trim(p_name), ''), nullif(trim(p_title), ''), left(p_body, 40)),
          p_audience, coalesce(p_filter, '{}'::jsonb), p_channels, p_title, p_body, coalesce(p_kind, 'info'), p_link, auth.uid())
  returning id into v_campaign;

  if p_audience in ('children', 'both') then
    for a in select * from public.msg_audience_children(p_church, p_service, p_class, coalesce(p_filter, '{}'::jsonb)) loop
      n_total := n_total + 1;
      v_res := public.msg_deliver('campaign:' || v_campaign || ':p:' || a.person_id, p_channels, p_title, p_body, p_kind, p_link,
                 public.msg_child_context(a.enrollment_id), a.person_id, a.enrollment_id, null, 'campaign', null, v_campaign, auth.uid(),
                 p_respect_quiet, p_icon, p_color);
      if v_res = 'sent' then n_sent := n_sent + 1; elsif v_res = 'queued' then n_queued := n_queued + 1;
      elsif v_res = 'deferred' then n_deferred := n_deferred + 1; else n_skipped := n_skipped + 1; end if;
    end loop;
  end if;
  if p_audience in ('servants', 'both') then
    for a in select * from public.msg_audience_servants(p_church, p_service, p_class, coalesce(p_filter, '{}'::jsonb)) loop
      n_total := n_total + 1;
      v_res := public.msg_deliver('campaign:' || v_campaign || ':u:' || a.profile_id, p_channels, p_title, p_body, p_kind, p_link,
                 public.msg_profile_context(a.profile_id), null, null, a.profile_id, 'campaign', null, v_campaign, auth.uid(),
                 p_respect_quiet, p_icon, p_color);
      if v_res = 'sent' then n_sent := n_sent + 1; elsif v_res = 'queued' then n_queued := n_queued + 1;
      elsif v_res = 'deferred' then n_deferred := n_deferred + 1; else n_skipped := n_skipped + 1; end if;
    end loop;
  end if;

  update public.message_campaigns
     set recipients_count = n_total, sent_count = n_sent, queued_count = n_queued, skipped_count = n_skipped
   where id = v_campaign;
  return jsonb_build_object('campaign_id', v_campaign, 'recipients', n_total, 'sent', n_sent, 'queued', n_queued,
                            'deferred', n_deferred, 'skipped', n_skipped);
end $$;
grant execute on function public.msg_send(uuid, uuid, uuid, text, jsonb, text[], text, text, text, text, text, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 12. SERVANT RPCs — conversations
-- ---------------------------------------------------------------------
create or replace function public.msg_open_direct(p_enrollment uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare e public.enrollments; s record;
begin
  select * into s from public.my_scope();
  if s.role is null then raise exception 'forbidden'; end if;
  if not public.module_visible('messaging') then raise exception 'module_not_visible'; end if;
  select * into e from public.enrollments where id = p_enrollment;
  if e.id is null then raise exception 'enrollment_not_found'; end if;
  if not public.enrollment_visible(e.church_id, e.service_id, e.class_id, s.role, s.church_id, s.service_id, s.class_id) then
    raise exception 'forbidden';
  end if;
  return public.msg_ensure_direct_conversation(p_enrollment, auth.uid());
end $$;
grant execute on function public.msg_open_direct(uuid) to authenticated;

create or replace function public.msg_open_staff(p_profile uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_key text; v_id uuid; me record; t public.profiles;
begin
  select * into me from public.my_scope();
  if me.role is null then raise exception 'forbidden'; end if;
  if not public.module_visible('messaging') then raise exception 'module_not_visible'; end if;
  if p_profile = auth.uid() then raise exception 'self'; end if;
  if not public.msg_profile_reachable(p_profile) then raise exception 'forbidden'; end if;
  select * into t from public.profiles where id = p_profile;
  v_key := least(auth.uid()::text, p_profile::text) || ':' || greatest(auth.uid()::text, p_profile::text);
  select id into v_id from public.conversations where kind = 'staff' and pair_key = v_key;
  if v_id is null then
    insert into public.conversations (kind, mode, church_id, service_id, class_id, pair_key, created_by)
    values ('staff', 'two_way', coalesce(me.church_id, t.church_id), null, null, v_key, auth.uid())
    returning id into v_id;
    insert into public.conversation_members (conversation_id, profile_id, role) values (v_id, auth.uid(), 'owner'), (v_id, p_profile, 'member')
    on conflict do nothing;
  end if;
  return v_id;
end $$;
grant execute on function public.msg_open_staff(uuid) to authenticated;

create or replace function public.msg_create_group(
  p_subject text, p_mode text, p_church uuid, p_service uuid, p_class uuid, p_filter jsonb default '{}'::jsonb,
  p_first_message text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s record; v_id uuid; a record; n int := 0;
begin
  select * into s from public.my_scope();
  if s.role is null then raise exception 'forbidden'; end if;
  if not public.module_visible('messaging') then raise exception 'module_not_visible'; end if;
  if p_mode not in ('one_way', 'two_way') then raise exception 'invalid_mode'; end if;
  if p_church is null and s.role <> 'owner' then p_church := s.church_id; end if;
  if p_church is null then raise exception 'church_required'; end if;
  if not public.msg_scope_visible(p_church, p_service, p_class) then raise exception 'forbidden'; end if;

  insert into public.conversations (kind, mode, subject, church_id, service_id, class_id, created_by)
  values ('group', p_mode, coalesce(nullif(trim(p_subject), ''), 'مجموعة'), p_church, p_service, p_class, auth.uid())
  returning id into v_id;
  insert into public.conversation_members (conversation_id, profile_id, role) values (v_id, auth.uid(), 'owner');
  for a in select * from public.msg_audience_children(p_church, p_service, p_class, coalesce(p_filter, '{}'::jsonb)) loop
    insert into public.conversation_members (conversation_id, person_id) values (v_id, a.person_id) on conflict do nothing;
    n := n + 1;
  end loop;
  if p_first_message is not null and length(trim(p_first_message)) > 0 then
    perform public.msg_post(v_id, p_first_message, null);
  end if;
  return jsonb_build_object('conversation_id', v_id, 'members', n);
end $$;

create or replace function public.msg_post(p_conversation uuid, p_body text, p_attachment_url text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare c public.conversations; v_id uuid; m record; me public.profiles;
begin
  if not public.module_visible('messaging') then raise exception 'module_not_visible'; end if;
  select * into c from public.conversations where id = p_conversation;
  if c.id is null then raise exception 'not_found'; end if;
  if not public.msg_conversation_visible(c.id) then raise exception 'forbidden'; end if;
  if (p_body is null or length(trim(p_body)) = 0) and p_attachment_url is null then raise exception 'empty_body'; end if;
  select * into me from public.profiles where id = auth.uid();
  insert into public.messages (conversation_id, church_id, service_id, class_id, sender_type, sender_profile_id, body, attachment_url, kind)
  values (c.id, c.church_id, c.service_id, c.class_id, 'servant', auth.uid(), nullif(trim(p_body), ''), p_attachment_url,
          case when p_attachment_url is not null and nullif(trim(p_body), '') is null then 'image' else 'text' end)
  returning id into v_id;
  for m in select * from public.conversation_members cm where cm.conversation_id = c.id and not cm.muted
             and (cm.person_id is not null or (cm.profile_id is not null and cm.profile_id <> auth.uid())) loop
    insert into public.notifications (recipient_profile_id, recipient_person_id, enrollment_id, church_id, service_id, class_id,
      title, body, kind, link, source, sender_id, data)
    values (m.profile_id, m.person_id, c.enrollment_id, c.church_id, c.service_id, c.class_id,
      case c.kind when 'group' then coalesce(c.subject, 'المجموعة') else coalesce(me.full_name, 'رسالة جديدة') end,
      left(coalesce(nullif(trim(p_body), ''), '📷 صورة'), 140), 'message',
      case when m.person_id is not null then '/child/messages/' || c.id else '/messaging/chat/' || c.id end,
      'manual', auth.uid(), jsonb_build_object('conversation_id', c.id, 'message_id', v_id));
  end loop;
  return v_id;
end $$;
grant execute on function public.msg_post(uuid, text, text) to authenticated;
grant execute on function public.msg_create_group(text, text, uuid, uuid, uuid, jsonb, text) to authenticated;

create or replace function public.msg_mark_read(p_conversation uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.msg_conversation_visible(p_conversation) then raise exception 'forbidden'; end if;
  insert into public.conversation_members (conversation_id, profile_id, last_read_at) values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, profile_id) where profile_id is not null do update set last_read_at = now();
  update public.notifications set read_at = now()
   where recipient_profile_id = auth.uid() and read_at is null and (data->>'conversation_id') = p_conversation::text;
end $$;
grant execute on function public.msg_mark_read(uuid) to authenticated;

create or replace function public.msg_inbox(p_limit integer default 200, p_kind text default null)
returns table (
  id uuid, kind text, mode text, subject text, church_id uuid, service_id uuid, class_id uuid,
  person_id uuid, enrollment_id uuid, created_by uuid,
  last_message_at timestamptz, last_message_preview text, last_sender_type text, messages_count integer, is_archived boolean,
  title text, image_url text, phone text, class_name text, unread integer, members_count integer
)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() uid),
  vis as (
    select c.* from public.conversations c
     where public.module_visible('messaging')
       and (p_kind is null or c.kind = p_kind)
       and public.msg_conversation_visible(c.id)
  )
  select v.id, v.kind, v.mode, v.subject, v.church_id, v.service_id, v.class_id, v.person_id, v.enrollment_id, v.created_by,
         v.last_message_at, v.last_message_preview, v.last_sender_type, v.messages_count, v.is_archived,
         case v.kind
           when 'direct' then (select p.name from public.persons p where p.id = v.person_id)
           when 'staff'  then (select pr.full_name from public.conversation_members m join public.profiles pr on pr.id = m.profile_id
                                where m.conversation_id = v.id and m.profile_id <> (select uid from me) limit 1)
           else coalesce(v.subject, 'مجموعة') end as title,
         case v.kind
           when 'direct' then (select p.image_url from public.persons p where p.id = v.person_id)
           when 'staff'  then (select pr.photo_url from public.conversation_members m join public.profiles pr on pr.id = m.profile_id
                                where m.conversation_id = v.id and m.profile_id <> (select uid from me) limit 1)
           else null end as image_url,
         case v.kind when 'direct' then (select p.phone from public.persons p where p.id = v.person_id) else null end as phone,
         (select cl.name from public.classes cl where cl.id = v.class_id) as class_name,
         (select count(*)::int from public.messages m
           where m.conversation_id = v.id and m.deleted_at is null
             and (m.sender_profile_id is null or m.sender_profile_id <> (select uid from me))
             and m.created_at > coalesce((select cm.last_read_at from public.conversation_members cm
                                            where cm.conversation_id = v.id and cm.profile_id = (select uid from me)), '-infinity'::timestamptz)) as unread,
         (select count(*)::int from public.conversation_members cm where cm.conversation_id = v.id) as members_count
    from vis v
   order by v.last_message_at desc nulls last, v.created_at desc
   limit p_limit
$$;
grant execute on function public.msg_inbox(integer, text) to authenticated;

create or replace function public.msg_badge()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unread_notifications', (select count(*) from public.notifications n where n.recipient_profile_id = auth.uid() and n.read_at is null),
    'unread_messages', case when public.module_visible('messaging') then coalesce((select sum(unread) from public.msg_inbox(500)), 0) else 0 end,
    'pending_queue', case when public.module_visible('messaging') then (select count(*) from public.outbound_queue q where q.status = 'pending'
                            and ((q.church_id is null and public.is_owner()) or public.msg_scope_visible(q.church_id, q.service_id, q.class_id))) else 0 end,
    'module_visible', public.module_visible('messaging'))
$$;
grant execute on function public.msg_badge() to authenticated;

create or replace function public.msg_notifications_read(p_ids uuid[] default null)
returns integer language sql volatile security definer set search_path = public as $$
  with u as (
    update public.notifications set read_at = now()
     where recipient_profile_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
    returning 1)
  select count(*)::int from u
$$;
grant execute on function public.msg_notifications_read(uuid[]) to authenticated;
