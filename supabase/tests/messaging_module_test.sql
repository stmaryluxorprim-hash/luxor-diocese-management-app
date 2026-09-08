-- =====================================================================
-- Functional test for migration 0029 (الرسائل والإشعارات). Run on the local
-- shim DB after run_migrations.sh:  psql -d app -f supabase/tests/messaging_module_test.sql
-- Every "assert" raises on failure; a clean run ends with «MESSAGING TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant (class A)
  ('00000000-0000-0000-0000-000000000003'),  -- class servant (class B)
  ('00000000-0000-0000-0000-000000000004');  -- service manager
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.profiles (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '01011111111', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'خادم ب', 'servant_b', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'svc_mgr', '0103', 'service_manager', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null);
insert into public.persons (id, national_id, name, birthdate, phone, gender) values
  ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا جورج',  (current_date - interval '10 years')::date, '01000000001', 'male'),
  ('40000000-0000-0000-0000-000000000002', '29901010000002', 'مريم سامي',  '2016-03-05', null, 'female'),
  ('40000000-0000-0000-0000-000000000003', '29901010000003', 'يوسف',  '2014-03-20', '01000000003', 'male');
insert into public.enrollments (id, person_id, church_id, service_id, class_id, points, created_at) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 90, '2024-01-01'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0, '2024-01-01'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 0, '2024-01-01');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('role', 'anon', true);
end $$;

-- ---------- 1. module NOT granted → everything refused / invisible ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    perform public.msg_send(null, null, null, 'children', '{}', array['in_app'], 'x', 'y');
    raise exception 'send allowed without module grant';
  exception when others then
    if sqlerrm not like '%module_not_visible%' then raise; end if;
  end;
  begin
    perform public.msg_open_direct('50000000-0000-0000-0000-000000000001');
    raise exception 'open_direct allowed without module grant';
  exception when others then
    if sqlerrm not like '%module_not_visible%' and sqlerrm not like '%forbidden%' then raise; end if;
  end;
  if (select count(*) from public.message_templates) <> 0 then raise exception 'templates visible without grant'; end if;
  if (select (public.msg_badge()->>'module_visible')::boolean) then raise exception 'badge says visible'; end if;
end $$;
reset role;

-- ---------- 2. owner grants the module; seeds visible; render works ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('messaging', null);
do $$
declare ctx jsonb; r text;
begin
  if (select count(*) from public.message_templates) < 5 then raise exception 'seed templates missing'; end if;
  ctx := public.msg_child_context('50000000-0000-0000-0000-000000000001');
  if ctx->>'الاسم الأول' <> 'مينا' then raise exception 'first name ctx: %', ctx->>'الاسم الأول'; end if;
  if ctx->>'اسم الفصل' <> 'فصل أ' then raise exception 'class ctx: %', ctx->>'اسم الفصل'; end if;
  if ctx->>'النقاط' <> '90' then raise exception 'points ctx: %', ctx->>'النقاط'; end if;
  r := public.msg_render('أهلاً [الاسم الأول] من [اسم الفصل] — [غير موجود]', ctx);
  if r <> 'أهلاً مينا من فصل أ — [غير موجود]' then raise exception 'render: %', r; end if;
  ctx := public.msg_child_context('50000000-0000-0000-0000-000000000002');
  if ctx->>'ضمير' <> 'ة' then raise exception 'female suffix expected, got %', ctx->>'ضمير'; end if;
end $$;

-- ---------- 3. audience preview + bulk send (in_app + whatsapp) ----------
do $$
declare pv jsonb; res jsonb;
begin
  pv := public.msg_audience_preview(null, null, null, 'both', '{}');
  if (pv->>'children_count')::int <> 3 then raise exception 'children_count %', pv->>'children_count'; end if;
  if (pv->>'children_with_phone')::int <> 2 then raise exception 'with_phone %', pv->>'children_with_phone'; end if;
  if (pv->>'servants_count')::int <> 4 then raise exception 'servants_count %', pv->>'servants_count'; end if;
  pv := public.msg_audience_preview('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'children', '{"gender":"female"}');
  if (pv->>'children_count')::int <> 1 then raise exception 'gender filter %', pv->>'children_count'; end if;

  res := public.msg_send('10000000-0000-0000-0000-000000000001', null, null, 'children', '{}', array['in_app', 'whatsapp'],
                         'مرحباً [الاسم الأول]', 'رسالة لـ [الاسم الكامل] في [اسم الفصل]', 'info', '/child', 'حملة تجريبية', false);
  if (res->>'recipients')::int <> 3 then raise exception 'recipients %', res; end if;
  if (res->>'sent')::int <> 3 then raise exception 'sent %', res; end if;
  if (select count(*) from public.notifications where recipient_person_id is not null) <> 3 then raise exception 'notifications count'; end if;
  if (select title from public.notifications where recipient_person_id = '40000000-0000-0000-0000-000000000001') <> 'مرحباً مينا' then raise exception 'rendered title'; end if;
  if (select count(*) from public.outbound_queue where status = 'pending') <> 2 then raise exception 'queue should hold 2 (children with phone)'; end if;
  if (select count(*) from public.message_campaigns) <> 1 then raise exception 'campaign row'; end if;
  if (select count(*) from public.message_deliveries where status = 'sent') <> 3 then raise exception 'deliveries'; end if;
  -- same campaign id twice is impossible; dedupe engine check via msg_deliver directly
  if public.msg_deliver('dup-test', array['in_app'], 't', 'b', 'info', null, '{}', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'manual') <> 'sent' then raise exception 'first deliver'; end if;
  if public.msg_deliver('dup-test', array['in_app'], 't', 'b', 'info', null, '{}', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'manual') <> 'duplicate' then raise exception 'dedupe failed'; end if;
end $$;

-- ---------- 4. quiet hours defer + release ----------
do $$
declare r text; d record;
begin
  insert into public.messaging_settings (church_id, quiet_hours_start, quiet_hours_end) values ('10000000-0000-0000-0000-000000000001', '00:00', '23:59');
  r := public.msg_deliver('quiet-1', array['in_app'], 'ليلاً', 'نص', 'info', null, '{}', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'manual');
  if r <> 'deferred' then raise exception 'expected deferred, got %', r; end if;
  select * into d from public.message_deliveries where dedupe_key = 'quiet-1';
  if d.deliver_at is null then raise exception 'deliver_at not set'; end if;
  -- lift quiet hours & backdate → release
  update public.messaging_settings set quiet_hours_start = null, quiet_hours_end = null where church_id = '10000000-0000-0000-0000-000000000001';
  update public.message_deliveries set deliver_at = now() - interval '1 minute' where dedupe_key = 'quiet-1';
  if public.msg_release_deferred() <> 1 then raise exception 'release count'; end if;
  if (select status from public.message_deliveries where dedupe_key = 'quiet-1') <> 'sent' then raise exception 'released status'; end if;
  if (select count(*) from public.notifications where title = 'ليلاً') <> 1 then raise exception 'released notification'; end if;
  -- respect_quiet=false bypasses quiet hours
  insert into public.messaging_settings (church_id, quiet_hours_start, quiet_hours_end) values (null, '00:00', '23:59')
    on conflict ((coalesce(church_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set quiet_hours_start = '00:00', quiet_hours_end = '23:59';
  update public.messaging_settings set quiet_hours_start = '00:00', quiet_hours_end = '23:59' where church_id = '10000000-0000-0000-0000-000000000001';
  r := public.msg_deliver('quiet-2', array['in_app'], 'عاجل', 'نص', 'alert', null, '{}', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'manual', null, null, null, false);
  if r <> 'sent' then raise exception 'respect_quiet=false should send, got %', r; end if;
  update public.messaging_settings set quiet_hours_start = null, quiet_hours_end = null;
end $$;

-- ---------- 5. conversations: direct (two-way), staff, group one-way ----------
do $$
declare cid uuid; sid uuid; g jsonb; mid uuid; inbox record;
begin
  cid := public.msg_open_direct('50000000-0000-0000-0000-000000000001');
  if cid is null then raise exception 'open_direct null'; end if;
  if public.msg_open_direct('50000000-0000-0000-0000-000000000001') <> cid then raise exception 'open_direct not idempotent'; end if;
  mid := public.msg_post(cid, 'أهلاً مينا');
  if (select messages_count from public.conversations where id = cid) <> 1 then raise exception 'messages_count'; end if;
  if (select last_message_preview from public.conversations where id = cid) <> 'أهلاً مينا' then raise exception 'preview'; end if;
  -- staff pair
  sid := public.msg_open_staff('00000000-0000-0000-0000-000000000002');
  if public.msg_open_staff('00000000-0000-0000-0000-000000000002') <> sid then raise exception 'staff pair not idempotent'; end if;
  perform public.msg_post(sid, 'رسالة للخادم أ');
  -- one-way group to class A children
  g := public.msg_create_group('إعلان الفصل', 'one_way', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '{}', 'أول إعلان');
  if (g->>'members')::int <> 2 then raise exception 'group members %', g; end if;
  select * into inbox from public.msg_inbox(200, null) where id = cid;
  if inbox.title <> 'مينا جورج' then raise exception 'inbox title %', inbox.title; end if;
  if inbox.class_name <> 'فصل أ' then raise exception 'inbox class'; end if;
  if (select count(*) from public.msg_inbox(200, null)) <> 3 then raise exception 'inbox should list 3'; end if;
  if (select count(*) from public.msg_inbox(200, 'staff')) <> 1 then raise exception 'inbox kind filter'; end if;
end $$;

-- servant A (class A) sees direct + staff + group; servant B sees nothing of them
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ declare b jsonb; begin
  if (select count(*) from public.msg_inbox(200, null)) <> 3 then raise exception 'servant A inbox should be 3, got %', (select count(*) from public.msg_inbox(200, null)); end if;
  b := public.msg_badge();
  if (b->>'unread_messages')::int < 1 then raise exception 'servant A should have unread staff message: %', b; end if;
  if (b->>'pending_queue')::int <> 2 then raise exception 'pending queue badge %', b; end if;
  -- mark read
  perform public.msg_mark_read((select id from public.conversations where kind = 'staff' limit 1));
  if (public.msg_badge()->>'unread_messages')::int <> 0 then raise exception 'mark read failed'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.msg_inbox(200, null)) <> 0 then raise exception 'servant B must not see class A conversations'; end if;
  begin
    perform public.msg_post((select id from public.conversations where kind = 'direct' limit 1), 'تسلل');
    raise exception 'servant B posted into foreign conversation';
  exception when others then
    if sqlerrm not like '%forbidden%' and sqlerrm not like '%not_found%' and sqlerrm not like '%not_member%' then raise; end if;
  end;
end $$;
reset role;

-- ---------- 6. child portal (anon) ----------
select pg_temp.as_anon();
do $$
declare convs jsonb; msgs jsonb; b jsonb; cid uuid; gid uuid;
begin
  if (select count(*) from public.child_portal_notifications('29901010000001')) < 2 then raise exception 'child notifications'; end if;
  b := public.child_portal_badge('29901010000001');
  if (b->>'unread_notifications')::int < 2 then raise exception 'child badge %', b; end if;
  convs := public.child_portal_conversations('29901010000001');
  if jsonb_array_length(convs) <> 2 then raise exception 'child should see direct + group, got %', convs; end if;
  select id into cid from public.conversations where kind = 'direct';
  select id into gid from public.conversations where kind = 'group';
  msgs := public.child_portal_messages('29901010000001', cid);
  if jsonb_array_length(msgs->'messages') <> 1 then raise exception 'child messages %', msgs; end if;
  if not (msgs->>'can_reply')::boolean then raise exception 'child should be able to reply in two-way'; end if;
  perform public.child_portal_send('29901010000001', cid, 'شكراً يا أبونا');
  if (select count(*) from public.messages where conversation_id = cid and sender_type = 'child') <> 1 then raise exception 'child send'; end if;
  begin
    perform public.child_portal_send('29901010000001', gid, 'رد على إعلان');
    raise exception 'child replied to one-way group';
  exception when others then
    if sqlerrm not like '%one_way%' and sqlerrm not like '%cannot_reply%' then raise; end if;
  end;
  -- another child cannot read مينا's conversation
  begin
    perform public.child_portal_messages('29901010000003', cid);
    raise exception 'foreign child read conversation';
  exception when others then
    if sqlerrm not like '%forbidden%' and sqlerrm not like '%not_found%' and sqlerrm not like '%not_member%' then raise; end if;
  end;
  perform public.child_portal_notifications_read('29901010000001', null);
  if (public.child_portal_badge('29901010000001')->>'unread_notifications')::int <> 0 then raise exception 'child read-all'; end if;
end $$;
reset role;

-- servant A now has an unread reply from the child
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (public.msg_badge()->>'unread_messages')::int <> 1 then raise exception 'child reply should be unread for servant A: %', public.msg_badge(); end if;
end $$;

-- ---------- 7. automations: event-based (points milestone, attendance, enrollment) ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
do $$
declare a_pts uuid; a_att uuid; a_new uuid; a_bd uuid; r jsonb;
begin
  insert into public.message_automations (church_id, name, trigger, trigger_config, audience, channels, title, body, kind)
  values ('10000000-0000-0000-0000-000000000001', 'هدف النقاط', 'points', '{"direction":"add","milestone":100}', 'children', array['in_app'], 'مبروك [الاسم الأول]', 'وصلت [الهدف] نقطة', 'celebration')
  returning id into a_pts;
  insert into public.message_automations (church_id, name, trigger, trigger_config, audience, channels, title, body, kind)
  values ('10000000-0000-0000-0000-000000000001', 'حضور', 'attendance', '{}', 'servants', array['in_app'], 'حضر [اسم المخدوم]', 'في [اسم المناسبة]', 'success')
  returning id into a_att;
  insert into public.message_automations (church_id, name, trigger, trigger_config, audience, channels, body, kind)
  values ('10000000-0000-0000-0000-000000000001', 'ترحيب', 'new_enrollment', '{}', 'children', array['in_app', 'chat'], 'أهلاً [الاسم الأول] في [اسم الفصل]', 'celebration')
  returning id into a_new;

  -- +5 points → 95, no milestone crossed
  insert into public.points_log (enrollment_id, delta) values ('50000000-0000-0000-0000-000000000001', 5);
  if (select count(*) from public.message_deliveries where automation_id = a_pts) <> 0 then raise exception 'milestone fired too early'; end if;
  -- +10 → 105 crosses 100
  insert into public.points_log (enrollment_id, delta) values ('50000000-0000-0000-0000-000000000001', 10);
  if (select count(*) from public.message_deliveries where automation_id = a_pts and status = 'sent') <> 1 then raise exception 'milestone did not fire'; end if;
  if (select body from public.notifications where automation_id = a_pts) <> 'وصلت 100 نقطة' then raise exception 'milestone body: %', (select body from public.notifications where automation_id = a_pts); end if;
  -- +3 → 108, same milestone bucket → nothing
  insert into public.points_log (enrollment_id, delta) values ('50000000-0000-0000-0000-000000000001', 3);
  if (select count(*) from public.message_deliveries where automation_id = a_pts) <> 1 then raise exception 'milestone re-fired'; end if;

  -- attendance → servants of class A scope (servant A, svc manager, owner) get in_app
  insert into public.attendance_log (enrollment_id, points_delta) values ('50000000-0000-0000-0000-000000000001', 1);
  if (select count(*) from public.notifications where automation_id = a_att) < 2 then raise exception 'attendance servants notified: %', (select count(*) from public.notifications where automation_id = a_att); end if;
  if (select count(*) from public.notifications where automation_id = a_att and recipient_profile_id = '00000000-0000-0000-0000-000000000003') <> 0 then raise exception 'servant B (class B) should not be notified'; end if;

  -- new enrollment → welcome (in_app + chat)
  insert into public.persons (id, national_id, name) values ('40000000-0000-0000-0000-000000000009', '29901010000009', 'جديد');
  insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
    ('50000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
  if (select count(*) from public.notifications where automation_id = a_new) <> 1 then raise exception 'welcome notification'; end if;
  if (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id where c.enrollment_id = '50000000-0000-0000-0000-000000000009' and m.via = 'automation') <> 1 then raise exception 'welcome chat message'; end if;
  if (select sent_count from public.message_automations where id = a_new) <> 1 then raise exception 'sent_count'; end if;

  -- preview template with sample enrollment
  r := public.msg_preview_template('يا [الاسم الأول]', 'نقاطك [النقاط]', '50000000-0000-0000-0000-000000000001');
  if r->>'title' <> 'يا مينا' then raise exception 'preview title %', r; end if;
  if r->>'body' <> 'نقاطك 108' then raise exception 'preview body %', r; end if;

  -- time-based birthday automation + run now (مينا's birthday is today)
  insert into public.message_automations (church_id, name, trigger, trigger_config, audience, channels, title, body, kind)
  values ('10000000-0000-0000-0000-000000000001', 'عيد ميلاد', 'birthday', '{"at":"09:00","days_before":0}', 'children', array['in_app'], 'كل سنة وأنت طيب [الاسم الأول]', 'تبلغ [السن الجديدة] سنة', 'celebration')
  returning id into a_bd;
  r := public.msg_run_now(a_bd);
  if (r->>'sent')::int <> 1 then raise exception 'run_now birthday %', r; end if;
  if (select body from public.notifications where automation_id = a_bd) <> 'تبلغ 10 سنة' then raise exception 'birthday age body: %', (select body from public.notifications where automation_id = a_bd); end if;
  -- scheduler tick (forced) must not error and must not double-send today's birthday
  r := public.messaging_tick(true);
  if r ? 'skipped' then raise exception 'tick skipped %', r; end if;
  if (select count(*) from public.message_deliveries where automation_id = a_bd) <> 1 then raise exception 'tick double-sent birthday'; end if;
end $$;

-- ---------- 8. scope guard: class servant cannot create church-wide automation ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    insert into public.message_automations (church_id, name, trigger, audience, body)
    values ('10000000-0000-0000-0000-000000000001', 'واسع', 'schedule', 'children', 'x');
    raise exception 'class servant created church-wide automation';
  exception when insufficient_privilege then null;
           when others then if sqlerrm not like '%forbidden%' then raise; end if;
  end;
  insert into public.message_automations (church_id, service_id, class_id, name, trigger, audience, body)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'فصلي', 'schedule', 'children', 'x');
  -- queue: mark own scope items as sent
  if public.msg_queue_mark(array(select id from public.outbound_queue where status = 'pending'), 'sent') <> 2 then raise exception 'queue mark'; end if;
  if (public.msg_badge()->>'pending_queue')::int <> 0 then raise exception 'queue badge after mark'; end if;
end $$;
reset role;

rollback;
\echo MESSAGING TESTS PASSED
