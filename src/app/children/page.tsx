'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Users, Search, Plus, Phone, MapPin, Star, CalendarCheck, X, Loader2, StickyNote,
  SlidersHorizontal, ChevronDown, Briefcase, School,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Child, ClassRoom } from '@/lib/types';

const ALL = 'all';

export default function ChildrenPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [children, setChildren] = useState<Child[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  // ---------- Selectors & filters ----------
  const [classFilter, setClassFilter] = useState<string>(ALL);
  const [jobFilter, setJobFilter] = useState<string>(ALL);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [addressFilter, setAddressFilter] = useState('');
  const [minPoints, setMinPoints] = useState('');
  const [minAttendance, setMinAttendance] = useState('');

  // ---------- Expandable class groups ----------
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) =>
    setOpenGroups((g) => ({ ...g, [id]: !g[id] }));

  const load = useCallback(async () => {
    const [{ data: kids }, { data: cls }] = await Promise.all([
      supabase.from('children').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
    ]);
    setChildren(kids ?? []);
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
      .channel('children-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'children' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, supabase, load]);

  // Distinct jobs present in the data (for the job selector)
  const jobs = useMemo(() => {
    const set = new Set<string>();
    children.forEach((c) => {
      if (c.job?.trim()) set.add(c.job.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [children]);

  // ---------- Apply selectors + accordion filters ----------
  const filtered = useMemo(
    () =>
      children.filter((c) => {
        if (classFilter !== ALL && c.class_id !== classFilter) return false;
        if (jobFilter !== ALL && (c.job?.trim() ?? '') !== jobFilter) return false;
        if (search && !(c.name.includes(search) || (c.phone ?? '').includes(search)))
          return false;
        if (addressFilter && !(c.address ?? '').includes(addressFilter)) return false;
        if (minPoints && c.points < Number(minPoints)) return false;
        if (minAttendance && c.attendance_count < Number(minAttendance)) return false;
        return true;
      }),
    [children, classFilter, jobFilter, search, addressFilter, minPoints, minAttendance]
  );

  // ---------- Group by class (sorted by class name) ----------
  const groups = useMemo(() => {
    const byClass = new Map<string, Child[]>();
    filtered.forEach((c) => {
      const arr = byClass.get(c.class_id) ?? [];
      arr.push(c);
      byClass.set(c.class_id, arr);
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
    (search ? 1 : 0) + (addressFilter ? 1 : 0) + (minPoints ? 1 : 0) + (minAttendance ? 1 : 0);

  const resetFilters = () => {
    setSearch('');
    setAddressFilter('');
    setMinPoints('');
    setMinAttendance('');
  };

  return (
    <AppShell>
      <section id="children-header" className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Users className="h-5 w-5 text-primary-600" />
          المخدومين
          <span className="badge bg-primary-100 text-primary-700">{filtered.length}</span>
        </h2>
        <button id="add-child-btn" onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
          <Plus className="h-4 w-4" />
          إضافة
        </button>
      </section>

      {/* ---------- Selectors ---------- */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        {/* Class selector (with all option) */}
        <div className="relative">
          <School className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <select
            id="class-selector"
            aria-label="اختيار الفصل"
            className="input-field appearance-none pr-9 text-sm font-bold"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
          >
            <option value={ALL}>كل الفصول</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Job selector (with all option) */}
        <div className="relative">
          <Briefcase className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <select
            id="job-selector"
            aria-label="اختيار الوظيفة"
            className="input-field appearance-none pr-9 text-sm font-bold"
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
          >
            <option value={ALL}>كل الوظائف</option>
            {jobs.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
        </div>
      </div>

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
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                id="search-input"
                className="input-field pr-9"
                placeholder="ابحث بالاسم أو الهاتف..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
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
                {/* Class group header (expandable) */}
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
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-extrabold truncate">{child.name}</p>
                            {child.job && (
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                                <Briefcase className="h-3 w-3" /> {child.job}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <span className="badge bg-gold-100 text-gold-600">
                              <Star className="h-3 w-3" /> {child.points}
                            </span>
                            <span className="badge bg-emerald-100 text-emerald-700">
                              <CalendarCheck className="h-3 w-3" /> {child.attendance_count}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          {child.phone && (
                            <span className="flex items-center gap-1" dir="ltr">
                              <Phone className="h-3 w-3" /> {child.phone}
                            </span>
                          )}
                          {child.address && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {child.address}
                            </span>
                          )}
                          {child.notes && (
                            <span className="flex items-center gap-1">
                              <StickyNote className="h-3 w-3" /> {child.notes}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddChildModal
          classes={classes}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function AddChildModal({
  classes, onClose, onSaved,
}: {
  classes: ClassRoom[]; onClose: () => void; onSaved: () => void;
}) {
  const { profile } = useAuth();
  const supabase = createClient();
  const [form, setForm] = useState({
    name: '', phone: '', birthdate: '', address: '', notes: '', class_id: '', job: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Servants have a fixed class
  const fixedClassId = profile?.role === 'class_servant' ? profile.class_id : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const classId = fixedClassId ?? form.class_id;
    const cls = classes.find((c) => c.id === classId);
    if (!cls) {
      setError('اختر الفصل');
      return;
    }
    setSaving(true);
    const { error: err } = await supabase.from('children').insert({
      church_id: cls.church_id,
      service_id: cls.service_id,
      class_id: cls.id,
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      birthdate: form.birthdate || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      job: form.job.trim() || null,
      created_by: profile?.id,
    });
    if (err) {
      setError('تعذر الحفظ، تأكد من الصلاحيات وحاول مجدداً');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">إضافة مخدوم جديد</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input className="input-field" placeholder="الاسم *" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />

          {!fixedClassId && (
            <select className="input-field" value={form.class_id}
              onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value }))} required>
              <option value="">اختر الفصل *</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          <input className="input-field" placeholder="الوظيفة" value={form.job}
            onChange={(e) => setForm((f) => ({ ...f, job: e.target.value }))} />

          <input className="input-field" placeholder="رقم الهاتف" dir="ltr" value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
            <input type="date" className="input-field" value={form.birthdate}
              onChange={(e) => setForm((f) => ({ ...f, birthdate: e.target.value }))} />
          </div>
          <input className="input-field" placeholder="العنوان" value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          <textarea className="input-field" placeholder="ملاحظات" rows={2} value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}

          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ المخدوم
          </button>
        </form>
      </div>
    </div>
  );
}
