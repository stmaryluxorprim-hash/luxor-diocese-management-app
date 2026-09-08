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

-- ---------------------------------------------------------------------
-- 13. AUTOMATION ENGINE — run ONE automation for ONE child / for the
--     servants of a scope. Applies audience filters, cooldown, dedupe.
-- ---------------------------------------------------------------------
create or replace function public.msg_automation_covers(a public.message_automations, p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable as $$
  select a.is_active
     and (a.church_id is null or a.church_id = p_church)
     and (a.service_id is null or a.service_id = p_service)
     and (a.class_id is null or a.class_id = p_class)
     and a.starts_at <= now()
     and (a.ends_at is null or a.ends_at > now())
$$;

create or replace function public.msg_run_for_child(
  a public.message_automations, p_enrollment uuid, p_dedupe text, p_extra_ctx jsonb default '{}'::jsonb)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  e public.enrollments; p public.persons;
  v_res text;
  f jsonb := coalesce(a.audience_filter, '{}'::jsonb);
begin
  if a.audience = 'servants' then return 'skipped'; end if;
  select * into e from public.enrollments where id = p_enrollment;
  if e.id is null then return 'skipped'; end if;
  if not public.msg_automation_covers(a, e.church_id, e.service_id, e.class_id) then return 'skipped'; end if;
  if not public.module_granted_for('messaging', e.church_id, e.service_id, e.class_id) then return 'skipped'; end if;
  select * into p from public.persons where id = e.person_id;
  if coalesce(f->>'gender', '') <> '' and p.gender::text is distinct from f->>'gender' then return 'skipped'; end if;
  if coalesce((f->>'has_phone')::boolean, false) and (p.phone is null or length(regexp_replace(p.phone, '\D', '', 'g')) < 10) then return 'skipped'; end if;
  if coalesce(f->>'min_age', '') <> '' and (p.birthdate is null or extract(year from age(p.birthdate))::int < (f->>'min_age')::int) then return 'skipped'; end if;
  if coalesce(f->>'max_age', '') <> '' and (p.birthdate is null or extract(year from age(p.birthdate))::int > (f->>'max_age')::int) then return 'skipped'; end if;
  if jsonb_typeof(f->'enrollment_ids') = 'array' and jsonb_array_length(f->'enrollment_ids') > 0
     and not (e.id::text in (select jsonb_array_elements_text(f->'enrollment_ids'))) then return 'skipped'; end if;
  if a.cooldown_hours > 0 and exists (
    select 1 from public.message_deliveries d
     where d.automation_id = a.id and d.person_id = e.person_id and d.status in ('sent', 'queued', 'deferred')
       and d.created_at > now() - make_interval(hours => a.cooldown_hours)) then
    return 'cooldown';
  end if;
  v_res := public.msg_deliver(
    'auto:' || a.id || ':' || p_dedupe, a.channels, a.title, a.body, a.kind, a.link,
    public.msg_child_context(e.id) || coalesce(p_extra_ctx, '{}'::jsonb),
    e.person_id, e.id, null, 'automation', a.id, null, a.created_by, a.respect_quiet_hours, a.icon, a.color,
    jsonb_build_object('trigger', a.trigger));
  if v_res in ('sent', 'queued', 'deferred') then
    update public.message_automations set sent_count = sent_count + 1 where id = a.id;
  end if;
  return v_res;
end $$;
revoke all on function public.msg_run_for_child(public.message_automations, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.msg_run_for_servants(
  a public.message_automations, p_church uuid, p_service uuid, p_class uuid, p_dedupe text, p_ctx jsonb)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare r record; n int := 0; v_res text; f jsonb := coalesce(a.audience_filter, '{}'::jsonb);
begin
  if a.audience = 'children' then return 0; end if;
  if not public.msg_automation_covers(a, p_church, p_service, p_class) then return 0; end if;
  for r in select * from public.msg_audience_servants(p_church, p_service, p_class, f - 'gender' - 'has_phone' - 'min_age' - 'max_age' - 'enrollment_ids') loop
    v_res := public.msg_deliver('auto:' || a.id || ':' || p_dedupe || ':u:' || r.profile_id,
      array_remove(a.channels, 'chat'), a.title, a.body, a.kind, a.link,
      public.msg_profile_context(r.profile_id) || coalesce(p_ctx, '{}'::jsonb),
      null, null, r.profile_id, 'automation', a.id, null, a.created_by, a.respect_quiet_hours, a.icon, a.color,
      jsonb_build_object('trigger', a.trigger));
    if v_res in ('sent', 'queued', 'deferred') then n := n + 1; end if;
  end loop;
  if n > 0 then update public.message_automations set sent_count = sent_count + n where id = a.id; end if;
  return n;
end $$;
revoke all on function public.msg_run_for_servants(public.message_automations, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 14. EVENT-BASED TRIGGERS (fire-and-forget; never break the source op)
-- ---------------------------------------------------------------------
create or replace function public.msg_on_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.message_automations; e public.enrollments; ctx jsonb;
begin
  begin
    select * into e from public.enrollments where id = new.enrollment_id;
    if e.id is null then return new; end if;
    ctx := jsonb_build_object(
      'اسم المناسبة', coalesce((select name from public.events where id = new.event_id), ''),
      'نقاط الحضور', new.points_delta::text, 'اسم المخدوم', (select name from public.persons where id = e.person_id));
    for a in select * from public.message_automations x
              where x.is_active and x.trigger = 'attendance'
                and (x.church_id is null or x.church_id = e.church_id)
                and (coalesce(x.trigger_config->>'event_id', '') = '' or (x.trigger_config->>'event_id')::uuid = new.event_id) loop
      perform public.msg_run_for_child(a, e.id, 'att:' || new.id, ctx);
      perform public.msg_run_for_servants(a, e.church_id, e.service_id, e.class_id, 'att:' || new.id, ctx);
    end loop;
  exception when others then
    raise warning 'messaging attendance trigger: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_msg_on_attendance on public.attendance_log;
create trigger trg_msg_on_attendance after insert on public.attendance_log
for each row execute function public.msg_on_attendance();

create or replace function public.msg_on_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.message_automations; e public.enrollments; ctx jsonb; before_pts int; ms int;
begin
  begin
    select * into e from public.enrollments where id = new.enrollment_id;
    if e.id is null then return new; end if;
    before_pts := e.points - new.delta;
    ctx := jsonb_build_object(
      'التغير', case when new.delta > 0 then '+' || new.delta else new.delta::text end,
      'السبب', coalesce((select name from public.causes where id = new.cause_id), ''),
      'اسم المناسبة', coalesce((select name from public.events where id = new.event_id), ''),
      'اسم المخدوم', (select name from public.persons where id = e.person_id));
    for a in select * from public.message_automations x
              where x.is_active and x.trigger = 'points' and (x.church_id is null or x.church_id = e.church_id) loop
      if coalesce(a.trigger_config->>'direction', 'any') = 'add' and new.delta <= 0 then continue; end if;
      if coalesce(a.trigger_config->>'direction', 'any') = 'subtract' and new.delta >= 0 then continue; end if;
      if coalesce(a.trigger_config->>'min_abs', '') <> '' and abs(new.delta) < (a.trigger_config->>'min_abs')::int then continue; end if;
      ms := nullif(a.trigger_config->>'milestone', '')::int;
      if ms is not null and ms > 0 then
        if floor(e.points::numeric / ms) <= floor(before_pts::numeric / ms) then continue; end if;
        ctx := ctx || jsonb_build_object('الهدف', ((floor(e.points::numeric / ms)) * ms)::int::text);
        perform public.msg_run_for_child(a, e.id, 'pts:ms:' || ((floor(e.points::numeric / ms)) * ms)::int, ctx);
      else
        perform public.msg_run_for_child(a, e.id, 'pts:' || new.id, ctx);
      end if;
      perform public.msg_run_for_servants(a, e.church_id, e.service_id, e.class_id, 'pts:' || new.id, ctx);
    end loop;
  exception when others then
    raise warning 'messaging points trigger: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_msg_on_points on public.points_log;
create trigger trg_msg_on_points after insert on public.points_log
for each row execute function public.msg_on_points();

create or replace function public.msg_on_enrollment()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.message_automations; ctx jsonb;
begin
  begin
    ctx := jsonb_build_object('اسم المخدوم', (select name from public.persons where id = new.person_id));
    for a in select * from public.message_automations x
              where x.is_active and x.trigger = 'new_enrollment' and (x.church_id is null or x.church_id = new.church_id) loop
      perform public.msg_run_for_child(a, new.id, 'enr:' || new.id, ctx);
      perform public.msg_run_for_servants(a, new.church_id, new.service_id, new.class_id, 'enr:' || new.id, ctx);
    end loop;
  exception when others then
    raise warning 'messaging enrollment trigger: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_msg_on_enrollment on public.enrollments;
create trigger trg_msg_on_enrollment after insert on public.enrollments
for each row execute function public.msg_on_enrollment();

create or replace function public.msg_on_exam_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.message_automations; ctx jsonb;
begin
  if new.status <> 'submitted' or old.status = 'submitted' then return new; end if;
  begin
    ctx := jsonb_build_object(
      'اسم الامتحان', coalesce((select title from public.exams where id = new.exam_id), ''),
      'الدرجة', new.score::text, 'الدرجة الكاملة', new.max_score::text, 'النسبة', round(new.percent)::text || '٪',
      'النتيجة', case when new.passed then 'ناجح' else 'لم ينجح' end, 'نقاط الامتحان', new.points_granted::text,
      'اسم المخدوم', (select name from public.persons where id = new.person_id));
    for a in select * from public.message_automations x
              where x.is_active and x.trigger = 'exam_result' and (x.church_id is null or x.church_id = new.church_id) loop
      if coalesce(a.trigger_config->>'only', 'any') = 'passed' and not coalesce(new.passed, false) then continue; end if;
      if coalesce(a.trigger_config->>'only', 'any') = 'failed' and coalesce(new.passed, false) then continue; end if;
      perform public.msg_run_for_child(a, new.enrollment_id, 'exam:' || new.id, ctx);
      perform public.msg_run_for_servants(a, new.church_id, new.service_id, new.class_id, 'exam:' || new.id, ctx);
    end loop;
  exception when others then
    raise warning 'messaging exam trigger: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_msg_on_exam_result on public.exam_attempts;
create trigger trg_msg_on_exam_result after update on public.exam_attempts
for each row execute function public.msg_on_exam_result();

create or replace function public.msg_on_store_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.message_automations; ctx jsonb;
begin
  begin
    ctx := jsonb_build_object('عدد الأصناف', new.items_count::text, 'إجمالي النقاط', new.total_points::text, 'الرصيد بعد', new.balance_after::text,
                              'اسم المخدوم', (select name from public.persons where id = new.person_id));
    for a in select * from public.message_automations x
              where x.is_active and x.trigger = 'store_order' and (x.church_id is null or x.church_id = new.church_id) loop
      perform public.msg_run_for_child(a, new.enrollment_id, 'order:' || new.id, ctx);
      perform public.msg_run_for_servants(a, new.church_id, new.service_id, new.class_id, 'order:' || new.id, ctx);
    end loop;
  exception when others then
    raise warning 'messaging store trigger: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_msg_on_store_order on public.store_orders;
create trigger trg_msg_on_store_order after insert on public.store_orders
for each row execute function public.msg_on_store_order();

-- data change request decided → the child (automation, or a system default)
create or replace function public.msg_on_data_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.message_automations; e public.enrollments; ctx jsonb; n int := 0;
begin
  if new.status not in ('approved', 'rejected') or old.status = new.status then return new; end if;
  begin
    select * into e from public.enrollments where person_id = new.person_id order by created_at, id limit 1;
    if e.id is null then return new; end if;
    ctx := jsonb_build_object(
      'نوع الطلب', case new.kind when 'photo' then 'تغيير الصورة' else 'تعديل البيانات' end,
      'القرار', case new.status when 'approved' then 'تمت الموافقة' else 'تم الرفض' end,
      'ملاحظة القرار', coalesce(new.decision_note, ''));
    for a in select * from public.message_automations x
              where x.is_active and x.trigger = 'data_request' and (x.church_id is null or x.church_id = e.church_id) loop
      if coalesce(a.trigger_config->>'only', 'any') = 'approved' and new.status <> 'approved' then continue; end if;
      if coalesce(a.trigger_config->>'only', 'any') = 'rejected' and new.status <> 'rejected' then continue; end if;
      if public.msg_run_for_child(a, e.id, 'dcr:' || new.id, ctx) in ('sent', 'queued', 'deferred') then n := n + 1; end if;
    end loop;
    if n = 0 and public.module_granted_for('messaging', e.church_id, e.service_id, e.class_id) then
      perform public.msg_deliver('sys:dcr:' || new.id, array['in_app'],
        case new.status when 'approved' then 'تمت الموافقة على طلبك ✅' else 'تم رفض طلبك' end,
        (ctx->>'نوع الطلب') || case when coalesce(new.decision_note, '') <> '' then ' — ' || new.decision_note else '' end,
        case new.status when 'approved' then 'success' else 'warning' end, '/child/data', null,
        e.person_id, e.id, null, 'system', null, null, new.decided_by, false);
    end if;
  exception when others then
    raise warning 'messaging data request trigger: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_msg_on_data_request on public.data_change_requests;
create trigger trg_msg_on_data_request after update on public.data_change_requests
for each row execute function public.msg_on_data_request();

-- SYSTEM notices to servants: join request → approvers · approval → the servant
create or replace function public.msg_on_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  begin
    if tg_op = 'INSERT' and new.status = 'pending' then
      for r in select id from public.profiles p where p.status = 'approved' and p.id <> new.id and (
                 p.role = 'owner'
                 or (p.role = 'church_manager' and p.church_id = new.church_id)
                 or (p.role = 'service_manager' and p.church_id = new.church_id and (p.service_id is null or p.service_id = new.service_id))) loop
        perform public.msg_deliver('sys:join:' || new.id || ':' || r.id, array['in_app'], 'طلب انضمام جديد 👤',
          new.full_name || ' يطلب الانضمام كخادم', 'info', '/settings/approvals', null, null, null, r.id, 'system',
          null, null, null, false, 'UserPlus', null);
      end loop;
    elsif tg_op = 'UPDATE' and new.status = 'approved' and old.status <> 'approved' then
      perform public.msg_deliver('sys:approved:' || new.id || ':' || extract(epoch from now())::bigint, array['in_app'],
        'تم قبول طلبك 🎉', 'أهلاً بك يا ' || split_part(new.full_name, ' ', 1) || '، حسابك أصبح فعالاً', 'success', '/', null,
        null, null, new.id, 'system', null, null, new.approved_by, false, 'PartyPopper', null);
    end if;
  exception when others then
    raise warning 'messaging profile trigger: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_msg_on_profile_change on public.profiles;
create trigger trg_msg_on_profile_change after insert or update of status on public.profiles
for each row execute function public.msg_on_profile_change();

-- new data change request → the servants of the child's scope
create or replace function public.msg_on_data_request_new()
returns trigger language plpgsql security definer set search_path = public as $$
declare e public.enrollments; r record; p public.persons;
begin
  begin
    select * into e from public.enrollments where person_id = new.person_id order by created_at, id limit 1;
    if e.id is null then return new; end if;
    select * into p from public.persons where id = new.person_id;
    for r in select * from public.msg_audience_servants(e.church_id, e.service_id, e.class_id, '{}'::jsonb) where role <> 'owner' loop
      perform public.msg_deliver('sys:dcr-new:' || new.id || ':' || r.profile_id, array['in_app'], 'طلب تعديل بيانات 📝',
        p.name || ' — ' || case new.kind when 'photo' then 'صورة جديدة' else 'تعديل بيانات' end, 'info', '/settings/data-requests',
        null, null, null, r.profile_id, 'system', null, null, null, false, 'FileEdit', null);
    end loop;
  exception when others then
    raise warning 'messaging dcr-new trigger: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_msg_on_data_request_new on public.data_change_requests;
create trigger trg_msg_on_data_request_new after insert on public.data_change_requests
for each row execute function public.msg_on_data_request_new();

-- ---------------------------------------------------------------------
-- 15. TIME-BASED SCHEDULER — messaging_tick()
--     birthday        {days_before: 0, at: "09:00"}
--     schedule        {repeat: once|daily|weekly|monthly, at: "HH:MM", date: "YYYY-MM-DD", weekdays: [0..6], day_of_month: n}
--     absent          {event_id?: uuid, consecutive: 1, hours_after: 2}
--     inactive        {days: 30, at: "HH:MM"}
--     event_reminder  {event_id?: uuid, minutes_before: 60}
-- ---------------------------------------------------------------------
create or replace function public.msg_time_reached(p_at text, p_now timestamp)
returns boolean language sql immutable as $$
  select p_now::time >= coalesce(nullif(p_at, ''), '00:00')::time
$$;

create or replace function public.messaging_tick(p_force boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  a public.message_automations;
  r record; ev public.events;
  v_now timestamp := public.msg_cairo(now());
  today date := v_now::date;
  n_runs int := 0; n_sent int := 0; n_released int := 0; v_res text;
  target date; occ date; cutoff timestamp;
  cfg jsonb; k int; i int; ctx jsonb; period text; last_run timestamptz; names text; hrs int;
begin
  if not pg_try_advisory_xact_lock(hashtext('messaging_tick')) then return jsonb_build_object('skipped', 'locked'); end if;
  select max(last_scheduler_run) into last_run from public.messaging_settings;
  if not p_force and last_run is not null and last_run > now() - interval '60 seconds' then
    return jsonb_build_object('skipped', 'throttled', 'last_run', last_run);
  end if;
  insert into public.messaging_settings (church_id, last_scheduler_run) values (null, now())
  on conflict ((coalesce(church_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set last_scheduler_run = now();

  n_released := public.msg_release_deferred(500);

  for a in select * from public.message_automations x
            where x.is_active and x.trigger in ('birthday', 'schedule', 'absent', 'inactive', 'event_reminder')
              and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now()) loop
    cfg := coalesce(a.trigger_config, '{}'::jsonb);
    n_runs := n_runs + 1;

    if a.trigger = 'birthday' then
      if public.msg_time_reached(cfg->>'at', v_now) then
        target := today + coalesce(nullif(cfg->>'days_before', '')::int, 0);
        for r in select e.id as enrollment_id, p.birthdate
                   from public.enrollments e join public.persons p on p.id = e.person_id
                  where p.birthdate is not null
                    and extract(month from p.birthdate)::int = extract(month from target)::int
                    and least(extract(day from p.birthdate)::int, extract(day from (date_trunc('month', target) + interval '1 month - 1 day'))::int) = extract(day from target)::int
                    and (a.church_id is null or e.church_id = a.church_id)
                    and (a.service_id is null or e.service_id = a.service_id)
                    and (a.class_id is null or e.class_id = a.class_id) loop
          ctx := jsonb_build_object('السن الجديدة', (extract(year from target)::int - extract(year from r.birthdate)::int)::text,
                                    'تاريخ العيد', to_char(target, 'DD/MM'), 'أيام متبقية', (target - today)::text);
          v_res := public.msg_run_for_child(a, r.enrollment_id, 'bd:' || extract(year from target)::int, ctx);
          if v_res in ('sent', 'queued', 'deferred') then n_sent := n_sent + 1; end if;
        end loop;
        if a.audience in ('servants', 'both') then
          select string_agg(p.name, '، ') into names from public.enrollments e join public.persons p on p.id = e.person_id
           where p.birthdate is not null and extract(month from p.birthdate)::int = extract(month from target)::int
             and extract(day from p.birthdate)::int = extract(day from target)::int
             and (a.church_id is null or e.church_id = a.church_id) and (a.service_id is null or e.service_id = a.service_id)
             and (a.class_id is null or e.class_id = a.class_id);
          if names is not null then
            n_sent := n_sent + public.msg_run_for_servants(a, a.church_id, a.service_id, a.class_id, 'bd:' || target,
                        jsonb_build_object('أسماء أصحاب العيد', names, 'تاريخ العيد', to_char(target, 'DD/MM'), 'أيام متبقية', (target - today)::text));
          end if;
        end if;
      end if;

    elsif a.trigger = 'schedule' then
      if public.msg_time_reached(cfg->>'at', v_now) then
        period := case coalesce(cfg->>'repeat', 'once')
          when 'once'    then case when coalesce(cfg->>'date', '') = '' or (cfg->>'date')::date <= today then 'once' else null end
          when 'daily'   then today::text
          when 'weekly'  then case when jsonb_typeof(cfg->'weekdays') is distinct from 'array' or jsonb_array_length(cfg->'weekdays') = 0
                                     or extract(dow from today)::int::text in (select jsonb_array_elements_text(cfg->'weekdays'))
                                   then today::text else null end
          when 'monthly' then case when extract(day from today)::int = least(coalesce(nullif(cfg->>'day_of_month', '')::int, 1),
                                     extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int)
                                   then to_char(today, 'YYYY-MM') else null end
          else null end;
        if period is not null then
          if a.audience in ('children', 'both') then
            for r in select * from public.msg_audience_children(a.church_id, a.service_id, a.class_id, a.audience_filter) loop
              v_res := public.msg_run_for_child(a, r.enrollment_id, 'sch:' || period, '{}'::jsonb);
              if v_res in ('sent', 'queued', 'deferred') then n_sent := n_sent + 1; end if;
            end loop;
          end if;
          n_sent := n_sent + public.msg_run_for_servants(a, a.church_id, a.service_id, a.class_id, 'sch:' || period, '{}'::jsonb);
          if coalesce(cfg->>'repeat', 'once') = 'once' then
            update public.message_automations set is_active = false where id = a.id;
          end if;
        end if;
      end if;

    elsif a.trigger = 'absent' then
      k := greatest(coalesce(nullif(cfg->>'consecutive', '')::int, 1), 1);
      hrs := coalesce(nullif(cfg->>'hours_after', '')::int, 2);
      for ev in select * from public.events x
                 where (coalesce(cfg->>'event_id', '') = '' or x.id = (cfg->>'event_id')::uuid)
                   and (a.church_id is null or x.church_id = a.church_id)
                   and (a.service_id is null or x.service_id is null or x.service_id = a.service_id)
                   and (a.class_id is null or x.class_id is null or x.class_id = a.class_id) loop
        occ := null;
        if ev.recurrence = 'once' then
          if ev.event_date is not null and (ev.event_date + coalesce(ev.end_time, ev.start_time, '23:59'::time)) + make_interval(hours => hrs) <= v_now then occ := ev.event_date; end if;
        elsif ev.weekdays is not null then
          for i in 0..7 loop
            if extract(dow from today - i)::int = any(ev.weekdays)
               and ((today - i) + coalesce(ev.end_time, ev.start_time, '23:59'::time)) + make_interval(hours => hrs) <= v_now then
              occ := today - i; exit;
            end if;
          end loop;
        end if;
        if occ is null or occ < (a.created_at at time zone 'Africa/Cairo')::date - 7 then continue; end if;
        for r in select e.id as enrollment_id, e.church_id, e.service_id, e.class_id, p.name
                   from public.enrollments e join public.persons p on p.id = e.person_id
                  where e.church_id = ev.church_id
                    and (ev.service_id is null or e.service_id = ev.service_id)
                    and (ev.class_id is null or e.class_id = ev.class_id)
                    and (a.church_id is null or e.church_id = a.church_id)
                    and (a.service_id is null or e.service_id = a.service_id)
                    and (a.class_id is null or e.class_id = a.class_id)
                    and e.created_at::date <= occ
                    and not exists (select 1 from public.attendance_log al where al.enrollment_id = e.id and al.event_id = ev.id and al.attended_on = occ)
                    and (k = 1 or ev.recurrence <> 'weekly' or (
                      select count(*) from (
                        select d::date as d from generate_series(occ - 1, occ - 7 * k, -1) d
                         where extract(dow from d)::int = any(ev.weekdays)
                         order by d desc limit k - 1) prev
                       where not exists (select 1 from public.attendance_log al where al.enrollment_id = e.id and al.event_id = ev.id and al.attended_on = prev.d)
                    ) = k - 1) loop
          ctx := jsonb_build_object('اسم المناسبة', ev.name, 'تاريخ الغياب', to_char(occ, 'DD/MM/YYYY'),
                                    'يوم الغياب', public.msg_arabic_weekday(occ), 'مرات الغياب', k::text, 'اسم المخدوم', r.name);
          v_res := public.msg_run_for_child(a, r.enrollment_id, 'abs:' || ev.id || ':' || occ, ctx);
          if v_res in ('sent', 'queued', 'deferred') then n_sent := n_sent + 1; end if;
          if a.audience in ('servants', 'both') then
            n_sent := n_sent + public.msg_run_for_servants(a, r.church_id, r.service_id, r.class_id, 'abs:' || ev.id || ':' || occ || ':' || r.enrollment_id, ctx);
          end if;
        end loop;
      end loop;

    elsif a.trigger = 'inactive' then
      k := greatest(coalesce(nullif(cfg->>'days', '')::int, 30), 1);
      if public.msg_time_reached(cfg->>'at', v_now) then
        for r in select e.id as enrollment_id, e.church_id, e.service_id, e.class_id, p.name,
                        coalesce((select max(al.attended_on) from public.attendance_log al where al.enrollment_id = e.id), e.created_at::date) as last_seen
                   from public.enrollments e join public.persons p on p.id = e.person_id
                  where (a.church_id is null or e.church_id = a.church_id)
                    and (a.service_id is null or e.service_id = a.service_id)
                    and (a.class_id is null or e.class_id = a.class_id) loop
          if today - r.last_seen >= k then
            period := ((today - r.last_seen) / k)::text;
            ctx := jsonb_build_object('أيام الغياب', (today - r.last_seen)::text, 'آخر حضور', to_char(r.last_seen, 'DD/MM/YYYY'), 'اسم المخدوم', r.name);
            v_res := public.msg_run_for_child(a, r.enrollment_id, 'inact:' || r.last_seen || ':' || period, ctx);
            if v_res in ('sent', 'queued', 'deferred') then n_sent := n_sent + 1; end if;
            if a.audience in ('servants', 'both') then
              n_sent := n_sent + public.msg_run_for_servants(a, r.church_id, r.service_id, r.class_id,
                          'inact:' || r.enrollment_id || ':' || r.last_seen || ':' || period, ctx);
            end if;
          end if;
        end loop;
      end if;

    elsif a.trigger = 'event_reminder' then
      k := greatest(coalesce(nullif(cfg->>'minutes_before', '')::int, 60), 0);
      for ev in select * from public.events x
                 where x.start_time is not null
                   and (coalesce(cfg->>'event_id', '') = '' or x.id = (cfg->>'event_id')::uuid)
                   and (a.church_id is null or x.church_id = a.church_id)
                   and (a.service_id is null or x.service_id is null or x.service_id = a.service_id)
                   and (a.class_id is null or x.class_id is null or x.class_id = a.class_id) loop
        occ := null;
        if ev.recurrence = 'once' then
          if ev.event_date in (today, today + 1) then occ := ev.event_date; end if;
        elsif ev.weekdays is not null then
          if extract(dow from today)::int = any(ev.weekdays) then occ := today;
          elsif extract(dow from today + 1)::int = any(ev.weekdays) then occ := today + 1; end if;
        end if;
        if occ is null then continue; end if;
        cutoff := (occ + ev.start_time) - make_interval(mins => k);
        if v_now < cutoff or v_now > cutoff + interval '30 minutes' then continue; end if;
        ctx := jsonb_build_object('اسم المناسبة', ev.name, 'وقت المناسبة', public.msg_fmt_time(ev.start_time),
                                  'تاريخ المناسبة', to_char(occ, 'DD/MM/YYYY'), 'يوم المناسبة', public.msg_arabic_weekday(occ),
                                  'بعد كم دقيقة', k::text);
        for r in select e.id as enrollment_id from public.enrollments e
                  where e.church_id = ev.church_id
                    and (ev.service_id is null or e.service_id = ev.service_id) and (ev.class_id is null or e.class_id = ev.class_id)
                    and (a.church_id is null or e.church_id = a.church_id) and (a.service_id is null or e.service_id = a.service_id)
                    and (a.class_id is null or e.class_id = a.class_id) loop
          v_res := public.msg_run_for_child(a, r.enrollment_id, 'rem:' || ev.id || ':' || occ, ctx);
          if v_res in ('sent', 'queued', 'deferred') then n_sent := n_sent + 1; end if;
        end loop;
        n_sent := n_sent + public.msg_run_for_servants(a, ev.church_id, ev.service_id, ev.class_id, 'rem:' || ev.id || ':' || occ, ctx);
      end loop;
    end if;

    update public.message_automations set last_run_at = now(), run_count = run_count + 1 where id = a.id;
  end loop;

  return jsonb_build_object('ran_at', now(), 'automations', n_runs, 'sent', n_sent, 'released', n_released);
end $$;
grant execute on function public.messaging_tick(boolean) to authenticated, anon, service_role;

-- preview a template with real / sample variables (editor)
create or replace function public.msg_preview_template(p_title text, p_body text, p_enrollment uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; e uuid; ctx jsonb;
begin
  select * into s from public.my_scope();
  if s.role is null or not public.module_visible('messaging') then raise exception 'forbidden'; end if;
  e := p_enrollment;
  if e is null then
    select x.id into e from public.enrollments x
     where public.enrollment_visible(x.church_id, x.service_id, x.class_id, s.role, s.church_id, s.service_id, s.class_id)
     order by x.created_at limit 1;
  end if;
  if e is null then ctx := public.msg_clock_context() || jsonb_build_object('الاسم', 'مينا', 'الاسم الأول', 'مينا', 'الاسم الكامل', 'مينا جرجس', 'السن', '10', 'اسم الفصل', 'الفصل', 'اسم الخدمة', 'الخدمة', 'اسم الكنيسة', 'الكنيسة', 'النقاط', '120', 'ضمير', '');
  else ctx := public.msg_child_context(e); end if;
  ctx := ctx || jsonb_build_object('اسم المناسبة', 'القداس', 'تاريخ الغياب', to_char(current_date, 'DD/MM/YYYY'), 'يوم الغياب', public.msg_arabic_weekday(current_date),
                                   'مرات الغياب', '1', 'السن الجديدة', coalesce(nullif(ctx->>'السن', ''), '10'), 'تاريخ العيد', to_char(current_date, 'DD/MM'),
                                   'أيام متبقية', '0', 'وقت المناسبة', '10:00 ص', 'يوم المناسبة', public.msg_arabic_weekday(current_date), 'تاريخ المناسبة', to_char(current_date, 'DD/MM/YYYY'),
                                   'بعد كم دقيقة', '60', 'التغير', '+5', 'السبب', 'حفظ الآية', 'الهدف', '100', 'نقاط الحضور', '5',
                                   'اسم الامتحان', 'امتحان الكتاب المقدس', 'الدرجة', '8', 'الدرجة الكاملة', '10', 'النسبة', '80٪', 'النتيجة', 'ناجح', 'نقاط الامتحان', '5',
                                   'عدد الأصناف', '2', 'إجمالي النقاط', '30', 'الرصيد بعد', '90', 'نوع الطلب', 'تعديل البيانات', 'القرار', 'تمت الموافقة', 'ملاحظة القرار', '',
                                   'اسم المخدوم', coalesce(ctx->>'الاسم الكامل', 'مينا'), 'أسماء أصحاب العيد', coalesce(ctx->>'الاسم الكامل', 'مينا'));
  return jsonb_build_object('title', public.msg_render(p_title, ctx), 'body', public.msg_render(p_body, ctx), 'ctx', ctx);
end $$;
grant execute on function public.msg_preview_template(text, text, uuid) to authenticated;

-- run ONE automation right now (▶ button)
create or replace function public.msg_run_now(p_automation uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a public.message_automations; r record; n int := 0; v_res text; today date := public.msg_cairo(now())::date; target date; stamp text := extract(epoch from now())::bigint::text;
begin
  if not public.module_visible('messaging') then raise exception 'module_not_visible'; end if;
  select * into a from public.message_automations where id = p_automation;
  if a.id is null then raise exception 'not_found'; end if;
  if a.church_id is not null and not public.msg_scope_visible(a.church_id, a.service_id, a.class_id) then raise exception 'forbidden'; end if;
  if a.church_id is null and not public.is_owner() then raise exception 'forbidden'; end if;
  if a.trigger = 'schedule' then
    if a.audience in ('children', 'both') then
      for r in select * from public.msg_audience_children(a.church_id, a.service_id, a.class_id, a.audience_filter) loop
        v_res := public.msg_run_for_child(a, r.enrollment_id, 'manual:' || stamp, '{}'::jsonb);
        if v_res in ('sent', 'queued', 'deferred') then n := n + 1; end if;
      end loop;
    end if;
    n := n + public.msg_run_for_servants(a, a.church_id, a.service_id, a.class_id, 'manual:' || stamp, '{}'::jsonb);
  elsif a.trigger = 'birthday' then
    target := today + coalesce(nullif(a.trigger_config->>'days_before', '')::int, 0);
    for r in select e.id as enrollment_id, p.birthdate from public.enrollments e join public.persons p on p.id = e.person_id
              where p.birthdate is not null and extract(month from p.birthdate)::int = extract(month from target)::int
                and extract(day from p.birthdate)::int = extract(day from target)::int
                and (a.church_id is null or e.church_id = a.church_id) and (a.service_id is null or e.service_id = a.service_id)
                and (a.class_id is null or e.class_id = a.class_id) loop
      v_res := public.msg_run_for_child(a, r.enrollment_id, 'bd:' || extract(year from target)::int,
                 jsonb_build_object('السن الجديدة', (extract(year from target)::int - extract(year from r.birthdate)::int)::text, 'تاريخ العيد', to_char(target, 'DD/MM'), 'أيام متبقية', (target - today)::text));
      if v_res in ('sent', 'queued', 'deferred') then n := n + 1; end if;
    end loop;
  else
    perform public.messaging_tick(true);
    return jsonb_build_object('ticked', true);
  end if;
  update public.message_automations set last_run_at = now(), run_count = run_count + 1 where id = a.id;
  return jsonb_build_object('sent', n);
end $$;
grant execute on function public.msg_run_now(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 16. CHILD PORTAL RPCs (anon, keyed by the scanned national id)
-- ---------------------------------------------------------------------
create or replace function public.child_portal_notifications(p_national_id text, p_limit integer default 100)
returns table (id uuid, title text, body text, kind text, icon text, color text, link text, data jsonb, source text, read_at timestamptz, created_at timestamptz, sender_name text)
language plpgsql stable security definer set search_path = public as $$
declare p public.persons;
begin
  p := public.child_portal_person(p_national_id);
  return query
    select n.id, n.title, n.body, n.kind, n.icon, n.color, n.link, n.data, n.source, n.read_at, n.created_at, pr.full_name
      from public.notifications n left join public.profiles pr on pr.id = n.sender_id
     where n.recipient_person_id = p.id
     order by n.created_at desc limit p_limit;
end $$;
grant execute on function public.child_portal_notifications(text, integer) to anon, authenticated;

create or replace function public.child_portal_notifications_read(p_national_id text, p_ids uuid[] default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare p public.persons; n int;
begin
  p := public.child_portal_person(p_national_id);
  with u as (update public.notifications set read_at = now()
              where recipient_person_id = p.id and read_at is null and (p_ids is null or id = any(p_ids)) returning 1)
  select count(*) into n from u;
  return n;
end $$;
grant execute on function public.child_portal_notifications_read(text, uuid[]) to anon, authenticated;

create or replace function public.child_portal_conversations(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.persons; out jsonb;
begin
  p := public.child_portal_person(p_national_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'mode', c.mode, 'subject', c.subject,
           'church_id', c.church_id, 'service_id', c.service_id, 'class_id', c.class_id, 'enrollment_id', c.enrollment_id,
           'title', case c.kind when 'direct' then 'خدام ' || coalesce(cl.name, '') else coalesce(c.subject, 'مجموعة') end,
           'class_name', cl.name, 'service_name', sv.name, 'church_name', ch.name, 'image_url', coalesce(cl.photo_url, ch.logo_url),
           'last_message_at', c.last_message_at, 'last_message_preview', c.last_message_preview, 'last_sender_type', c.last_sender_type,
           'messages_count', c.messages_count,
           'can_reply', c.mode = 'two_way' and coalesce((public.msg_settings_for(c.church_id)).children_can_reply, true),
           'unread', (select count(*) from public.messages m where m.conversation_id = c.id and m.deleted_at is null and m.sender_type <> 'child'
                        and m.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)))
           order by c.last_message_at desc nulls last, c.created_at desc), '[]'::jsonb)
    into out
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    left join public.classes cl on cl.id = c.class_id
    left join public.services sv on sv.id = c.service_id
    left join public.churches ch on ch.id = c.church_id
   where cm.person_id = p.id and not c.is_archived
     and public.module_granted_for('messaging', c.church_id, c.service_id, c.class_id);
  return out;
end $$;
grant execute on function public.child_portal_conversations(text) to anon, authenticated;

create or replace function public.child_portal_messages(p_national_id text, p_conversation uuid, p_limit integer default 200)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p public.persons; c public.conversations; out jsonb;
begin
  p := public.child_portal_person(p_national_id);
  select c2.* into c from public.conversations c2 join public.conversation_members cm on cm.conversation_id = c2.id
   where c2.id = p_conversation and cm.person_id = p.id;
  if c.id is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  update public.conversation_members set last_read_at = now() where conversation_id = c.id and person_id = p.id;
  update public.notifications set read_at = now() where recipient_person_id = p.id and read_at is null and (data->>'conversation_id') = c.id::text;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'sender_type', m.sender_type, 'mine', m.sender_person_id = p.id,
           'sender_name', case m.sender_type when 'child' then coalesce(ps.name, '') when 'servant' then coalesce(pr.full_name, 'خادم') else 'النظام' end,
           'sender_photo', case m.sender_type when 'servant' then pr.photo_url else ps.image_url end,
           'body', m.body, 'attachment_url', m.attachment_url, 'kind', m.kind, 'via', m.via,
           'created_at', m.created_at, 'deleted', m.deleted_at is not null) order by m.created_at), '[]'::jsonb)
    into out
    from (select * from public.messages x where x.conversation_id = c.id order by x.created_at desc limit p_limit) m
    left join public.profiles pr on pr.id = m.sender_profile_id
    left join public.persons ps on ps.id = m.sender_person_id;
  return jsonb_build_object(
    'conversation', jsonb_build_object('id', c.id, 'kind', c.kind, 'mode', c.mode, 'subject', c.subject,
      'can_reply', c.mode = 'two_way' and coalesce((public.msg_settings_for(c.church_id)).children_can_reply, true),
      'title', case c.kind when 'direct' then 'خدام ' || coalesce((select name from public.classes where id = c.class_id), '') else coalesce(c.subject, 'مجموعة') end),
    'messages', out);
end $$;
grant execute on function public.child_portal_messages(text, uuid, integer) to anon, authenticated;

create or replace function public.child_portal_send(p_national_id text, p_conversation uuid, p_body text, p_attachment_url text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare p public.persons; c public.conversations; v_id uuid; r record; s public.messaging_settings;
begin
  p := public.child_portal_person(p_national_id);
  select c2.* into c from public.conversations c2 join public.conversation_members cm on cm.conversation_id = c2.id
   where c2.id = p_conversation and cm.person_id = p.id;
  if c.id is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  s := public.msg_settings_for(c.church_id);
  if c.mode <> 'two_way' or not coalesce(s.children_can_reply, true) then raise exception 'read_only' using errcode = 'P0001'; end if;
  if (p_body is null or length(trim(p_body)) = 0) and p_attachment_url is null then raise exception 'empty_body' using errcode = 'P0001'; end if;
  if length(coalesce(p_body, '')) > 4000 then raise exception 'too_long' using errcode = 'P0001'; end if;
  insert into public.messages (conversation_id, church_id, service_id, class_id, sender_type, sender_person_id, body, attachment_url, kind)
  values (c.id, c.church_id, c.service_id, c.class_id, 'child', p.id, nullif(trim(p_body), ''), p_attachment_url,
          case when p_attachment_url is not null and nullif(trim(p_body), '') is null then 'image' else 'text' end)
  returning id into v_id;
  for r in select distinct pr.id from public.profiles pr
            where pr.status = 'approved' and (
              exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.profile_id = pr.id and not cm.muted)
              or (c.kind = 'direct' and pr.role <> 'owner'
                  and public.enrollment_visible(c.church_id, c.service_id, c.class_id, pr.role, pr.church_id, pr.service_id, pr.class_id))) loop
    insert into public.notifications (recipient_profile_id, enrollment_id, church_id, service_id, class_id, title, body, kind, link, source, data)
    values (r.id, c.enrollment_id, c.church_id, c.service_id, c.class_id,
            case c.kind when 'group' then coalesce(c.subject, 'المجموعة') || ' · ' || p.name else p.name end,
            left(coalesce(nullif(trim(p_body), ''), '📷 صورة'), 140), 'message', '/messaging/chat/' || c.id, 'system',
            jsonb_build_object('conversation_id', c.id, 'message_id', v_id, 'from_person', p.id));
  end loop;
  return v_id;
end $$;
grant execute on function public.child_portal_send(text, uuid, text, text) to anon, authenticated;

create or replace function public.child_portal_open_direct(p_national_id text, p_enrollment uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare p public.persons; e public.enrollments; s public.messaging_settings;
begin
  p := public.child_portal_person(p_national_id);
  select * into e from public.enrollments where id = p_enrollment and person_id = p.id;
  if e.id is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not public.module_granted_for('messaging', e.church_id, e.service_id, e.class_id) then raise exception 'module_not_visible' using errcode = 'P0001'; end if;
  s := public.msg_settings_for(e.church_id);
  if not coalesce(s.children_can_start, true) and not exists (select 1 from public.conversations c where c.kind = 'direct' and c.enrollment_id = e.id) then
    raise exception 'cannot_start' using errcode = 'P0001';
  end if;
  return public.msg_ensure_direct_conversation(e.id, null);
end $$;
grant execute on function public.child_portal_open_direct(text, uuid) to anon, authenticated;

create or replace function public.child_portal_badge(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.persons;
begin
  p := public.child_portal_person(p_national_id);
  return jsonb_build_object(
    'unread_notifications', (select count(*) from public.notifications n where n.recipient_person_id = p.id and n.read_at is null),
    'unread_messages', coalesce((select sum((x->>'unread')::int) from jsonb_array_elements(public.child_portal_conversations(p_national_id)) x), 0),
    'module_granted', exists (select 1 from public.enrollments e where e.person_id = p.id and public.module_granted_for('messaging', e.church_id, e.service_id, e.class_id)));
end $$;
grant execute on function public.child_portal_badge(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 17. OUTBOUND QUEUE — servant marks sent / cancelled (batch)
-- ---------------------------------------------------------------------
create or replace function public.msg_queue_mark(p_ids uuid[], p_status text)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not public.module_visible('messaging') then raise exception 'module_not_visible'; end if;
  if p_status not in ('sent', 'cancelled', 'failed') then raise exception 'invalid_status'; end if;
  with u as (
    update public.outbound_queue q set status = p_status, sent_by = auth.uid(), sent_at = case when p_status = 'sent' then now() else sent_at end
     where q.id = any(p_ids) and q.status = 'pending'
       and ((q.church_id is null and public.is_owner()) or public.msg_scope_visible(q.church_id, q.service_id, q.class_id))
    returning 1)
  select count(*) into n from u;
  return n;
end $$;
grant execute on function public.msg_queue_mark(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 18. STORAGE — chat attachments (photos bucket, folder messages/)
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from storage.buckets where id = 'photos') then
    drop policy if exists "photos_messages_upload" on storage.objects;
    create policy "photos_messages_upload" on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'photos' and (storage.foldername(name))[1] = 'messages');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 19. REALTIME
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['notifications', 'conversations', 'conversation_members', 'messages', 'message_automations',
                           'message_deliveries', 'outbound_queue', 'message_campaigns', 'messaging_settings', 'message_templates'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.notifications replica identity full;
alter table public.messages replica identity full;
alter table public.conversations replica identity full;

-- ---------------------------------------------------------------------
-- 20. pg_cron (when the extension exists on the project) — every 5 min
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'messaging_tick';
    perform cron.schedule('messaging_tick', '*/5 * * * *', 'select public.messaging_tick(false)');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 21. SEED — global default templates (church_id null)
-- ---------------------------------------------------------------------
insert into public.message_templates (church_id, name, category, title, body)
select null, x.name, x.category, x.title, x.body from (values
  ('تهنئة عيد ميلاد', 'birthday', 'كل سنة وأنت طيب[ضمير] 🎂', 'كل سنة وأنت طيب[ضمير] يا [الاسم الأول] 🎉 عيد ميلاد سعيد وربنا يفرّح قلبك — أسرة [اسم الفصل] · [اسم الكنيسة]'),
  ('افتقاد غياب', 'absent', 'وحشتنا يا [الاسم الأول]', 'وحشتنا يا [الاسم الأول] 💙 لاحظنا غيابك عن [اسم المناسبة] يوم [يوم الغياب] — منتظرينك المرة الجاية، ولو محتاج[ضمير] أي حاجة كلمنا'),
  ('ترحيب بمخدوم جديد', 'welcome', 'أهلاً بك في [اسم الفصل] 🎉', 'أهلاً وسهلاً يا [الاسم الأول] في أسرة [اسم الفصل] بـ [اسم الكنيسة] ✨ فرحانين بوجودك معنا'),
  ('تذكير بالمناسبة', 'reminder', 'تذكير: [اسم المناسبة] ⏰', 'يا [الاسم الأول]، [اسم المناسبة] هتبدأ الساعة [وقت المناسبة] يوم [يوم المناسبة] — منتظرينك 🙏'),
  ('تهنئة بالنقاط', 'points', 'مبروك! 🌟', 'برافو يا [الاسم الأول] 👏 وصلت لـ [النقاط] نقطة! استمر[ضمير]'),
  ('نتيجة الامتحان', 'exam', 'نتيجة [اسم الامتحان]', 'يا [الاسم الأول]، نتيجتك في [اسم الامتحان]: [الدرجة] من [الدرجة الكاملة] ([النسبة]) — [النتيجة]'),
  ('إعلان عام', 'announcement', 'إعلان مهم 📢', 'إلى كل أسرة [اسم الفصل]: ')
) as x(name, category, title, body)
where not exists (select 1 from public.message_templates t where t.church_id is null and t.name = x.name);

commit;
