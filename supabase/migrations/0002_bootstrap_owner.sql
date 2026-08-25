-- =====================================================================
-- Bootstrap the App Owner
-- HOW TO USE:
-- 1) In Supabase Dashboard > Authentication > Users, click "Add user"
--    and create the owner account (email + password).
--    TIP: the app logs in with  <user_id>@diocese.app  as the email,
--    so create e.g.  owner@diocese.app
-- 2) Copy the created user's UUID and replace OWNER_AUTH_UUID below.
-- 3) Run this script in the SQL editor.
-- =====================================================================

insert into public.profiles (id, full_name, user_id, phone, role, status, approved_at)
values (
  'OWNER_AUTH_UUID',           -- <<< replace with auth.users UUID
  'مالك التطبيق',
  'owner',
  '0000000000',
  'owner',
  'approved',
  now()
)
on conflict (id) do update
  set role = 'owner', status = 'approved', approved_at = now();
