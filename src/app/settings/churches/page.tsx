'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Church as ChurchIcon, Plus, ArrowRight, Loader2, Upload, X } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Church } from '@/lib/types';

export default function ChurchesPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [churches, setChurches] = useState<Church[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.from('churches').select('*').order('name');
    setChurches(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile, load]);

  useEffect(() => {
    if (!profile) return;
    const ch = supabase
      .channel('churches-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'churches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile, supabase, load]);

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <ChurchIcon className="h-5 w-5 text-gold-500" />
            الكنائس
            <span className="badge bg-gold-100 text-gold-600">{churches.length}</span>
          </h2>
        </div>
        {profile?.role === 'owner' && (
          <button onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" /> إضافة
          </button>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <ul className="space-y-3">
          {churches.map((c) => (
            <li key={c.id} className="card flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-primary-50 ring-2 ring-primary-100 flex items-center justify-center">
                {c.logo_url ? (
                  <Image src={c.logo_url} alt={c.name} fill sizes="48px" className="object-cover" />
                ) : (
                  <ChurchIcon className="h-6 w-6 text-primary-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-extrabold truncate">{c.name}</p>
                {c.address && <p className="text-xs text-slate-400 truncate">{c.address}</p>}
              </div>
            </li>
          ))}
          {churches.length === 0 && (
            <li className="card py-12 text-center text-slate-400 font-bold">لا توجد كنائس بعد</li>
          )}
        </ul>
      )}

      {showAdd && <AddChurchModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </AppShell>
  );
}

function AddChurchModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    let logo_url: string | null = null;
    if (logoFile) {
      const path = `${Date.now()}-${logoFile.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('church-logos').upload(path, logoFile);
      if (upErr) {
        setError('تعذر رفع الشعار');
        setSaving(false);
        return;
      }
      logo_url = supabase.storage.from('church-logos').getPublicUrl(path).data.publicUrl;
    }

    const { error: err } = await supabase.from('churches').insert({
      name: name.trim(),
      address: address.trim() || null,
      logo_url,
    });
    if (err) {
      setError('تعذر الحفظ — هذه العملية متاحة لمالك التطبيق فقط');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">إضافة كنيسة</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className="input-field" placeholder="اسم الكنيسة *" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <input className="input-field" placeholder="العنوان" value={address}
            onChange={(e) => setAddress(e.target.value)} />
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-sm font-bold text-primary-600">
            <Upload className="h-4 w-4" />
            {logoFile ? logoFile.name : 'رفع شعار الكنيسة (صورة)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ الكنيسة
          </button>
        </form>
      </div>
    </div>
  );
}
