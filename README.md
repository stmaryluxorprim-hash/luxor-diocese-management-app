# إدارة الإيبارشية — Diocese Management PWA

## Project Overview
- **Name**: Diocese Management (إدارة الإيبارشية)
- **Goal**: Multi-tenant PWA to manage a diocese: churches → services → classes → children, with role-based access, attendance scanning and points.
- **Stack**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + Lucide icons + Supabase (Auth, Postgres + RLS, Realtime, Storage)
- **Language/Direction**: Arabic, RTL
- **Deployment target**: Vercel (frontend) + Supabase (backend)

## URLs
- **GitHub**: https://github.com/stmaryluxorprim-hash/luxor-diocese-management-app
- **Sandbox preview (temporary)**: https://3000-iasoiimzq7wdii4b7vorc-583b4d74.sandbox.novita.ai
- **Production**: (deploy to Vercel — see below)

## Architecture — PERSON-CENTRIC (migration 0011)
The app is built on **persons**. Every person has one identity row; he can be
bound to many churches / services / classes through **enrollments**.

```
persons (الأشخاص — identity table)
  id (db id) · national_id (= QR code, unique) · name · birthdate
  gender (male/female) · phone · address · notes · image_url

enrollments (التسجيلات — person bound to a place)
  person_id → persons
  church_id → churches      (كنيسة)
  service_id → services     (خدمة — e.g. مدارس الأحد)
  class_id → classes        (فصل)
  attendance_count · points  (per-enrollment counters)
```

**One person → many enrollments.** Adding a person in any module (e.g. Sunday
school) sends his data to `persons` (upsert by `national_id`), then registers
him as an enrollment in that church + service + class — both steps are done by
the `add_person_and_enroll` RPC. Attendance (scanner / children page) resolves
the scanned **national id → person → enrollment** and logs against the
enrollment (`attendance`, `attendance_log`, `points_log` all use
`enrollment_id`).

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
- ✅ **Person-centric core (0011)**: `persons` (national_id = QR) + `enrollments`; one person in many churches/services/classes; existing children data migrated automatically
- ✅ المخدومين: realtime list on enrollments+persons, search by name/phone/national id, add person (single & bulk) via `add_person_and_enroll` RPC with duplicate-person detection by national id
- ✅ الماسح: QR camera scan (native BarcodeDetector) of national id + manual attendance; multi-enrollment picker; +1 point per attendance; duplicate-day protection
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
2. SQL Editor → run **all** migrations in `supabase/migrations/` in numeric order (`0001` → `0019`); `0002_bootstrap_owner.sql` runs after step 5
   ⚠️ In `0005` the `alter type ... add value 'suspended'` must run in its own query before the rest of the file
   ⚠️ `0019_performance_rls_indexes_rpc.sql` is **required** by the current frontend (stats / home / scanner call its RPCs). It is safe to re-run (idempotent).
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

## Card Designer Module (تصميم الكروت) — migrations 0017 + 0018
Design & print ID cards for the children. `/settings/cards` lists templates
(scoped church → service → class like events/causes, table `card_templates`,
JSONB `design` + `print_settings`, schema in `src/lib/card-types.ts`).
Each template row has a gold 🔗 rebind button — re-bind the design to another
church / service / class (with "كل الـ..." options) without redesigning.

**Design tab** (`/settings/cards/[id]`):
- Card width / height / corner roundness in mm (presets: CR80 ID, A6, A7, square)
- Background: color, uploaded image with fit mode (cover/contain/stretch/tile) + opacity, border color/width
- Elements (drag to move, layer up/down, rotate, opacity, corner radius):
  - **Variables** per child: name, age (computed), birthdate, phone, national id, address, photo, QR (national id = scanner code)
  - **Constants**: church / service / class names, church logo, free text, uploaded image
- Text style per element: 10 fonts (8 Arabic Google fonts + Arial/Times), size (pt), color, bold/italic, align
- Per-element **box background** (color + opacity) and **stroke** (border that follows the element's rounded corners, color + width in mm)
- **Lock aspect ratio** per element (resize handles + W/H inputs keep the ratio; QR defaults to locked)

**Print tab**: paper size (A3/A4/A5/Letter/custom), orientation, 4 margins,
horizontal & vertical gaps between cards, cut marks, **page center lines**
(vertical / horizontal / both — shown in preview AND printed), live page preview
with computed cols×rows layout — prints via a mm-exact hidden sheet (`@page`
sized, browser print dialog).

**Who to print** (من تريد طباعته؟):
- Church / service / class selectors, each with a "كل الـ..." (all) option —
  the printed card constants (church/service/class names, logo) follow each
  person's own enrollment, not the template scope
- **اختيار يدوي** — manual picker (search + select all) over the scoped children
- **المطلوب طباعتهم** — requested queue (table `card_print_requests`, migration
  `0018`, realtime): the children page has a "طباعة كارت" job — tapping the violet
  🖨 button on a child sends a print request; duplicates are rejected with a
  clear message (unique enrollment constraint). In the queue you can print all
  visible or only checked requests, delete one (✕), delete selected, delete all,
  and optionally auto-delete printed requests after printing (with confirm).

## Attendance & points badges on the children page (سجل الحضور / سجل النقاط)
Each person card shows two **round-square badge buttons** under the name —
attendance first, then points:
- **Attendance badge** (green, `CalendarCheck`): when an event is selected in
  the attendance job, it shows how many times this person attended **that
  event**; with no event selected it shows the **total attendance across all
  events** (`enrollments.attendance_count`). Tapping it opens **سجل الحضور**
  (`AttendanceLogModal` in `src/components/LogModals.tsx`): every
  `attendance_log` row of the enrollment — event name, Cairo day, points
  granted, recorded-at + recording servant — with a toggle between the
  selected event and all events, and a count / points summary strip.
- **Points badge** (gold, `Star`): the current balance. Tapping it opens
  **سجل النقاط** (`PointsLogModal`): `points_log` (cause points, ± delta)
  merged with the points that came with attendance (`attendance_log.points_delta`),
  newest first, with a filter (all / أسباب النقاط / نقاط الحضور) and added /
  removed / net totals.

The per-event counts come from the same `attendance_log` fetch used for card
coloring (one query per selected event), so no extra migration is needed.

## Performance & Scale Architecture — migration 0019
The app is designed so that cost grows with **what is on screen**, not with the
size of the database. Everything below was validated on a local Postgres 17
with 3,500 enrollments / 10,866 attendance rows and all 19 migrations applied
(per-role visible counts exact, zero cross-scope leaks, cross-scope writes
rejected by RLS).

### Database (`0019_performance_rls_indexes_rpc.sql`)
- **One scope lookup per statement** — `my_scope()` reads the caller's profile
  once; every policy uses `(select …)` wrappers so Postgres evaluates them as
  InitPlans instead of once per row (the old policies re-ran 3–4 functions per
  row per table).
- `enrollment_visible(...)` — a single IMMUTABLE expression that encodes the
  role / null-scope-means-all rules for enrollments, attendance, points and
  print requests.
- **17 indexes** on every RLS/filter/join path (`enrollments(class_id, person_id)`,
  `attendance_log(event_id, attended_on)`, `persons(phone)`, `events(church_id)`, …).
- **Aggregation RPCs** (security *invoker* → RLS still applies):
  `stats_summary`, `stats_week`, `stats_leaderboard`, `dashboard_counts`,
  `lookup_enrollments_by_national_id`.

### Frontend (`src/lib/queries.ts`, `src/lib/realtime.ts`)
- **Server-side scoped + paginated lists** — the children page loads 200 rows
  per page for the selected church/service/class only, search runs in SQL
  (`persons!inner` + `ilike` on name/phone/national_id), "load more" appends.
- **Debounced, scoped realtime** — `useDebouncedRealtime` coalesces bursts of
  events into one reload (1.2–2 s), never overlaps reloads, filters
  subscriptions to the user's scope (`class_id=eq.…`), and pauses while the tab
  is hidden (one refresh on return).
- **Optimistic patches** — attendance/points mutations update the row locally
  instead of refetching the list.
- **Cached lookups** — churches/services/classes/events cached 60 s across pages.
- **No full-table downloads anywhere** — stats/home use RPC aggregates, the
  scanner resolves a QR via RPC, card printing fetches only the selected scope.

### Expected capacity (Vercel + Supabase)
| Plan | Persons (المخدومين) | Servants | Notes |
|---|---|---|---|
| Free + Free ($0) | ~5,000 | ~40 concurrent | DB pauses after 7 idle days, no backups — OK for pilot only |
| Supabase Pro ($25) + Vercel Hobby* | ~20,000 | ~150 concurrent | recommended production floor; daily backups |
| Pro + Pro ($45) | 20,000–50,000 | 300+ concurrent | Vercel Hobby is non-commercial; Pro adds team seats & analytics |

\*Vercel Hobby is for non-commercial use; a church ministry generally
qualifies but check Vercel's fair-use policy.

## Features Not Yet Implemented
- Child edit/delete UI, profile photo
- Push notifications
- Attendance history per date (all persons) view
- Export reports (Excel/PDF)
- Points store / rewards module

## Recommended Next Steps
1. Run migrations `0017_card_templates.sql`, `0018_card_print_requests.sql` **and `0019_performance_rls_indexes_rpc.sql`** in Supabase SQL editor
2. Deploy to Vercel and test the full approval flow
3. Attendance history + per-class reports

## Deployment
- **Platform**: Vercel + Supabase
- **Status**: ✅ Code complete for Phase 1 + performance/scale hardening (0019) — awaiting Supabase project + Vercel connect
- **Last Updated**: 2026-09-02
