'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Search, Plus, Phone, MapPin, Star, CalendarCheck, X, Loader2, StickyNote,
  SlidersHorizontal, ChevronDown, School, Check, Minus,
  MessageSquare, Inbox, PenSquare,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import {
  JOBS, DEFAULT_ATTENDANCE_POINTS,
  type Job, type EnrollmentWithPerson, type ClassRoom, type Church, type Service,
} from '@/lib/types';

const ALL = 'all';

type AttendanceMode = 'add' | 'remove';
type PointsMode = 'add' | 'subtract';
type MessageChannel = 'whatsapp' | 'sms' | 'internal';

// ---------- Message template variables ----------
const MSG_VARS = [
  { token: '[الاسم الأول]', label: 'الاسم الأول' },
  { token: '[الاسم الكامل]', label: 'الاسم الكامل' },
  { token: '[تاريخ الميلاد]', label: 'تاريخ الميلاد' },
  { token: '[رقم الهاتف]', label: 'رقم الهاتف' },
];

const fillTemplate = (template: string, e: EnrollmentWithPerson) =>
  template
    .replaceAll('[الاسم الأول]', e.person.name.trim().split(/\s+/)[0] ?? '')
    .replaceAll('[الاسم الكامل]', e.person.name)
    .replaceAll('[تاريخ الميلاد]', e.person.birthdate ?? '')
    .replaceAll('[رقم الهاتف]', e.person.phone ?? '');

// WhatsApp brand icon (lucide has no official one)
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export default function ChildrenPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<EnrollmentWithPerson[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  // ---------- Search (first row) ----------
  const [search, setSearch] = useState('');

  // ---------- Scope selectors: church -> service -> class ----------
  // RLS already limits each user to their own scope, so every dropdown
  // only contains what the current user is allowed to see.
  const [churchFilter, setChurchFilter] = useState<string>(ALL);
  const [serviceFilter, setServiceFilter] = useState<string>(ALL);
  const [classFilter, setClassFilter] = useState<string>(ALL);

  // ---------- Job selector + activated modes ----------
  const [job, setJob] = useState<Job>('attendance');
  const [points, setPoints] = useState<number>(DEFAULT_ATTENDANCE_POINTS);
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>('add');
  const [pointsMode, setPointsMode] = useState<PointsMode>('add');
  const [messageChannel, setMessageChannel] = useState<MessageChannel>('whatsapp');
  const [messageTemplate, setMessageTemplate] = useState('');
  const [showCompose, setShowCompose] = useState(false);

  // ---------- Filter accordion ----------
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addressFilter, setAddressFilter] = useState('');
  const [minPoints, setMinPoints] = useState('');
  const [minAttendance, setMinAttendance] = useState('');

  // ---------- Expandable class groups ----------
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) =>
    setOpenGroups((g) => ({ ...g, [id]: !g[id] }));

  const [busyChild, setBusyChild] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Person-centric: an enrollment = a person bound to church/service/class
    const [{ data: enr }, { data: chs }, { data: svs }, { data: cls }] = await Promise.all([
      supabase.from('enrollments').select('*, person:persons(*)'),
      supabase.from('churches').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
    ]);
    const list = ((enr ?? []) as EnrollmentWithPerson[])
      .filter((e) => e.person)
      .sort((a, b) => a.person.name.localeCompare(b.person.name, 'ar'));
    setEnrollments(list);
    setChurches(chs ?? []);
    setServices(svs ?? []);
    setClasses(cls ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile, load]);

  // Realtime sync
  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel('persons-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'persons' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, supabase, load]);

  const safePoints = Math.max(0, Math.floor(Number(points) || 0));

  // ---------- Cascading selector options ----------
  const visibleServices = useMemo(
    () => services.filter((s) => churchFilter === ALL || s.church_id === churchFilter),
    [services, churchFilter]
  );
  const visibleClasses = useMemo(
    () =>
      classes.filter(
        (c) =>
          (churchFilter === ALL || c.church_id === churchFilter) &&
          (serviceFilter === ALL || c.service_id === serviceFilter)
      ),
    [classes, churchFilter, serviceFilter]
  );

  const onChurchChange = (v: string) => {
    setChurchFilter(v);
    setServiceFilter(ALL);
    setClassFilter(ALL);
  };
  const onServiceChange = (v: string) => {
    setServiceFilter(v);
    setClassFilter(ALL);
  };

  // ---------- Per-person job action (single button) ----------
  const doJob = async (e: EnrollmentWithPerson) => {
    if (job === 'attendance') {
      setBusyChild(e.id);
      // enrollment_id already identifies church/service/class
      await supabase.from('attendance_log').insert({
        enrollment_id: e.id,
        action: attendanceMode,
        points_delta: safePoints,
        recorded_by: profile?.id,
      });
      setBusyChild(null);
      load();
    } else if (job === 'points') {
      if (safePoints === 0) return;
      setBusyChild(e.id);
      await supabase.from('points_log').insert({
        enrollment_id: e.id,
        delta: (pointsMode === 'add' ? 1 : -1) * safePoints,
        recorded_by: profile?.id,
      });
      setBusyChild(null);
      load();
    } else if (job === 'call') {
      if (e.person.phone) window.location.href = `tel:${e.person.phone}`;
    } else if (job === 'message') {
      if (!e.person.phone) return;
      const digits = e.person.phone.replace(/\D/g, '');
      const waNumber = digits.startsWith('0') ? `2${digits}` : digits;
      const text = messageTemplate.trim() ? fillTemplate(messageTemplate, e) : '';
      if (messageChannel === 'whatsapp') {
        const url = text
          ? `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`
          : `https://wa.me/${waNumber}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      } else if (messageChannel === 'sms') {
        window.location.href = text
          ? `sms:${e.person.phone}?body=${encodeURIComponent(text)}`
          : `sms:${e.person.phone}`;
      }
      // internal: coming soon — button is disabled
    }
  };

  // ---------- Filters ----------
  const filtered = useMemo(
    () =>
      enrollments.filter((e) => {
        if (churchFilter !== ALL && e.church_id !== churchFilter) return false;
        if (serviceFilter !== ALL && e.service_id !== serviceFilter) return false;
        if (classFilter !== ALL && e.class_id !== classFilter) return false;
        if (
          search &&
          !(
            e.person.name.includes(search) ||
            (e.person.phone ?? '').includes(search) ||
            e.person.national_id.includes(search)
          )
        )
          return false;
        if (addressFilter && !(e.person.address ?? '').includes(addressFilter)) return false;
        if (minPoints && e.points < Number(minPoints)) return false;
        if (minAttendance && e.attendance_count < Number(minAttendance)) return false;
        return true;
      }),
    [enrollments, churchFilter, serviceFilter, classFilter, search, addressFilter, minPoints, minAttendance]
  );

  // ---------- Group by class (sorted by class name) ----------
  const groups = useMemo(() => {
    const byClass = new Map<string, EnrollmentWithPerson[]>();
    filtered.forEach((e) => {
      const arr = byClass.get(e.class_id) ?? [];
      arr.push(e);
      byClass.set(e.class_id, arr);
    });
    return Array.from(byClass.entries())
      .map(([classId, kids]) => ({
        classId,
        className: classes.find((c) => c.id === classId)?.name ?? 'فصل غير معروف',
        kids,
      }))
      .sort((a, b) => a.className.localeCompare(b.className, 'ar'));
  }, [filtered, classes]);

  const activeFilterCount =
    (addressFilter ? 1 : 0) + (minPoints ? 1 : 0) + (minAttendance ? 1 : 0);

  const resetFilters = () => {
    setAddressFilter('');
    setMinPoints('');
    setMinAttendance('');
  };

  // ---------- Per-person button appearance by job + activated mode ----------
  const childButton = (child: EnrollmentWithPerson) => {
    if (busyChild === child.id) {
      return <Loader2 className="h-6 w-6 animate-spin text-primary-500" />;
    }
    if (job === 'attendance') {
      const add = attendanceMode === 'add';
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label={add ? 'تسجيل حضور' : 'إزالة حضور'}
          onClick={() => doJob(child)}
          className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow transition active:scale-95 ${
            add ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'
          }`}
        >
          {add ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}
        </button>
      );
    }
    if (job === 'points') {
      const add = pointsMode === 'add';
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label={add ? 'إضافة نقاط' : 'خصم نقاط'}
          onClick={() => doJob(child)}
          className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow transition active:scale-95 ${
            add ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'
          }`}
        >
          {add ? <Plus className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
        </button>
      );
    }
    if (job === 'call') {
      return (
        <button
          id={`job-btn-${child.id}`}
          aria-label="اتصال"
          onClick={() => doJob(child)}
          disabled={!child.person.phone}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          <Phone className="h-5 w-5" />
        </button>
      );
    }
    // message
    return (
      <button
        id={`job-btn-${child.id}`}
        aria-label="إرسال رسالة"
        onClick={() => doJob(child)}
        disabled={!child.person.phone || messageChannel === 'internal'}
        className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow transition active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none ${
          messageChannel === 'whatsapp'
            ? 'bg-emerald-500 hover:bg-emerald-600'
            : 'bg-primary-600 hover:bg-primary-700'
        }`}
      >
        {messageChannel === 'whatsapp' ? (
          <WhatsAppIcon className="h-5 w-5" />
        ) : messageChannel === 'sms' ? (
          <MessageSquare className="h-5 w-5" />
        ) : (
          <Inbox className="h-5 w-5" />
        )}
      </button>
    );
  };

  return (
    <AppShell>
      <section id="children-header" className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Users className="h-5 w-5 text-primary-600" />
          المخدومين
          <span className="badge bg-primary-100 text-primary-700">{filtered.length}</span>
        </h2>
        <button id="add-child-btn" onClick={() => router.push('/children/add')} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
          <Plus className="h-4 w-4" />
          إضافة
        </button>
      </section>

      {/* ---------- Row 1: Search ---------- */}
      <div className="relative mb-3">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          id="search-input"
          className="input-field pr-9"
          placeholder="ابحث بالاسم أو الهاتف أو الرقم القومي..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ---------- Row 2: Scope selectors (church / service / class) ---------- */}
      {/* Each dropdown only contains what the current user can see (RLS-scoped). */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="relative">
          <select
            id="church-selector"
            aria-label="اختيار الكنيسة"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={churchFilter}
            onChange={(e) => onChurchChange(e.target.value)}
            disabled={churches.length <= 1}
          >
            <option value={ALL}>{churches.length === 1 ? churches[0].name : 'كل الكنائس'}</option>
            {churches.length > 1 &&
              churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </div>

        <div className="relative">
          <select
            id="service-selector"
            aria-label="اختيار الخدمة"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={serviceFilter}
            onChange={(e) => onServiceChange(e.target.value)}
            disabled={visibleServices.length <= 1}
          >
            <option value={ALL}>{visibleServices.length === 1 ? visibleServices[0].name : 'كل الخدمات'}</option>
            {visibleServices.length > 1 &&
              visibleServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
          </select>
        </div>

        <div className="relative">
          <select
            id="class-selector"
            aria-label="اختيار الفصل"
            className="input-field appearance-none !px-2 text-xs font-bold"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            disabled={visibleClasses.length <= 1}
          >
            <option value={ALL}>{visibleClasses.length === 1 ? visibleClasses[0].name : 'كل الفصول'}</option>
            {visibleClasses.length > 1 &&
              visibleClasses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </div>
      </div>

      {/* ---------- Row 3: Job selector + activated mode controls ---------- */}
      <div className="mb-3 flex items-center gap-2">
        <select
          id="job-selector"
          aria-label="اختيار الوظيفة"
          className="input-field !w-auto flex-1 appearance-none text-sm font-bold"
          value={job}
          onChange={(e) => setJob(e.target.value as Job)}
        >
          {JOBS.map((j) => (
            <option key={j.value} value={j.value}>{j.label}</option>
          ))}
        </select>

        {/* Attendance: register / remove mode buttons + points */}
        {job === 'attendance' && (
          <>
            <button
              id="att-mode-add"
              aria-label="وضع تسجيل الحضور"
              aria-pressed={attendanceMode === 'add'}
              onClick={() => setAttendanceMode('add')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
                attendanceMode === 'add'
                  ? 'bg-emerald-500 text-white shadow ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-500'
              }`}
            >
              <Check className="h-5 w-5" />
            </button>
            <button
              id="att-mode-remove"
              aria-label="وضع إزالة الحضور"
              aria-pressed={attendanceMode === 'remove'}
              onClick={() => setAttendanceMode('remove')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
                attendanceMode === 'remove'
                  ? 'bg-red-500 text-white shadow ring-2 ring-red-300'
                  : 'bg-red-50 text-red-500'
              }`}
            >
              <X className="h-5 w-5" />
            </button>
            <input
              id="points-input"
              type="number"
              min={0}
              aria-label="عدد النقاط"
              className="input-field !w-16 shrink-0 text-center font-extrabold"
              value={points}
              onChange={(e) => setPoints(Number(e.target.value))}
            />
          </>
        )}

        {/* Points: add / subtract mode buttons + points */}
        {job === 'points' && (
          <>
            <button
              id="pts-mode-add"
              aria-label="وضع إضافة النقاط"
              aria-pressed={pointsMode === 'add'}
              onClick={() => setPointsMode('add')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
                pointsMode === 'add'
                  ? 'bg-emerald-500 text-white shadow ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-500'
              }`}
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              id="pts-mode-subtract"
              aria-label="وضع خصم النقاط"
              aria-pressed={pointsMode === 'subtract'}
              onClick={() => setPointsMode('subtract')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
                pointsMode === 'subtract'
                  ? 'bg-red-500 text-white shadow ring-2 ring-red-300'
                  : 'bg-red-50 text-red-500'
              }`}
            >
              <Minus className="h-5 w-5" />
            </button>
            <input
              id="points-input"
              type="number"
              min={0}
              aria-label="عدد النقاط"
              className="input-field !w-16 shrink-0 text-center font-extrabold"
              value={points}
              onChange={(e) => setPoints(Number(e.target.value))}
            />
          </>
        )}

        {/* Message: whatsapp / sms / internal channel buttons */}
        {job === 'message' && (
          <>
            <button
              id="msg-mode-whatsapp"
              aria-label="واتساب"
              aria-pressed={messageChannel === 'whatsapp'}
              onClick={() => setMessageChannel('whatsapp')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
                messageChannel === 'whatsapp'
                  ? 'bg-emerald-500 text-white shadow ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-500'
              }`}
            >
              <WhatsAppIcon className="h-5 w-5" />
            </button>
            <button
              id="msg-mode-sms"
              aria-label="رسالة SMS"
              aria-pressed={messageChannel === 'sms'}
              onClick={() => setMessageChannel('sms')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
                messageChannel === 'sms'
                  ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300'
                  : 'bg-primary-50 text-primary-500'
              }`}
            >
              <MessageSquare className="h-5 w-5" />
            </button>
            <button
              id="msg-mode-internal"
              aria-label="رسالة داخلية — قريبًا"
              aria-pressed={messageChannel === 'internal'}
              onClick={() => setMessageChannel('internal')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
                messageChannel === 'internal'
                  ? 'bg-slate-500 text-white shadow ring-2 ring-slate-300'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              <Inbox className="h-5 w-5" />
            </button>
            <button
              id="msg-compose"
              aria-label="كتابة الرسالة"
              onClick={() => setShowCompose(true)}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
                messageTemplate.trim()
                  ? 'bg-gold-500 text-white shadow ring-2 ring-gold-300'
                  : 'bg-gold-100 text-gold-600'
              }`}
            >
              <PenSquare className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Internal messaging notice */}
      {job === 'message' && messageChannel === 'internal' && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600">
          الرسائل الداخلية قريبًا
        </p>
      )}

      {/* ---------- Filter accordion ---------- */}
      <div id="filters-accordion" className="card !p-0 mb-4 overflow-hidden">
        <button
          id="filters-toggle"
          onClick={() => setFiltersOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-extrabold text-slate-700"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary-600" />
            الفلاتر
            {activeFilterCount > 0 && (
              <span className="badge bg-primary-100 text-primary-700">{activeFilterCount}</span>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {filtersOpen && (
          <div id="filters-body" className="space-y-3 border-t border-indigo-100 px-4 py-3">
            <div className="relative">
              <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                id="address-filter"
                className="input-field pr-9"
                placeholder="فلترة بالعنوان..."
                value={addressFilter}
                onChange={(e) => setAddressFilter(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">أقل نقاط</label>
                <input
                  id="min-points"
                  type="number"
                  min={0}
                  className="input-field"
                  placeholder="0"
                  value={minPoints}
                  onChange={(e) => setMinPoints(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">أقل حضور</label>
                <input
                  id="min-attendance"
                  type="number"
                  min={0}
                  className="input-field"
                  placeholder="0"
                  value={minAttendance}
                  onChange={(e) => setMinAttendance(e.target.value)}
                />
              </div>
            </div>
            {activeFilterCount > 0 && (
              <button
                id="reset-filters"
                onClick={resetFilters}
                className="flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
                مسح الفلاتر
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---------- Grouped-by-class expandable view ---------- */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : groups.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Users className="mx-auto mb-3 h-10 w-10" />
          <p className="font-bold">لا يوجد مخدومين</p>
          <p className="text-sm mt-1">جرّب تغيير الفلاتر أو اضغط &quot;إضافة&quot; لتسجيل مخدوم</p>
        </div>
      ) : (
        <div id="children-groups" className="space-y-3">
          {groups.map(({ classId, className, kids }) => {
            const open = openGroups[classId] ?? false;
            return (
              <div key={classId} className="card !p-0 overflow-hidden">
                <button
                  id={`group-${classId}`}
                  onClick={() => toggleGroup(classId)}
                  className="flex w-full items-center justify-between px-4 py-3"
                >
                  <span className="flex items-center gap-2 text-sm font-extrabold text-slate-700">
                    <School className="h-4 w-4 text-primary-600" />
                    {className}
                    <span className="badge bg-primary-100 text-primary-700">{kids.length}</span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                  />
                </button>

                {open && (
                  <ul className="divide-y divide-indigo-50 border-t border-indigo-100">
                    {kids.map((child) => (
                      <li key={child.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          {/* Name + points/attendance below it */}
                          <div className="min-w-0 flex-1">
                            <p className="font-extrabold truncate">{child.person.name}</p>
                            <div className="mt-1.5 flex gap-2">
                              <span className="badge bg-gold-100 text-gold-600">
                                <Star className="h-3 w-3" /> {child.points}
                              </span>
                              <span className="badge bg-emerald-100 text-emerald-700">
                                <CalendarCheck className="h-3 w-3" /> {child.attendance_count}
                              </span>
                            </div>
                          </div>

                          {/* Single job button */}
                          <div className="shrink-0">{childButton(child)}</div>
                        </div>

                        {/* Extra info (no phone number) */}
                        {(child.person.address || child.person.notes) && (
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                            {child.person.address && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" /> {child.person.address}
                              </span>
                            )}
                            {child.person.notes && (
                              <span className="flex items-center gap-1">
                                <StickyNote className="h-3 w-3" /> {child.person.notes}
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCompose && (
        <ComposeMessageModal
          template={messageTemplate}
          onSave={(t) => {
            setMessageTemplate(t);
            setShowCompose(false);
          }}
          onClose={() => setShowCompose(false)}
        />
      )}
    </AppShell>
  );
}

// ---------- Compose message modal (template + variables) ----------
function ComposeMessageModal({
  template, onSave, onClose,
}: {
  template: string; onSave: (t: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState(template);

  const insertVar = (token: string) => {
    const el = document.getElementById('compose-textarea') as HTMLTextAreaElement | null;
    if (el) {
      const start = el.selectionStart ?? text.length;
      const end = el.selectionEnd ?? text.length;
      const next = text.slice(0, start) + token + text.slice(end);
      setText(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      setText((t) => t + token);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">كتابة الرسالة</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <textarea
          id="compose-textarea"
          className="input-field"
          rows={5}
          placeholder="اكتب نص الرسالة هنا..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <p className="mt-3 mb-1.5 text-xs font-bold text-slate-500">إضافة متغير:</p>
        <div className="flex flex-wrap gap-2">
          {MSG_VARS.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => insertVar(v.token)}
              className="rounded-full bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 transition hover:bg-primary-100 active:scale-95"
            >
              + {v.label}
            </button>
          ))}
        </div>

        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          ستُستبدل المتغيرات ببيانات كل مخدوم عند الإرسال من زر الرسالة في بطاقته
        </p>

        <div className="mt-4 flex gap-2">
          {text.trim() && (
            <button
              type="button"
              onClick={() => {
                setText('');
              }}
              className="btn-secondary flex-none !px-4"
            >
              مسح
            </button>
          )}
          <button
            type="button"
            onClick={() => onSave(text)}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            <Check className="h-5 w-5" />
            حفظ الرسالة
          </button>
        </div>
      </div>
    </div>
  );
}
