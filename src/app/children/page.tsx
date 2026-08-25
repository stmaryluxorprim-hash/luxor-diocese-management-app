'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Users, Search, Plus, Phone, MapPin, Star, CalendarCheck, X, Loader2, StickyNote,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Child, ClassRoom } from '@/lib/types';

export default function ChildrenPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [children, setChildren] = useState<Child[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

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

  const filtered = useMemo(
    () =>
      children.filter(
        (c) =>
          c.name.includes(search) ||
          (c.phone ?? '').includes(search)
      ),
    [children, search]
  );

  const classNameOf = (id: string) => classes.find((c) => c.id === id)?.name ?? '';

  return (
    <AppShell>
      <section id="children-header" className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Users className="h-5 w-5 text-primary-600" />
          المخدومين
          <span className="badge bg-primary-100 text-primary-700">{children.length}</span>
        </h2>
        <button id="add-child-btn" onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
          <Plus className="h-4 w-4" />
          إضافة
        </button>
      </section>

      <div className="relative mb-4">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          id="search-input"
          className="input-field pr-9"
          placeholder="ابحث بالاسم أو الهاتف..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <Users className="mx-auto mb-3 h-10 w-10" />
          <p className="font-bold">لا يوجد مخدومين بعد</p>
          <p className="text-sm mt-1">اضغط &quot;إضافة&quot; لتسجيل أول مخدوم</p>
        </div>
      ) : (
        <ul id="children-list" className="space-y-3">
          {filtered.map((child) => (
            <li key={child.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-extrabold truncate">{child.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{classNameOf(child.class_id)}</p>
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
    name: '', phone: '', birthdate: '', address: '', notes: '', class_id: '',
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
