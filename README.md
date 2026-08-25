# إدارة الإيبارشية — Diocese Management PWA

## Project Overview
- **Name**: Diocese Management (إدارة الإيبارشية)
- **Goal**: Multi-tenant PWA to manage a diocese: churches → services → classes → children, with role-based access, attendance scanning and points.
- **Stack**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + Lucide icons + Supabase (Auth, Postgres + RLS, Realtime, Storage)
- **Language/Direction**: Arabic, RTL
- **Deployment target**: Vercel (frontend) + Supabase (backend)

## URLs
- **GitHub**: https://github.com/stmaryluxorprim-hash/luxor-diocese-management-app
- **Sandbox preview (temporary)**: https://3000-i6jkl0qv5exjmcyr35gf7-82b888ba.sandbox.novita.ai
- **Production**: (deploy to Vercel — see below)

## Architecture
```
Church (كنيسة)
 └── Service (خدمة)          e.g. مدارس الأحد
      └── Class (فصل)        e.g. ابتدائي أول
           └── Child (مخدوم) name/phone/birthdate/address/notes/attendance/points
```

### Roles (multi-tenant, enforced by RLS at DB level)
| Role | Scope |
|---|---|
| مالك التطبيق `owner` | everything |
| مدير كنيسة `church_manager` | own church |
| مسؤول خدمة `service_manager` | own service |
| خادم فصل `class_servant` | own class |

### Signup / Approval flow
1. Servant signs up with **name, user id, phone, password** (`user_id` is mapped to `user_id@diocese.app` for Supabase Auth).
2. Profile is created with `status = pending` → user sees "طلبك قيد المراجعة".
3. Owner / church manager / service manager approves from **الإعدادات → طلبات انضمام الخدام**, assigning role + church/service/class.
4. Approval propagates **in realtime** — the waiting user is let in instantly.

## Currently Completed Features
- ✅ PWA: manifest (RTL/Arabic), service worker, installable, app icons
- ✅ Multi-tenant Postgres schema with **full RLS** (`supabase/migrations/0001_schema.sql`)
- ✅ Realtime enabled on all tables (dashboard, lists, approvals auto-update)
- ✅ Login / Signup (name, user id, phone, password) + approval workflow
- ✅ App shell: header (uploaded church logo + church name + service name) & bottom bar: الرئيسية، المخدومين، الماسح، الإحصائيات، الإعدادات
- ✅ الرئيسية: role-aware stat cards + quick actions
- ✅ المخدومين: realtime list, search, add child (auto class scoping for servants)
- ✅ الماسح: QR camera scan (native BarcodeDetector) + manual attendance; +1 point per attendance; duplicate-day protection
- ✅ الإحصائيات: totals, last-7-days chart, points leaderboard
- ✅ الإعدادات: profile (self-edit + photo), approvals, churches (with logo upload), services & classes (photos, church→service cascade), servants management
- ✅ دعوة خادم جديد: scoped invite link + QR per manager level (`/settings/invite`)
- ✅ إدارة الخدام: edit / suspend / delete scoped per level (`/settings/servants`), servant photos
- ✅ Null scope = "كل الـ...": manager with empty service/class scope covers everything under his parent scope (migration 0006)

## Functional Entry Points
| Path | Description |
|---|---|
| `/login`, `/signup` | Auth (public) |
| `/` | الرئيسية — dashboard |
| `/children` | المخدومين — list/search/add |
| `/scanner` | الماسح — QR + manual attendance |
| `/stats` | الإحصائيات |
| `/settings` | الإعدادات hub |
| `/settings/approvals` | approve/reject servant requests (scope defaults from request) |
| `/settings/invite` | invite link + QR scoped to manager level |
| `/settings/servants` | manage servants: edit/suspend/delete per level |
| `/settings/churches` | owner + church manager: manage churches + logos |
| `/settings/services` | manage services (photo, church select) |
| `/settings/classes` | manage classes (photo, church→service cascade) |
| `/signup?church=..&service=..&class=..` | invite-scoped signup (locked pre-fill) |

## Data Models & Storage
- **Tables**: `churches`, `services`, `classes`, `profiles`, `children`, `attendance` — all with RLS + realtime
- **Storage**: `church-logos` public bucket
- **Helper functions**: `my_role()`, `my_church()`, `can_access()` etc. (security-definer, no RLS recursion)
- **Triggers**: attendance insert/delete auto-updates child's `attendance_count` and `points`; profile guard prevents self-approval

## Setup Guide

### 1. Supabase
1. Create a project at supabase.com
2. SQL Editor → run migrations in order: `0001_schema.sql`, `0002_bootstrap_owner.sql` (after step 5), `0003_signup_scope.sql`, `0004_class_servant_edit.sql`, `0005_photos_and_servants.sql`, `0006_null_scope_means_all.sql`
   ⚠️ In `0005` the `alter type ... add value 'suspended'` must run in its own query before the rest of the file
3. **Authentication → Providers → Email**: disable "Confirm email"
4. Authentication → Users → Add user: `owner@diocese.app` + password
5. Copy that user's UUID into `supabase/migrations/0002_bootstrap_owner.sql` and run it
6. Login in the app with user id `owner` + your password

### 2. Local dev
```bash
cp .env.example .env.local   # fill in Supabase URL + anon key
npm install
npm run dev
```

### 3. Deploy to Vercel
1. vercel.com → New Project → import this GitHub repo
2. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy — done. PWA is installable from the browser.

## Features Not Yet Implemented
- Child QR card generation/printing (QR codes exist in DB per child)
- Child edit/delete UI, profile photo
- Push notifications
- Attendance history per child / per date view
- Export reports (Excel/PDF)
- Points store / rewards module

## Recommended Next Steps
1. Create the Supabase project, run migrations, bootstrap owner
2. Deploy to Vercel and test the full approval flow
3. Add QR card printing for children (feeds the scanner)
4. Attendance history + per-class reports

## Deployment
- **Platform**: Vercel + Supabase
- **Status**: ✅ Code complete for Phase 1 — awaiting Supabase project + Vercel connect
- **Last Updated**: 2026-08-25
