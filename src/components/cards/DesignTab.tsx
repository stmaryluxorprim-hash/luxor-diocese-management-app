'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Upload, X, ChevronUp, ChevronDown, Loader2,
  Type, User, QrCode, Landmark, ImagePlus, TextCursorInput, Image as ImageIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import type {
  CardDesign, CardElement, CardElementType, CardVariableField, CardConstantField, ImageFit, TextAlign,
} from '@/lib/card-types';
import {
  newElement, VARIABLE_FIELDS, CONSTANT_FIELDS, ELEMENT_TYPE_LABELS,
  IMAGE_FIT_LABELS, FONT_FAMILIES,
} from '@/lib/card-types';
import CardCanvas, { SAMPLE_PERSON, type CardConstantsData } from './CardCanvas';

// ---------- small labelled number input (mm / pt / deg) ----------
function Num({
  label, value, onChange, min = 0, max = 500, step = 0.5, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
        {label}{suffix && <span className="text-slate-300"> ({suffix})</span>}
      </span>
      <input
        type="number"
        className="input-field !py-2 !px-2.5 !text-sm"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        dir="ltr"
      />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5"
        />
        <input
          className="input-field !py-2 !px-2.5 !text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir="ltr"
        />
      </div>
    </label>
  );
}

// ---------- element icon per type ----------
const TYPE_ICONS: Record<CardElementType, React.ReactNode> = {
  variable: <TextCursorInput className="h-4 w-4" />,
  photo: <User className="h-4 w-4" />,
  qr: <QrCode className="h-4 w-4" />,
  constant: <Landmark className="h-4 w-4" />,
  text: <Type className="h-4 w-4" />,
  logo: <Landmark className="h-4 w-4" />,
  image: <ImageIcon className="h-4 w-4" />,
};

const elementTitle = (el: CardElement): string => {
  if (el.type === 'variable') return VARIABLE_FIELDS.find((f) => f.value === el.field)?.label ?? 'بيان';
  if (el.type === 'constant') return CONSTANT_FIELDS.find((f) => f.value === el.field)?.label ?? 'ثابت';
  if (el.type === 'text') return el.text?.slice(0, 18) || 'نص ثابت';
  return ELEMENT_TYPE_LABELS[el.type];
};

// ============================================================
// DESIGN TAB
// ============================================================
export default function DesignTab({
  design, onChange, constants,
}: {
  design: CardDesign;
  onChange: (d: CardDesign) => void;
  constants: CardConstantsData;
}) {
  const supabase = createClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);

  const selected = design.elements.find((e) => e.id === selectedId) ?? null;

  // preview scale: fit card into ~340px width (or less on small screens)
  const scale = useMemo(() => Math.min(340 / design.width, 220 / design.height), [design.width, design.height]);

  // ---------- mutators ----------
  const set = (patch: Partial<CardDesign>) => onChange({ ...design, ...patch });
  const setBg = (patch: Partial<CardDesign['background']>) =>
    set({ background: { ...design.background, ...patch } });
  const setBorder = (patch: Partial<CardDesign['border']>) =>
    set({ border: { ...design.border, ...patch } });

  const updateEl = (id: string, patch: Partial<CardElement>) =>
    set({ elements: design.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const updateElStyle = (id: string, patch: Partial<CardElement['style']>) =>
    set({
      elements: design.elements.map((e) =>
        e.id === id ? { ...e, style: { ...e.style, ...patch } } : e
      ),
    });
  const removeEl = (id: string) => {
    set({ elements: design.elements.filter((e) => e.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };
  const moveLayer = (id: string, dir: -1 | 1) => {
    const idx = design.elements.findIndex((e) => e.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= design.elements.length) return;
    const arr = [...design.elements];
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    set({ elements: arr });
  };

  const addElement = (type: CardElementType, field?: CardVariableField | CardConstantField) => {
    const el = newElement(type, {
      field,
      text: type === 'text' ? 'نص جديد' : undefined,
      x: Math.max(2, design.width / 2 - 15),
      y: Math.max(2, design.height / 2 - 5),
    });
    set({ elements: [...design.elements, el] });
    setSelectedId(el.id);
    setShowAddMenu(false);
  };

  // ---------- uploads ----------
  const uploadBg = async (file: File) => {
    setUploadingBg(true);
    try {
      const url = await uploadPhoto(supabase, 'cards', file);
      setBg({ imageUrl: url });
    } finally { setUploadingBg(false); }
  };
  const uploadElImage = async (file: File) => {
    if (!selected) return;
    setUploadingImg(true);
    try {
      const url = await uploadPhoto(supabase, 'cards', file);
      updateEl(selected.id, { imageUrl: url });
    } finally { setUploadingImg(false); }
  };

  return (
    <div className="space-y-4">
      {/* ---------- live preview ---------- */}
      <section className="card !p-3">
        <p className="mb-2 text-xs font-extrabold text-slate-400">
          معاينة حية — اسحب العناصر لتحريكها · بيانات تجريبية: {SAMPLE_PERSON.name}
        </p>
        <div className="flex justify-center overflow-x-auto py-2" dir="ltr">
          <div className="shadow-lg" style={{ borderRadius: design.cornerRadius * scale }}>
            <CardCanvas
              design={design}
              scale={scale}
              constants={constants}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={(id, x, y) => updateEl(id, { x, y })}
            />
          </div>
        </div>
      </section>

      {/* ---------- card size ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">مقاس الكارت</h3>
        <div className="grid grid-cols-3 gap-2">
          <Num label="العرض" suffix="مم" value={design.width} min={30} max={300} onChange={(v) => set({ width: v })} />
          <Num label="الطول" suffix="مم" value={design.height} min={30} max={300} onChange={(v) => set({ height: v })} />
          <Num label="استدارة الأركان" suffix="مم" value={design.cornerRadius} min={0} max={30} onChange={(v) => set({ cornerRadius: v })} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { label: 'كارت ID ‏85.6×54', w: 85.6, h: 54 },
            { label: 'A6 ‏105×148', w: 105, h: 148 },
            { label: 'A7 ‏74×105', w: 74, h: 105 },
            { label: 'مربع ‏90×90', w: 90, h: 90 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => set({ width: p.w, height: p.h })}
              className="badge bg-primary-50 text-primary-600 hover:bg-primary-100 transition !py-1"
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* ---------- background ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">الخلفية</h3>
        <div className="grid grid-cols-2 gap-2">
          <ColorInput label="لون الخلفية" value={design.background.color} onChange={(v) => setBg({ color: v })} />
          <div>
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">صورة الخلفية</span>
            <input
              ref={bgFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadBg(e.target.files[0])}
            />
            {design.background.imageUrl ? (
              <div className="flex items-center gap-2">
                <button onClick={() => bgFileRef.current?.click()} className="btn-secondary !py-2 !px-3 flex-1 text-xs flex items-center justify-center gap-1">
                  {uploadingBg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  تغيير
                </button>
                <button onClick={() => setBg({ imageUrl: null })} aria-label="إزالة الخلفية" className="rounded-xl bg-red-50 p-2 text-red-500">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => bgFileRef.current?.click()} className="btn-secondary !py-2 !px-3 w-full text-xs flex items-center justify-center gap-1">
                {uploadingBg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                رفع صورة
              </button>
            )}
          </div>
        </div>
        {design.background.imageUrl && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">طريقة العرض</span>
              <select
                className="input-field !py-2 !px-2.5 !text-sm"
                value={design.background.imageFit}
                onChange={(e) => setBg({ imageFit: e.target.value as ImageFit })}
              >
                {Object.entries(IMAGE_FIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
                شفافية الصورة ({Math.round(design.background.imageOpacity * 100)}%)
              </span>
              <input
                type="range" min={0.05} max={1} step={0.05}
                value={design.background.imageOpacity}
                onChange={(e) => setBg({ imageOpacity: Number(e.target.value) })}
                className="mt-3 w-full accent-primary-600"
              />
            </label>
          </div>
        )}
        {/* border */}
        <div className="mt-3 border-t border-indigo-50 pt-3">
          <label className="mb-2 flex items-center gap-2 text-xs font-extrabold text-slate-600">
            <input
              type="checkbox"
              checked={design.border.enabled}
              onChange={(e) => setBorder({ enabled: e.target.checked })}
              className="h-4 w-4 accent-primary-600"
            />
            إطار حول الكارت
          </label>
          {design.border.enabled && (
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="لون الإطار" value={design.border.color} onChange={(v) => setBorder({ color: v })} />
              <Num label="سُمك الإطار" suffix="مم" value={design.border.width} min={0.1} max={5} step={0.1} onChange={(v) => setBorder({ width: v })} />
            </div>
          )}
        </div>
      </section>

      {/* ---------- elements list ---------- */}
      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-600">العناصر ({design.elements.length})</h3>
          <div className="relative">
            <button onClick={() => setShowAddMenu((v) => !v)} className="btn-primary !py-1.5 !px-3 flex items-center gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" /> إضافة عنصر
            </button>
            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                <div className="absolute left-0 z-20 mt-1 w-56 rounded-2xl border border-indigo-50 bg-white p-2 shadow-xl max-h-80 overflow-y-auto">
                  <p className="px-2 py-1 text-[10px] font-extrabold text-slate-400">بيانات متغيرة (لكل مخدوم)</p>
                  {VARIABLE_FIELDS.map((f) => (
                    <button key={f.value} onClick={() => addElement('variable', f.value)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-primary-50">
                      <TextCursorInput className="h-4 w-4 text-primary-500" /> {f.label}
                    </button>
                  ))}
                  <button onClick={() => addElement('photo')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-primary-50">
                    <User className="h-4 w-4 text-primary-500" /> صورة المخدوم
                  </button>
                  <button onClick={() => addElement('qr')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-primary-50">
                    <QrCode className="h-4 w-4 text-primary-500" /> رمز QR (الرقم القومي)
                  </button>
                  <p className="mt-1 border-t border-indigo-50 px-2 py-1 text-[10px] font-extrabold text-slate-400">ثوابت</p>
                  {CONSTANT_FIELDS.map((f) => (
                    <button key={f.value} onClick={() => addElement('constant', f.value)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50">
                      <Landmark className="h-4 w-4 text-gold-500" /> {f.label}
                    </button>
                  ))}
                  <button onClick={() => addElement('logo')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50">
                    <Landmark className="h-4 w-4 text-gold-500" /> شعار الكنيسة
                  </button>
                  <button onClick={() => addElement('text')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50">
                    <Type className="h-4 w-4 text-gold-500" /> نص ثابت
                  </button>
                  <button onClick={() => addElement('image')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50">
                    <ImagePlus className="h-4 w-4 text-gold-500" /> صورة / شعار مرفوع
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <ul className="space-y-1.5">
          {[...design.elements].reverse().map((el) => (
            <li key={el.id}>
              <button
                onClick={() => setSelectedId(el.id === selectedId ? null : el.id)}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                  selectedId === el.id
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-slate-100 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-primary-500">{TYPE_ICONS[el.type]}</span>
                <span className="min-w-0 flex-1 truncate text-right">{elementTitle(el)}</span>
                <span className="text-[10px] font-normal text-slate-300" dir="ltr">
                  {el.x}, {el.y} مم
                </span>
              </button>
            </li>
          ))}
          {design.elements.length === 0 && (
            <li className="py-6 text-center text-xs font-bold text-slate-300">لا توجد عناصر — أضف عنصراً</li>
          )}
        </ul>
      </section>

      {/* ---------- selected element inspector ---------- */}
      {selected && (
        <section className="card border-primary-200 !border-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-primary-700">
              {TYPE_ICONS[selected.type]} {elementTitle(selected)}
            </h3>
            <div className="flex items-center gap-1">
              <button onClick={() => moveLayer(selected.id, 1)} aria-label="طبقة لأعلى" className="rounded-lg bg-slate-50 p-1.5 text-slate-500 hover:bg-slate-100">
                <ChevronUp className="h-4 w-4" />
              </button>
              <button onClick={() => moveLayer(selected.id, -1)} aria-label="طبقة لأسفل" className="rounded-lg bg-slate-50 p-1.5 text-slate-500 hover:bg-slate-100">
                <ChevronDown className="h-4 w-4" />
              </button>
              <button onClick={() => removeEl(selected.id)} aria-label="حذف العنصر" className="rounded-lg bg-red-50 p-1.5 text-red-500 hover:bg-red-100">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* position & size */}
          <div className="grid grid-cols-4 gap-2">
            <Num label="س (من اليسار)" value={selected.x} min={-50} max={300} onChange={(v) => updateEl(selected.id, { x: v })} />
            <Num label="ص (من الأعلى)" value={selected.y} min={-50} max={300} onChange={(v) => updateEl(selected.id, { y: v })} />
            <Num label="العرض" value={selected.w} min={1} max={300} onChange={(v) => updateEl(selected.id, { w: v })} />
            <Num label="الارتفاع" value={selected.h} min={1} max={300} onChange={(v) => updateEl(selected.id, { h: v })} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Num label="الدوران" suffix="°" value={selected.rotation} min={-180} max={180} step={1} onChange={(v) => updateEl(selected.id, { rotation: v })} />
            <Num label="استدارة الأركان" suffix="مم" value={selected.borderRadius} min={0} max={50} onChange={(v) => updateEl(selected.id, { borderRadius: v })} />
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
                الشفافية ({Math.round(selected.opacity * 100)}%)
              </span>
              <input
                type="range" min={0.05} max={1} step={0.05}
                value={selected.opacity}
                onChange={(e) => updateEl(selected.id, { opacity: Number(e.target.value) })}
                className="mt-3 w-full accent-primary-600"
              />
            </label>
          </div>

          {/* free text content */}
          {selected.type === 'text' && (
            <label className="mt-2 block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">النص</span>
              <textarea
                className="input-field !py-2 !text-sm"
                rows={2}
                value={selected.text ?? ''}
                onChange={(e) => updateEl(selected.id, { text: e.target.value })}
              />
            </label>
          )}

          {/* label prefix for variables / constants */}
          {(selected.type === 'variable' || selected.type === 'constant') && (
            <label className="mt-2 block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">نص قبل القيمة (اختياري)</span>
              <input
                className="input-field !py-2 !text-sm"
                value={selected.label ?? ''}
                onChange={(e) => updateEl(selected.id, { label: e.target.value })}
                placeholder="مثال: الاسم:"
              />
            </label>
          )}

          {/* text style */}
          {(selected.type === 'variable' || selected.type === 'constant' || selected.type === 'text') && (
            <div className="mt-3 border-t border-indigo-50 pt-3">
              <p className="mb-2 text-[11px] font-extrabold text-slate-400">الخط</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-bold text-slate-500">نوع الخط</span>
                  <select
                    className="input-field !py-2 !px-2.5 !text-sm"
                    value={selected.style.fontFamily}
                    onChange={(e) => updateElStyle(selected.id, { fontFamily: e.target.value })}
                  >
                    {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </label>
                <Num label="حجم الخط" suffix="pt" value={selected.style.fontSize} min={4} max={72} step={0.5} onChange={(v) => updateElStyle(selected.id, { fontSize: v })} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <ColorInput label="لون الخط" value={selected.style.color} onChange={(v) => updateElStyle(selected.id, { color: v })} />
                <div>
                  <span className="mb-0.5 block text-[11px] font-bold text-slate-500">التنسيق والمحاذاة</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => updateElStyle(selected.id, { bold: !selected.style.bold })}
                      className={`flex-1 rounded-lg border py-2 text-sm font-black transition ${selected.style.bold ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-400'}`}
                    >B</button>
                    <button
                      onClick={() => updateElStyle(selected.id, { italic: !selected.style.italic })}
                      className={`flex-1 rounded-lg border py-2 text-sm italic transition ${selected.style.italic ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-400'}`}
                    >I</button>
                    {(['right', 'center', 'left'] as TextAlign[]).map((a) => (
                      <button
                        key={a}
                        onClick={() => updateElStyle(selected.id, { align: a })}
                        className={`flex-1 rounded-lg border py-2 text-[10px] font-bold transition ${selected.style.align === a ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-400'}`}
                      >
                        {a === 'right' ? 'يمين' : a === 'center' ? 'وسط' : 'يسار'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* image settings */}
          {(selected.type === 'photo' || selected.type === 'logo' || selected.type === 'image') && (
            <div className="mt-3 border-t border-indigo-50 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-bold text-slate-500">طريقة عرض الصورة</span>
                  <select
                    className="input-field !py-2 !px-2.5 !text-sm"
                    value={selected.imageFit}
                    onChange={(e) => updateEl(selected.id, { imageFit: e.target.value as ImageFit })}
                  >
                    {Object.entries(IMAGE_FIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {selected.type === 'image' && (
                  <div>
                    <span className="mb-0.5 block text-[11px] font-bold text-slate-500">ملف الصورة</span>
                    <input
                      ref={imgFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadElImage(e.target.files[0])}
                    />
                    <button onClick={() => imgFileRef.current?.click()} className="btn-secondary !py-2 !px-3 w-full text-xs flex items-center justify-center gap-1">
                      {uploadingImg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {selected.imageUrl ? 'تغيير الصورة' : 'رفع صورة'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
