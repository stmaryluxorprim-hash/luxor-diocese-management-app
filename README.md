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

### Scope hierarchy — church → service → class → **event** (migration 0022)
The **event (المناسبة)** is the 4th level of the scope hierarchy. On the
children page and the scanner the control panel has **four scope selectors**
(كنيسة · خدمة · فصل · مناسبة) and every operation is bound to the selected
event:
- **الحضور** — attendance is registered *for this event* (`attendance_log.event_id`).
- **النقاط** — points are given *in this event* (`points_log.event_id`, new in 0022;
  the manual points modal on the scanner too). A DB trigger rejects an event
  whose scope doesn't cover the enrollment.
- **مكالمة** — a call is a *follow-up for this event* (`contact_log`, kind `call`).
- **رسالة** — WhatsApp / SMS / internal messages are logged *in relation to this
  event* (`contact_log`, kind `whatsapp | sms | internal`, with the message text).
  The template supports `[اسم المناسبة]`.

In the settings hub **إدارة المناسبات** sits directly after **إدارة الفصول**.

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
- ✅ الماسح: **same system as المخدومين** — church → service → class scope selectors, job selector (الحضور / النقاط / البيانات) with the same mode buttons; the chosen job runs on the person the moment his QR (national id) is scanned. QR camera (native BarcodeDetector) + scoped manual search; multi-enrollment picker; **archive of scan operations** below (timestamped list of every attendance / points / data action with delta & balance — no child cards)
  - الحضور: event dropdown + تسجيل / إزالة + event points badge (numpad for editable/open), day/time window enforced
  - النقاط: cause dropdown + إضافة / خصم + **يدوي (new)** — scanning opens a modal with the child's name & **live balance** (realtime subscription on the enrollment row), a tappable number that opens the same **NumPad**, a cause dropdown and إضافة / خصم buttons that apply the number — the modal **stays open** after each operation so the servant can keep adjusting
  - البيانات: عرض / تعديل / حذف — scanning opens the matching person modal
- ✅ **الإحصائيات (rebuilt, 0020)**: church → service → class cascading selectors (each with "كل الـ…"), working-day picker, totals (المخدومين / النقاط / الحضور / الفصول), gender split, day summary, attendance of the day **by event**, points of the day **by cause**, per-class breakdown, attendance-over-time chart **stacked by event** (7d–365d presets or custom range; day/week/month buckets), points-over-time by cause, weekday profile, points/attendance leaderboard, one-click **Excel export** (8 sheets) — all realtime
- ✅ الإعدادات: profile (self-edit + photo), approvals, churches (with logo upload), services & classes (photos, church→service cascade), servants management
- ✅ دعوة خادم جديد: scoped invite link + QR per manager level (`/settings/invite`)
- ✅ إدارة الخدام: edit / suspend / delete scoped per level (`/settings/servants`), servant photos
- ✅ Null scope = "كل الـ...": manager with empty service/class scope covers everything under his parent scope (migration 0006)
- ✅ **بوابة المخدوم / Child Portal (0021)**: "دخول المخدوم" button on `/login` → `/child/login` scans the child's QR (camera, **gallery image**, or typed code) → portal with the **same header style** (church logo / service · class) and a **bottom bar**: الرئيسية، الحضور، النقاط، البيانات، الخيارات. Main page shows name, picture, attendance & points; الحضور lists every attendance by day with event, registration date & time and points; النقاط shows balance + every addition/deduction by cause or attendance; البيانات shows the child's data, QR (downloadable) and picture — the child can **upload a new picture** or **request data changes** (name / birthdate / gender / phone / address) which go to the managers as *change requests* to be **approved or denied**; الخيارات: profile, refresh, install hint, logout
- ✅ **المناسبة = المستوى الرابع (0022)**: 4th scope selector (كنيسة → خدمة → فصل → مناسبة) on the children page & scanner; attendance / points / calls / messages are all bound to the selected event (`points_log.event_id`, new `contact_log`); **status badge** (حاضر / لم يُسجّل / غائب) placed **before** the attendance & points badges, computed for the working day/time and recurring-event windows; status filter in الفلاتر; إدارة المناسبات moved right after إدارة الفصول in الإعدادات
- ✅ **نتيجة الافتقاد (0023)**: a **call-feedback badge right after the status badge** on every child card (children page + scanner). Two clocks: the **working (frozen) date picks the occurrence**, the **real date decides whether its follow-up cycle is still open**. Default **لم يُفتقد بعد** while the cycle is open (real time between the occurrence start and the next occurrence start); if the cycle has **closed in real time** (e.g. the working date is frozen before the last occurrence) and no feedback was recorded it shows **لم يُفتقد** and is read-only. Clicking it opens a modal with the **colored feedback buttons** (+ اتصال, history, undo); picking one makes it the badge. Feedbacks are managed in **إدارة نتائج الافتقاد** (`/settings/call-feedbacks`) with a **name, color and icon**, bound to **church → service → class → event** (null = all). A **نتيجة الافتقاد filter** (الكل / لم يُفتقد بعد / لم يُفتقد / each feedback) lives in الفلاتر
- ✅ **طلبات تعديل البيانات** (`/settings/data-requests`): class servant, service manager, church manager or owner of the child's scope reviews pending requests (photo before/after or field diff), approves (applied to `persons`) or rejects with a note — realtime, with a pending-count badge on الإعدادات and in the side menu

## Functional Entry Points
| Path | Description |
|---|---|
| `/login`, `/signup` | Auth (public) |
| `/` | الرئيسية — dashboard |
| `/children` | المخدومين — list/search/add |
| `/scanner` | الماسح — scope + job (attendance / points / data) applied on scan; live manual points modal (NumPad, stays open); scan-operations archive |
| `/stats` | الإحصائيات — scoped KPIs, by-event / by-cause breakdowns, timelines, leaderboard, Excel export |
| `/settings` | الإعدادات hub |
| `/settings/approvals` | approve/reject servant requests (scope defaults from request) |
| `/settings/invite` | invite link + QR scoped to manager level |
| `/settings/servants` | manage servants: edit/suspend/delete per level |
| `/settings/churches` | owner + church manager: manage churches + logos |
| `/settings/services` | manage services (photo, church select) |
| `/settings/classes` | manage classes (photo, church→service cascade) |
| `/signup?church=..&service=..&class=..` | invite-scoped signup (locked pre-fill) |
| `/child/login` | **بوابة المخدوم** — scan QR (camera / gallery / typed national id), public |
| `/child` | child main page: name, picture, attendance & points, enrollments, latest activity |
| `/child/attendance` | child attendance: by day, event filter, registration date/time, points |
| `/child/points` | child points: balance, added/removed, by cause / attendance |
| `/child/data` | child data + QR + picture; upload picture / request data change; request history & cancel |
| `/child/options` | child options: profile, refresh, install, logout |
| `/settings/data-requests` | managers: approve / reject children's photo & data change requests |
| `/settings/call-feedbacks` | **إدارة نتائج الافتقاد** — call-feedback presets (name, color, icon) scoped church → service → class → event, reorderable |

## Data Models & Storage
- **Tables**: `churches`, `services`, `classes`, `profiles`, `children`, `attendance` — all with RLS + realtime
- **Storage**: `church-logos` public bucket
- **Helper functions**: `my_role()`, `my_church()`, `can_access()` etc. (security-definer, no RLS recursion)
- **Triggers**: attendance insert/delete auto-updates child's `attendance_count` and `points`; profile guard prevents self-approval

## Setup Guide

### 1. Supabase
1. Create a project at supabase.com
2. SQL Editor → run **all** migrations in `supabase/migrations/` in numeric order (`0001` → `0023`); `0002_bootstrap_owner.sql` runs after step 5
   ⚠️ In `0005` the `alter type ... add value 'suspended'` must run in its own query before the rest of the file
   ⚠️ `0019_performance_rls_indexes_rpc.sql` is **required** by the current frontend (home / scanner call its RPCs). It is safe to re-run (idempotent).
   ⚠️ `0020_statistics_rpcs.sql` is **required** by the الإحصائيات tab (all `stats_*` RPCs). Idempotent; depends on 0019 (`my_scope()`, `enrollment_visible()`).
   ⚠️ `0021_child_portal.sql` is **required** by بوابة المخدوم (`/child/*`) and `/settings/data-requests`. Creates `data_change_requests`, the `child_portal_*` RPCs (SECURITY DEFINER, granted to `anon`, keyed by the scanned national id), `review_data_change_request` / `pending_data_requests_count` (authenticated) and a storage policy letting the portal upload into `photos/child-requests/`. Idempotent; run after 0020.
   ⚠️ `0022_event_bound_operations.sql` is **required** by the current children page & scanner (points inserts send `event_id`; calls / messages insert into `contact_log`). Adds `points_log.event_id`, the `contact_log` table (RLS + realtime), scope-check triggers and an `event_name` column on `child_portal_points`. Idempotent; run after 0021.
   ⚠️ `0023_call_feedbacks.sql` is **required** for the call-feedback badge / modal / filter and `/settings/call-feedbacks`. Adds the `call_feedbacks` table (scope church/service/class/event, `color`, `icon`, `sort_order`, RLS, realtime) and `contact_log.feedback_id` + `contact_log.occurrence_on`. Idempotent; run after 0022. Without it the badge stays on «لم يُفتقد بعد» and the modal shows a migration hint.
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

## Status, attendance & points badges on the children page (سجل الحضور / سجل النقاط)
Each person card shows badges under the name — **status** first (only when an
event is selected), then attendance, then points:
- **Status badge** (`childEventStatus` in `src/lib/time.ts`) — the child's
  state in the selected event at the working date-time (`useAppDate`):
  - **حاضر (present)** — green: an `attendance_log` row exists for this event
    on the current occurrence day.
  - **لم يُسجّل (not registered)** — grey: not attended and we are *inside*
    the event's day/time (or before it starts).
  - **غائب (absent)** — red: not attended and we are *after* the event's
    date-time. For a **one-time** event that is forever after its end; for a
    **recurring** (weekly) event it lasts from the end of an occurrence until
    the start of the next occurrence (`currentOccurrence` walks back ≤ 7 days
    to find the last occurrence day).
  The same status drives the card tint and the **status filter** in الفلاتر.
- Then the two **badge buttons**:
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

## Statistics Architecture — migration 0020
The الإحصائيات tab (`src/app/stats/page.tsx`) never downloads raw rows; every
number comes from a SECURITY INVOKER RPC in `0020_statistics_rpcs.sql`, so RLS
still applies and a class servant only ever sees his own class even when he
passes another church's id.

| RPC | Returns |
|---|---|
| `stats_scope_summary(p_church, p_service, p_class)` | enrollments, persons, males/females, total attendance & points, events/causes/classes count, first/last attendance |
| `stats_day_summary(p_day, …)` | attendance, unique attendees, events attended, attendance points, cause points ±, scope persons |
| `stats_attendance_by_event(p_day, …)` | per event: attendance, attendees, points, eligible, first/last time — sorted by event |
| `stats_points_by_cause(p_day, …)` | per cause: entries, recipients, added, removed, net — sorted by cause |
| `stats_attendance_timeline(p_from, p_to, p_bucket, …)` | attendance per bucket (day/week/month) **per event** — feeds the stacked chart |
| `stats_points_timeline(p_from, p_to, p_bucket, …)` | points per bucket per cause |
| `stats_attendance_by_class(p_day, …)` | per class: enrolled, attendees, attendance, points |
| `stats_leaderboard_scoped(p_by, p_limit, …)` | top persons by points or attendance |
| `stats_weekday_profile(p_from, p_to, …)` | attendance per weekday (Cairo) |

`null` for any scope parameter means "all" (the UI sends `ALL` → `null`). All
dates are Africa/Cairo (`attended_on`, `(created_at at time zone 'Africa/Cairo')::date`).
Two extra indexes (`points_log` Cairo-day expression, `points_log(cause_id)`) keep
the by-cause queries indexed. Frontend helpers live in `src/lib/stats.ts`
(typed fetchers, period/bucket/series builders) and pure-SVG chart primitives in
`src/components/stats/Charts.tsx` (no chart library).

### Expected capacity (Vercel + Supabase)
| Plan | Persons (المخدومين) | Servants | Notes |
|---|---|---|---|
| Free + Free ($0) | ~5,000 | ~40 concurrent | DB pauses after 7 idle days, no backups — OK for pilot only |
| Supabase Pro ($25) + Vercel Hobby* | ~20,000 | ~150 concurrent | recommended production floor; daily backups |
| Pro + Pro ($45) | 20,000–50,000 | 300+ concurrent | Vercel Hobby is non-commercial; Pro adds team seats & analytics |

\*Vercel Hobby is for non-commercial use; a church ministry generally
qualifies but check Vercel's fair-use policy.

## Child Portal Architecture — migration 0021
- **No auth account for children.** The QR value (`persons.national_id`) is the bearer token: the browser stores it in `localStorage` (`child_portal_token`) and passes it as `p_national_id` to `child_portal_profile / attendance / points / requests / submit_request / cancel_request` (SECURITY DEFINER RPCs executable by `anon`). Nothing else is readable by `anon`; `/child` is public in `middleware.ts`.
- **QR decoding** (`src/lib/qr-decode.ts`): native `BarcodeDetector` when available, otherwise `jsqr` on canvas frames; gallery images are decoded at several down-scales.
- **Change requests** (`data_change_requests`): `kind = 'data' | 'photo'`, `changes` jsonb (whitelisted fields: name, birthdate, gender, phone, address — or `image_url` for photos), `previous` snapshot, `status = pending | approved | rejected | cancelled`. Only one pending request per person & kind. Managers see requests via RLS (`can_access_person`) and decide with `review_data_change_request(p_request, p_approve, p_note)`; approval writes the changes into `persons`. Realtime keeps both the child's page and the review page in sync.

## Event-bound operations — migration 0022
- `points_log.event_id uuid → events (on delete set null)` + index; trigger
  `check_points_event_scope` rejects an event that doesn't cover the
  enrollment's church / service / class.
- `contact_log (enrollment_id, event_id, kind call|whatsapp|sms|internal,
  message, contacted_on, recorded_by)` — every call / message from the children
  page is logged as a follow-up for the selected event (fire-and-forget, never
  blocks the dialer / WhatsApp). RLS uses the `enrollment_visible` InitPlan
  pattern from 0019; realtime enabled.
- `child_portal_points` now returns an extra `event_name` column so the child
  portal can show which event points were given in.
- Frontend: `src/lib/time.ts` (`childEventStatus`, `currentOccurrence`,
  `CHILD_STATUS_LABELS`), `src/lib/types.ts` (`PointsLog.event_id`,
  `ContactLog`), children page, scanner (incl. manual points modal), settings
  hub order, `PointsLogModal` shows the event of each entry.

## Call feedback — migration 0023 (نتيجة الافتقاد)
- `call_feedbacks (church_id, service_id?, class_id?, event_id?, name, color hex,
  icon lucide-key, sort_order, audit)` — null service / class / event = "all".
  Trigger `check_call_feedback_event_scope` rejects an event outside the row's
  church / service / class. RLS: select via `scope_overlaps`, write via
  `scope_contains` (InitPlan pattern from 0019). Realtime enabled.
- `contact_log.feedback_id → call_feedbacks (on delete set null)` and
  `contact_log.occurrence_on date` (the occurrence the call is about); partial
  index `idx_contact_log_feedback_lookup`. `check_contact_event_scope()` also
  verifies the feedback applies to the enrollment + event.
- **Follow-up cycle** (`src/lib/call-feedback.ts` → `followUpCycle(ev, working, real)`):
  a cycle runs from an occurrence's start until the next occurrence starts.
  **Two clocks**: the *working* date (frozen override from the header, or live)
  is the secondary player — it picks `target`, the occurrence whose cycle
  contains it; the *real* date is the main player — it picks `realTarget` and
  therefore `status`: `open` (target = realTarget → feedback can be recorded /
  changed), `closed` (target < realTarget → final, read-only), `future`
  (target > realTarget → nothing to record yet). `beforeCreation` hides the
  badge when the target predates the event's `created_at`.
  `callFeedbackState` → `feedback` (latest row for target) | `wasnt_called`
  («لم يُفتقد», no feedback and status closed) | `not_called_yet`
  («لم يُفتقد بعد», no feedback, open or future). `canRecordFeedback` gates
  the modal buttons + undo.
- Frontend: `src/components/CallFeedback.tsx` (`CallFeedbackBadge`,
  `CallFeedbackModal`, `useCallFeedbackStates(supabase, rows, event, feedbacks, working, real)` — chunked fetch of on-screen
  enrollments for the `target` occurrence only), `src/lib/call-feedback.ts`
  (icons, color presets, `feedbackStyle`, `matchesCallFilter`),
  `src/lib/types.ts` (`CallFeedback`, `feedbackApplies`), `src/lib/time.ts`
  (`previousOccurrenceDate`), `cachedLookup('call_feedbacks')`, children page
  (badge + filter chips + realtime), scanner (badge + modal),
  `/settings/call-feedbacks` + hub link after إدارة أسباب النقاط.

## Features Not Yet Implemented
- Push notifications
- Attendance history per date (per-person list view for servants)
- PDF report export (Excel is done in الإحصائيات)
- Points store / rewards module

## Recommended Next Steps
1. Run migrations `0017` → `0023` (`0022` powers event-bound points / calls / messages; `0023_call_feedbacks.sql` powers the call-feedback badge & إدارة نتائج الافتقاد) in Supabase SQL editor
2. Deploy to Vercel and test the full approval flow
3. Per-person attendance history view

## Deployment
- **Platform**: Vercel + Supabase
- **Status**: ✅ Code complete for Phase 1 + performance/scale hardening (0019) + statistics tab (0020) + child portal & data change requests (0021) + event as 4th scope level with status badge (0022) + call-feedback badge & إدارة نتائج الافتقاد (0023) — awaiting Supabase project + Vercel connect
- **Last Updated**: 2026-09-04
