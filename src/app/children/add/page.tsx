'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import {
  UserPlus, Users, X, Check, Loader2, QrCode, Camera, Wand2,
  ArrowRight, FileSpreadsheet, ClipboardPaste, Upload, Trash2, Star,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import PhotoCropModal from '@/components/PhotoCropModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import {
  PHONE_PREFIX, PHONE_LOCAL_LENGTH, GENDER_LABELS,
  type Gender, type Church, type Service, type ClassRoom,
} from '@/lib/types';

// ---------- Helpers ----------

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** Random readable child code, e.g. CH-4F7K9Q */
const generateCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `CH-${s}`;
};

/** Compose YYYY-MM-DD from separate day/month/year, or null */
const composeBirthdate = (d: string, m: string, y: string): string | null => {
  if (!d || !m || !y) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Normalize a raw phone into +2XXXXXXXXXXX (11 local digits) or null; returns undefined when invalid */
const normalizePhone = (raw: string): string | null | undefined => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  let local = digits;
  if (local.startsWith('20') && local.length === 13) local = local.slice(2);
  else if (local.startsWith('2') && local.length === 12) local = local.slice(1);
  if (local.length !== PHONE_LOCAL_LENGTH) return undefined;
  return `${PHONE_PREFIX}${local}`;
};

// ---------- Page ----------

type Tab = 'single' | 'bulk';

export default function AddChildPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('single');
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.status !== 'approved') return;
    (async () => {
      const [{ data: chs }, { data: svs }, { data: cls }] = await Promise.all([
        supabase.from('churches').select('*').order('name'),
        supabase.from('services').select('*').order('name'),
        supabase.from('classes').select('*').order('name'),
      ]);
      setChurches(chs ?? []);
      setServices(svs ?? []);
      setClasses(cls ?? []);
      setLoading(false);
    })();
  }, [profile, supabase]);

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <UserPlus className="h-5 w-5 text-primary-600" />
          إضافة مخدومين
        </h2>
        <button
          id="back-to-children"
          onClick={() => router.push('/children')}
          className="btn-secondary !py-2 !px-3 flex items-center gap-1 text-sm"
        >
          <ArrowRight className="h-4 w-4" />
          المخدومين
        </button>
      </section>

      {/* ---------- Tabs ---------- */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-indigo-50 p-1">
        <button
          id="tab-single"
          onClick={() => setTab('single')}
          aria-pressed={tab === 'single'}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'single' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
          }`}
        >
          <UserPlus className="h-4 w-4" />
          إضافة فردية
        </button>
        <button
          id="tab-bulk"
          onClick={() => setTab('bulk')}
          aria-pressed={tab === 'bulk'}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'bulk' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
          }`}
        >
          <Users className="h-4 w-4" />
          إضافة جماعية
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : tab === 'single' ? (
        <SingleAddTab churches={churches} services={services} classes={classes} />
      ) : (
        <BulkAddTab churches={churches} services={services} classes={classes} />
      )}
    </AppShell>
  );
}

// ---------- Shared: church → service → class cascading selectors ----------

function useScope(churches: Church[], services: Service[], classes: ClassRoom[]) {
  const { profile } = useAuth();
  const [churchId, setChurchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [classId, setClassId] = useState('');

  // Default from profile scope once data arrives
  useEffect(() => {
    if (!profile) return;
    if (profile.church_id && churches.some((c) => c.id === profile.church_id)) setChurchId(profile.church_id);
    else if (churches.length === 1) setChurchId(churches[0].id);
    if (profile.service_id && services.some((s) => s.id === profile.service_id)) setServiceId(profile.service_id);
    if (profile.class_id && classes.some((c) => c.id === profile.class_id)) setClassId(profile.class_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, churches.length, services.length, classes.length]);

  const visibleServices = useMemo(
    () => services.filter((s) => !churchId || s.church_id === churchId),
    [services, churchId]
  );
  const visibleClasses = useMemo(
    () =>
      classes.filter(
        (c) => (!churchId || c.church_id === churchId) && (!serviceId || c.service_id === serviceId)
      ),
    [classes, churchId, serviceId]
  );

  // Auto-select single options
  useEffect(() => {
    if (!serviceId && visibleServices.length === 1) setServiceId(visibleServices[0].id);
  }, [visibleServices, serviceId]);
  useEffect(() => {
    if (!classId && visibleClasses.length === 1) setClassId(visibleClasses[0].id);
  }, [visibleClasses, classId]);

  const onChurch = (v: string) => { setChurchId(v); setServiceId(''); setClassId(''); };
  const onService = (v: string) => { setServiceId(v); setClassId(''); };

  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  return { churchId, serviceId, classId, visibleServices, visibleClasses, onChurch, onService, setClassId, selectedClass };
}

function ScopeSelectors({
  scope, churches, idPrefix,
}: {
  scope: ReturnType<typeof useScope>; churches: Church[]; idPrefix: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
        <select
          id={`${idPrefix}-church`}
          className="input-field"
          value={scope.churchId}
          onChange={(e) => scope.onChurch(e.target.value)}
          required
        >
          <option value="">اختر الكنيسة</option>
          {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
        <select
          id={`${idPrefix}-service`}
          className="input-field"
          value={scope.serviceId}
          onChange={(e) => scope.onService(e.target.value)}
          disabled={!scope.churchId}
          required
        >
          <option value="">اختر الخدمة</option>
          {scope.visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
        <select
          id={`${idPrefix}-class`}
          className="input-field"
          value={scope.classId}
          onChange={(e) => scope.setClassId(e.target.value)}
          disabled={!scope.serviceId}
          required
        >
          <option value="">اختر الفصل</option>
          {scope.visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 1 — Single add
// =====================================================================

function SingleAddTab({
  churches, services, classes,
}: {
  churches: Church[]; services: Service[]; classes: ClassRoom[];
}) {
  const { profile } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const scope = useScope(churches, services, classes);

  // ---- Code + QR square ----
  const [code, setCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!code.trim()) { setQrDataUrl(''); return; }
    QRCode.toDataURL(code.trim(), { width: 320, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [code]);

  const generateAndShow = () => {
    const c = code.trim() || generateCode();
    setCode(c);
    setShowQr(true);
  };

  // ---- Photo square ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');        // object URL for cropper
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRawImage(URL.createObjectURL(file));
  };

  const onCropped = (blob: Blob) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(blob);
    setPhotoPreview(URL.createObjectURL(blob));
    URL.revokeObjectURL(rawImage);
    setRawImage('');
  };

  // ---- Form fields ----
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [phoneLocal, setPhoneLocal] = useState('');   // 11 digits after +2
  const [bDay, setBDay] = useState('');
  const [bMonth, setBMonth] = useState('');
  const [bYear, setBYear] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [startPoints, setStartPoints] = useState('0');

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState('');

  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 40 }, (_, i) => currentYear - i),
    [currentYear]
  );
  const daysInMonth = useMemo(() => {
    if (!bMonth) return 31;
    const y = Number(bYear) || 2000;
    return new Date(y, Number(bMonth), 0).getDate();
  }, [bMonth, bYear]);

  // Clamp day if month/year change shrinks it
  useEffect(() => {
    if (bDay && Number(bDay) > daysInMonth) setBDay(String(daysInMonth));
  }, [daysInMonth, bDay]);

  const phoneValid = phoneLocal === '' || phoneLocal.length === PHONE_LOCAL_LENGTH;

  const resetForm = () => {
    setCode(''); setShowQr(false);
    setPhotoBlob(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview('');
    setName(''); setGender(''); setPhoneLocal('');
    setBDay(''); setBMonth(''); setBYear('');
    setAddress(''); setNotes(''); setStartPoints('0');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSavedName('');

    const cls = scope.selectedClass;
    if (!cls) { setError('اختر الكنيسة والخدمة والفصل'); return; }
    if (!name.trim()) { setError('اكتب اسم المخدوم'); return; }
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) {
      setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
      return;
    }

    setSaving(true);
    try {
      // Upload photo first (if any)
      let photoUrl: string | null = null;
      if (photoBlob) {
        photoUrl = await uploadPhoto(supabase, 'children', photoBlob, 'child.webp');
      }

      const points = Math.max(0, Math.floor(Number(startPoints) || 0));
      const insert: Record<string, unknown> = {
        church_id: cls.church_id,
        service_id: cls.service_id,
        class_id: cls.id,
        name: name.trim(),
        gender: gender || null,
        phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
        birthdate: composeBirthdate(bDay, bMonth, bYear),
        address: address.trim() || null,
        notes: notes.trim() || null,
        points,
        photo_url: photoUrl,
        created_by: profile?.id,
      };
      if (code.trim()) insert.qr_code = code.trim();

      const { error: err } = await supabase.from('children').insert(insert);
      if (err) {
        setError(
          err.code === '23505'
            ? 'هذا الكود مستخدم بالفعل، غيّره أو ولّد كودًا جديدًا'
            : 'تعذر الحفظ، تأكد من الصلاحيات وحاول مجددًا'
        );
        setSaving(false);
        return;
      }
      setSavedName(name.trim());
      resetForm();
      setSaving(false);
    } catch {
      setError('حدث خطأ أثناء رفع الصورة أو الحفظ');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-6">
      {/* ---------- Upper part: two squares (QR / Photo) ---------- */}
      <div className="grid grid-cols-2 gap-3">
        {/* QR square */}
        <button
          id="qr-square"
          type="button"
          onClick={generateAndShow}
          className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
        >
          {qrDataUrl && code ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR" className="h-full w-full rounded-xl object-contain" />
          ) : (
            <>
              <QrCode className="h-10 w-10 text-primary-500" />
              <span className="text-xs font-extrabold text-slate-500">توليد الكود و QR</span>
            </>
          )}
        </button>

        {/* Photo square */}
        <button
          id="photo-square"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 overflow-hidden transition active:scale-95"
        >
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview} alt="صورة المخدوم" className="h-full w-full rounded-xl object-cover" />
          ) : (
            <>
              <Camera className="h-10 w-10 text-primary-500" />
              <span className="text-xs font-extrabold text-slate-500">صورة المخدوم</span>
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          id="photo-input"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPickFile}
        />
      </div>

      {photoPreview && (
        <button
          id="photo-remove"
          type="button"
          onClick={() => {
            setPhotoBlob(null);
            URL.revokeObjectURL(photoPreview);
            setPhotoPreview('');
          }}
          className="flex items-center gap-1 text-xs font-bold text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" /> إزالة الصورة
        </button>
      )}

      {/* ---------- Scope ---------- */}
      <div className="card space-y-3">
        <ScopeSelectors scope={scope} churches={churches} idPrefix="single" />

        {/* Code */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الكود</label>
          <div className="flex gap-2">
            <input
              id="single-code"
              className="input-field flex-1"
              dir="ltr"
              placeholder="اكتب الكود أو ولّده تلقائيًا"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              id="single-code-generate"
              type="button"
              onClick={() => setCode(generateCode())}
              aria-label="توليد كود تلقائي"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95"
            >
              <Wand2 className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* ---------- Personal data ---------- */}
      <div className="card space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الاسم *</label>
          <input
            id="single-name"
            className="input-field"
            placeholder="اسم المخدوم"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        {/* Gender */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">النوع</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              id="gender-boy"
              type="button"
              aria-pressed={gender === 'boy'}
              onClick={() => setGender(gender === 'boy' ? '' : 'boy')}
              className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${
                gender === 'boy'
                  ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300'
                  : 'bg-primary-50 text-primary-600'
              }`}
            >
              {GENDER_LABELS.boy} 👦
            </button>
            <button
              id="gender-girl"
              type="button"
              aria-pressed={gender === 'girl'}
              onClick={() => setGender(gender === 'girl' ? '' : 'girl')}
              className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${
                gender === 'girl'
                  ? 'bg-pink-500 text-white shadow ring-2 ring-pink-300'
                  : 'bg-pink-50 text-pink-500'
              }`}
            >
              {GENDER_LABELS.girl} 👧
            </button>
          </div>
        </div>

        {/* Phone with fixed +2 prefix */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">رقم الهاتف</label>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-primary-300" dir="ltr">
            <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">
              {PHONE_PREFIX}
            </span>
            <input
              id="single-phone"
              type="tel"
              inputMode="numeric"
              className="w-full px-3 py-2.5 text-sm font-bold outline-none"
              placeholder="01xxxxxxxxx"
              value={phoneLocal}
              maxLength={PHONE_LOCAL_LENGTH}
              onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))}
            />
          </div>
          {!phoneValid && (
            <p className="mt-1 text-[11px] font-bold text-red-500">
              الرقم يجب أن يكون {PHONE_LOCAL_LENGTH} رقمًا ({phoneLocal.length}/{PHONE_LOCAL_LENGTH})
            </p>
          )}
          {phoneLocal.length === PHONE_LOCAL_LENGTH && (
            <p className="mt-1 text-[11px] font-bold text-emerald-600" dir="ltr">
              ✓ {PHONE_PREFIX}{phoneLocal}
            </p>
          )}
        </div>

        {/* Birthdate: day / month / year pickers */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
          <div className="grid grid-cols-3 gap-2">
            <select
              id="birth-day"
              aria-label="اليوم"
              className="input-field !px-2 text-center"
              value={bDay}
              onChange={(e) => setBDay(e.target.value)}
            >
              <option value="">اليوم</option>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select
              id="birth-month"
              aria-label="الشهر"
              className="input-field !px-2 text-center"
              value={bMonth}
              onChange={(e) => setBMonth(e.target.value)}
            >
              <option value="">الشهر</option>
              {MONTHS_AR.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              id="birth-year"
              aria-label="السنة"
              className="input-field !px-2 text-center"
              value={bYear}
              onChange={(e) => setBYear(e.target.value)}
            >
              <option value="">السنة</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">العنوان</label>
          <input
            id="single-address"
            className="input-field"
            placeholder="العنوان"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label>
          <textarea
            id="single-notes"
            className="input-field"
            rows={2}
            placeholder="ملاحظات"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
            <Star className="h-3.5 w-3.5 text-gold-500" /> نقاط البداية
          </label>
          <input
            id="single-start-points"
            type="number"
            min={0}
            className="input-field"
            value={startPoints}
            onChange={(e) => setStartPoints(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}
      {savedName && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
          ✓ تم حفظ &quot;{savedName}&quot; بنجاح — يمكنك إضافة مخدوم آخر
        </p>
      )}

      <button
        id="single-save"
        type="submit"
        disabled={saving || !phoneValid}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
        حفظ المخدوم
      </button>

      {/* QR fullscreen modal */}
      {showQr && qrDataUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setShowQr(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-extrabold">كود المخدوم</h3>
              <button type="button" onClick={() => setShowQr(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR" className="mx-auto w-full rounded-xl" />
            <p className="mt-2 text-lg font-extrabold tracking-widest" dir="ltr">{code}</p>
          </div>
        </div>
      )}

      {/* Crop modal */}
      {rawImage && (
        <PhotoCropModal
          src={rawImage}
          onDone={onCropped}
          onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }}
        />
      )}
    </form>
  );
}

// =====================================================================
// TAB 2 — Bulk add (Excel import or pasted data + column mapping)
// =====================================================================

type BulkField = 'name' | 'gender' | 'phone' | 'birthdate' | 'address' | 'notes' | 'points' | 'code' | 'skip';

const BULK_FIELDS: { value: BulkField; label: string }[] = [
  { value: 'skip', label: '— تجاهل —' },
  { value: 'name', label: 'الاسم' },
  { value: 'gender', label: 'النوع' },
  { value: 'phone', label: 'رقم الهاتف' },
  { value: 'birthdate', label: 'تاريخ الميلاد' },
  { value: 'address', label: 'العنوان' },
  { value: 'notes', label: 'ملاحظات' },
  { value: 'points', label: 'نقاط البداية' },
  { value: 'code', label: 'الكود' },
];

/** Guess mapping from a header cell text */
const guessField = (header: string): BulkField => {
  const h = header.trim().toLowerCase();
  if (/اسم|name/.test(h)) return 'name';
  if (/نوع|جنس|gender|sex/.test(h)) return 'gender';
  if (/هاتف|موبايل|تليفون|phone|mobile|tel/.test(h)) return 'phone';
  if (/ميلاد|تاريخ|birth|date|dob/.test(h)) return 'birthdate';
  if (/عنوان|address/.test(h)) return 'address';
  if (/ملاحظ|note/.test(h)) return 'notes';
  if (/نقاط|point/.test(h)) return 'points';
  if (/كود|code|qr/.test(h)) return 'code';
  return 'skip';
};

/** Parse a birthdate cell: Excel serial, dd/mm/yyyy, yyyy-mm-dd */
const parseBirthdate = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

const parseGender = (v: unknown): Gender | null => {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(ولد|ذكر|boy|male|m|بنين)$/.test(s)) return 'boy';
  if (/^(بنت|أنثى|انثى|girl|female|f|بنات)$/.test(s)) return 'girl';
  return null;
};

interface BulkRow {
  cells: string[];
  status: 'pending' | 'ok' | 'error';
  message?: string;
}

function BulkAddTab({
  churches, services, classes,
}: {
  churches: Church[]; services: Service[]; classes: ClassRoom[];
}) {
  const { profile } = useAuth();
  const supabase = createClient();
  const scope = useScope(churches, services, classes);

  const [rows, setRows] = useState<BulkRow[]>([]);
  const [mapping, setMapping] = useState<BulkField[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ ok: number; fail: number } | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const colCount = rows.length ? Math.max(...rows.map((r) => r.cells.length)) : 0;

  const applyData = useCallback((matrix: string[][]) => {
    const clean = matrix
      .map((r) => r.map((c) => String(c ?? '').trim()))
      .filter((r) => r.some((c) => c !== ''));
    if (!clean.length) { setError('لا توجد بيانات'); return; }
    setError('');
    setDone(null);
    setRows(clean.map((cells) => ({ cells, status: 'pending' })));
    // Guess mapping from first row headers
    const cols = Math.max(...clean.map((r) => r.length));
    const guessed: BulkField[] = Array.from({ length: cols }, (_, i) =>
      guessField(clean[0][i] ?? '')
    );
    // if nothing matched, default first col to name
    if (!guessed.includes('name') && cols > 0) guessed[0] = 'name';
    setMapping(guessed);
  }, []);

  // ---- Excel import ----
  const onExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
        .map((r) => (r as unknown[]).map((c) => {
          if (typeof c === 'number' && c > 20000 && c < 60000) return String(c); // keep serial for date parsing
          return String(c ?? '');
        }));
      applyData(matrix);
    } catch {
      setError('تعذر قراءة ملف الإكسل');
    }
  };

  // ---- Paste import ----
  const applyPaste = () => {
    const lines = pasteText.split(/\r?\n/).filter((l) => l.trim());
    const matrix = lines.map((l) => (l.includes('\t') ? l.split('\t') : l.split(/[,;]/)));
    applyData(matrix);
    setPasteOpen(false);
    setPasteText('');
  };

  const setColMapping = (i: number, f: BulkField) =>
    setMapping((m) => {
      const next = [...m];
      // A field (except skip) can map to only one column
      if (f !== 'skip') {
        for (let j = 0; j < next.length; j++) if (next[j] === f) next[j] = 'skip';
      }
      next[i] = f;
      return next;
    });

  const dataRows = useMemo(
    () => (hasHeader ? rows.slice(1) : rows),
    [rows, hasHeader]
  );

  const removeRow = (idx: number) => {
    const realIdx = hasHeader ? idx + 1 : idx;
    setRows((r) => r.filter((_, i) => i !== realIdx));
  };

  const nameCol = mapping.indexOf('name');

  const doImport = async () => {
    setError('');
    const cls = scope.selectedClass;
    if (!cls) { setError('اختر الكنيسة والخدمة والفصل أولًا'); return; }
    if (nameCol === -1) { setError('حدد عمود الاسم'); return; }
    if (!dataRows.length) { setError('لا توجد صفوف للاستيراد'); return; }

    setImporting(true);
    let ok = 0, fail = 0;
    const startIdx = hasHeader ? 1 : 0;
    const updated = [...rows];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const cell = (f: BulkField) => {
        const idx = mapping.indexOf(f);
        return idx === -1 ? '' : (row.cells[idx] ?? '').trim();
      };
      const name = cell('name');
      if (!name) {
        updated[startIdx + i] = { ...row, status: 'error', message: 'الاسم مفقود' };
        fail++;
        continue;
      }
      const rawPhone = cell('phone');
      const phone = normalizePhone(rawPhone);
      if (phone === undefined) {
        updated[startIdx + i] = { ...row, status: 'error', message: `رقم هاتف غير صالح (${rawPhone})` };
        fail++;
        continue;
      }
      const insert: Record<string, unknown> = {
        church_id: cls.church_id,
        service_id: cls.service_id,
        class_id: cls.id,
        name,
        gender: parseGender(cell('gender')),
        phone,
        birthdate: parseBirthdate(cell('birthdate')),
        address: cell('address') || null,
        notes: cell('notes') || null,
        points: Math.max(0, Math.floor(Number(cell('points')) || 0)),
        created_by: profile?.id,
      };
      const codeVal = cell('code');
      if (codeVal) insert.qr_code = codeVal;

      const { error: err } = await supabase.from('children').insert(insert);
      if (err) {
        updated[startIdx + i] = {
          ...row, status: 'error',
          message: err.code === '23505' ? 'كود مكرر' : 'فشل الحفظ',
        };
        fail++;
      } else {
        updated[startIdx + i] = { ...row, status: 'ok' };
        ok++;
      }
      setRows([...updated]);
    }
    setImporting(false);
    setDone({ ok, fail });
  };

  const reset = () => { setRows([]); setMapping([]); setDone(null); setError(''); };

  return (
    <div className="space-y-4 pb-6">
      {/* Scope */}
      <div className="card space-y-3">
        <ScopeSelectors scope={scope} churches={churches} idPrefix="bulk" />
      </div>

      {/* Import sources */}
      {rows.length === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <button
            id="bulk-excel-btn"
            type="button"
            onClick={() => excelInputRef.current?.click()}
            className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
          >
            <FileSpreadsheet className="h-10 w-10 text-emerald-500" />
            <span className="text-xs font-extrabold text-slate-500">استيراد من إكسل</span>
            <span className="text-[10px] text-slate-400" dir="ltr">.xlsx / .xls / .csv</span>
          </button>
          <button
            id="bulk-paste-btn"
            type="button"
            onClick={() => setPasteOpen(true)}
            className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
          >
            <ClipboardPaste className="h-10 w-10 text-primary-500" />
            <span className="text-xs font-extrabold text-slate-500">لصق البيانات</span>
            <span className="text-[10px] text-slate-400">من جدول أو نص</span>
          </button>
          <input
            ref={excelInputRef}
            id="bulk-excel-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onExcelFile}
          />
        </div>
      )}

      {/* Mapping + preview */}
      {rows.length > 0 && (
        <>
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-700">تحديد الأعمدة</h3>
              <button
                id="bulk-reset"
                type="button"
                onClick={reset}
                className="flex items-center gap-1 text-xs font-bold text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" /> مسح البيانات
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <input
                id="bulk-has-header"
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 accent-primary-600"
              />
              الصف الأول عناوين (يتم تجاهله)
            </label>

            {/* Column mapping table */}
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr>
                    {Array.from({ length: colCount }, (_, i) => (
                      <th key={i} className="p-1">
                        <select
                          id={`bulk-map-${i}`}
                          aria-label={`عمود ${i + 1}`}
                          className={`input-field !w-28 !px-2 !py-1.5 !text-xs font-extrabold ${
                            (mapping[i] ?? 'skip') !== 'skip' ? '!border-primary-300 !bg-primary-50' : ''
                          }`}
                          value={mapping[i] ?? 'skip'}
                          onChange={(e) => setColMapping(i, e.target.value as BulkField)}
                        >
                          {BULK_FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                    <th className="p-1 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 50).map((row, ri) => (
                    <tr
                      key={ri}
                      className={
                        row.status === 'ok' ? 'bg-emerald-50'
                        : row.status === 'error' ? 'bg-red-50'
                        : ri % 2 ? 'bg-slate-50' : ''
                      }
                    >
                      {Array.from({ length: colCount }, (_, ci) => (
                        <td key={ci} className="max-w-[130px] truncate border-t border-indigo-50 p-1.5 font-bold text-slate-600">
                          {row.cells[ci] ?? ''}
                        </td>
                      ))}
                      <td className="border-t border-indigo-50 p-1">
                        {row.status === 'ok' ? (
                          <Check className="h-4 w-4 text-emerald-500" />
                        ) : row.status === 'error' ? (
                          <span title={row.message}><X className="h-4 w-4 text-red-500" /></span>
                        ) : (
                          <button
                            type="button"
                            aria-label="حذف الصف"
                            onClick={() => removeRow(ri)}
                            className="text-slate-300 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dataRows.length > 50 && (
              <p className="text-[11px] font-bold text-slate-400">
                يتم عرض أول 50 صفًا فقط — سيتم استيراد {dataRows.length} صفًا
              </p>
            )}

            {/* Error rows messages */}
            {dataRows.some((r) => r.status === 'error') && (
              <ul className="space-y-1 rounded-xl bg-red-50 p-2 text-[11px] font-bold text-red-600">
                {dataRows.map((r, i) =>
                  r.status === 'error' ? (
                    <li key={i}>صف {i + 1}: {r.message} — {r.cells[nameCol] ?? ''}</li>
                  ) : null
                )}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}
          {done && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
              ✓ تم استيراد {done.ok} مخدومًا{done.fail > 0 ? ` — فشل ${done.fail}` : ''}
            </p>
          )}

          <button
            id="bulk-import"
            type="button"
            onClick={doImport}
            disabled={importing || nameCol === -1 || !scope.classId}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {importing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            استيراد {dataRows.filter((r) => r.status !== 'ok').length} مخدومًا
          </button>
        </>
      )}

      {/* Paste modal */}
      {pasteOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-extrabold">لصق البيانات</h3>
              <button type="button" onClick={() => setPasteOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              id="bulk-paste-textarea"
              className="input-field font-mono !text-xs"
              rows={8}
              dir="auto"
              placeholder={'الصق هنا من إكسل أو جوجل شيت...\nكل صف في سطر، الأعمدة مفصولة بـ Tab أو فاصلة'}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              id="bulk-paste-apply"
              type="button"
              onClick={applyPaste}
              disabled={!pasteText.trim()}
              className="btn-primary mt-3 w-full flex items-center justify-center gap-2"
            >
              <Check className="h-5 w-5" />
              معاينة البيانات
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
