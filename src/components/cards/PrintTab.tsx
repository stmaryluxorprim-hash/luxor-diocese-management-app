'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Printer, Search, CheckSquare, Square, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Person, EnrollmentWithPerson } from '@/lib/types';
import type { CardDesign, CardPrintSettings, CardTemplate, PaperSize, PaperOrientation } from '@/lib/card-types';
import { PAPER_SIZES, paperDims, H_ALIGN_LABELS, V_ALIGN_LABELS } from '@/lib/card-types';
import type { HAlign, VAlign } from '@/lib/card-types';
import CardCanvas, { type CardConstantsData, type CardPersonData } from './CardCanvas';

// CSS defines 1in = 96px and 1in = 25.4mm → exact physical scale for print
const MM_TO_PX = 96 / 25.4;

function Num({
  label, value, onChange, min = 0, max = 500, step = 1,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label} <span className="text-slate-300">(مم)</span></span>
      <input
        type="number"
        className="input-field !py-2 !px-2.5 !text-sm"
        value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        dir="ltr"
      />
    </label>
  );
}

const personToCardData = (p: Person): CardPersonData => ({
  name: p.name,
  national_id: p.national_id,
  birthdate: p.birthdate,
  phone: p.phone,
  address: p.address,
  image_url: p.image_url,
});

// ============================================================
// PRINT TAB
// ============================================================
export default function PrintTab({
  design, settings, onChange, constants, template,
}: {
  design: CardDesign;
  settings: CardPrintSettings;
  onChange: (s: CardPrintSettings) => void;
  constants: CardConstantsData;
  template: CardTemplate;
}) {
  const supabase = createClient();
  const [persons, setPersons] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  const set = (patch: Partial<CardPrintSettings>) => onChange({ ...settings, ...patch });

  // ---------- load persons in template scope ----------
  const load = useCallback(async () => {
    let q = supabase.from('enrollments').select('*, person:persons(*)').eq('church_id', template.church_id);
    if (template.service_id) q = q.eq('service_id', template.service_id);
    if (template.class_id) q = q.eq('class_id', template.class_id);
    const { data } = await q;
    const list = ((data ?? []) as EnrollmentWithPerson[]).filter((e) => e.person);
    // unique persons (a person may have several enrollments in scope)
    const map = new Map<string, Person>();
    list.forEach((e) => map.set(e.person.id, e.person));
    const arr = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    setPersons(arr);
    setLoading(false);
  }, [supabase, template]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim();
    if (!s) return persons;
    return persons.filter((p) => p.name.includes(s) || p.national_id.includes(s) || (p.phone ?? '').includes(s));
  }, [persons, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((p) => next.delete(p.id));
      else filtered.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const selectedPersons = useMemo(
    () => persons.filter((p) => selected.has(p.id)),
    [persons, selected]
  );

  // ---------- layout math ----------
  const paper = paperDims(settings);
  const usableW = paper.w - settings.marginRight - settings.marginLeft;
  const usableH = paper.h - settings.marginTop - settings.marginBottom;
  const cols = Math.max(0, Math.floor((usableW + settings.gapX) / (design.width + settings.gapX)));
  const rows = Math.max(0, Math.floor((usableH + settings.gapY) / (design.height + settings.gapY)));
  const perPage = cols * rows;
  const pages = perPage > 0 ? Math.ceil(Math.max(selectedPersons.length, 1) / perPage) : 0;

  // grid alignment inside the printable area (mm offsets added to margins)
  const gridW = cols > 0 ? cols * design.width + (cols - 1) * settings.gapX : 0;
  const gridH = rows > 0 ? rows * design.height + (rows - 1) * settings.gapY : 0;
  const alignH = settings.alignH ?? 'center';
  const alignV = settings.alignV ?? 'top';
  const offsetX = alignH === 'left' ? 0 : alignH === 'center' ? (usableW - gridW) / 2 : usableW - gridW;
  const offsetY = alignV === 'top' ? 0 : alignV === 'center' ? (usableH - gridH) / 2 : usableH - gridH;
  // physical left/top of cell (col, row) in mm
  const cellLeft = (col: number) => settings.marginLeft + offsetX + col * (design.width + settings.gapX);
  const cellTop = (row: number) => settings.marginTop + offsetY + row * (design.height + settings.gapY);

  // preview scale (fit paper into ~330px width)
  const previewScale = Math.min(330 / paper.w, 420 / paper.h);

  const doPrint = () => {
    setPrinting(true);
    // give the portal a tick to render QR codes & images before printing
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 800);
  };

  // pages of persons for print
  const printPages = useMemo(() => {
    if (perPage === 0) return [];
    const out: Person[][] = [];
    for (let i = 0; i < selectedPersons.length; i += perPage) {
      out.push(selectedPersons.slice(i, i + perPage));
    }
    return out;
  }, [selectedPersons, perPage]);

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- paper settings ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">الورقة</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">مقاس الورق</span>
            <select
              className="input-field !py-2 !px-2.5 !text-sm"
              value={settings.paper}
              onChange={(e) => set({ paper: e.target.value as PaperSize })}
            >
              {Object.entries(PAPER_SIZES).map(([v, p]) => <option key={v} value={v}>{p.label}</option>)}
              <option value="custom">مخصص…</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الاتجاه</span>
            <div className="flex gap-1">
              {(['portrait', 'landscape'] as PaperOrientation[]).map((o) => (
                <button
                  key={o}
                  onClick={() => set({ orientation: o })}
                  className={`flex-1 rounded-xl border py-2.5 text-xs font-extrabold transition ${
                    settings.orientation === o
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  {o === 'portrait' ? '↕ طولي' : '↔ عرضي'}
                </button>
              ))}
            </div>
          </label>
        </div>
        {settings.paper === 'custom' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Num label="عرض الورقة" value={settings.customWidth} min={50} max={2000} onChange={(v) => set({ customWidth: v })} />
            <Num label="طول الورقة" value={settings.customHeight} min={50} max={2000} onChange={(v) => set({ customHeight: v })} />
          </div>
        )}
      </section>

      {/* ---------- margins & gaps ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">الهوامش والمسافات</h3>
        <div className="grid grid-cols-4 gap-2">
          <Num label="هامش أعلى" value={settings.marginTop} max={100} onChange={(v) => set({ marginTop: v })} />
          <Num label="هامش أسفل" value={settings.marginBottom} max={100} onChange={(v) => set({ marginBottom: v })} />
          <Num label="هامش يمين" value={settings.marginRight} max={100} onChange={(v) => set({ marginRight: v })} />
          <Num label="هامش يسار" value={settings.marginLeft} max={100} onChange={(v) => set({ marginLeft: v })} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Num label="مسافة أفقية بين الكروت" value={settings.gapX} max={100} onChange={(v) => set({ gapX: v })} />
          <Num label="مسافة رأسية بين الكروت" value={settings.gapY} max={100} onChange={(v) => set({ gapY: v })} />
        </div>
        {/* grid alignment inside printable area */}
        <div className="mt-3 border-t border-indigo-50 pt-3">
          <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">محاذاة الكروت داخل الصفحة</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">أفقياً</span>
              <div className="flex gap-1">
                {(['right', 'center', 'left'] as HAlign[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => set({ alignH: a })}
                    className={`flex-1 rounded-xl border py-2 text-[11px] font-extrabold transition ${
                      alignH === a
                        ? 'border-primary-300 bg-primary-50 text-primary-700'
                        : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {H_ALIGN_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">رأسياً</span>
              <div className="flex gap-1">
                {(['top', 'center', 'bottom'] as VAlign[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => set({ alignV: a })}
                    className={`flex-1 rounded-xl border py-2 text-[11px] font-extrabold transition ${
                      alignV === a
                        ? 'border-primary-300 bg-primary-50 text-primary-700'
                        : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {V_ALIGN_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs font-extrabold text-slate-600">
          <input
            type="checkbox"
            checked={settings.cutMarks}
            onChange={(e) => set({ cutMarks: e.target.checked })}
            className="h-4 w-4 accent-primary-600"
          />
          إظهار خطوط القص (إطار رفيع حول كل كارت)
        </label>
        <div className="mt-3 rounded-xl bg-indigo-50/60 p-3 text-xs font-bold text-slate-600">
          التخطيط: <span className="text-primary-700">{cols} × {rows}</span> = {perPage} كارت في الصفحة
          {selectedPersons.length > 0 && perPage > 0 && (
            <> · {selectedPersons.length} مخدوم ← <span className="text-primary-700">{pages} صفحة</span></>
          )}
          {perPage === 0 && <span className="text-red-500"> — الكارت أكبر من مساحة الورقة!</span>}
        </div>
      </section>

      {/* ---------- page preview (frozen at top while scrolling) ---------- */}
      <section className="card !p-3 sticky top-[76px] z-30 !shadow-lg order-first">
        <p className="mb-2 text-xs font-extrabold text-slate-400">
          معاينة الصفحة الأولى — {cols}×{rows} · {H_ALIGN_LABELS[alignH]} / {V_ALIGN_LABELS[alignV]}
        </p>
        <div className="flex justify-center overflow-x-auto py-1" dir="ltr">
          <div
            className="relative bg-white shadow-lg ring-1 ring-slate-200"
            style={{ width: paper.w * previewScale, height: paper.h * previewScale }}
          >
            {/* margin guides */}
            <div
              className="absolute border border-dashed border-indigo-200"
              style={{
                top: settings.marginTop * previewScale,
                bottom: settings.marginBottom * previewScale,
                left: settings.marginLeft * previewScale,
                right: settings.marginRight * previewScale,
              }}
            />
            {perPage > 0 && Array.from({ length: perPage }).map((_, i) => {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const person = selectedPersons[i];
              return (
                <div
                  key={i}
                  className="absolute"
                  style={{
                    left: cellLeft(col) * previewScale,
                    top: cellTop(row) * previewScale,
                  }}
                >
                  {person ? (
                    <CardCanvas design={design} scale={previewScale} person={personToCardData(person)} constants={constants} />
                  ) : (
                    <div
                      className="border border-dashed border-slate-200 bg-slate-50/60"
                      style={{
                        width: design.width * previewScale,
                        height: design.height * previewScale,
                        borderRadius: design.cornerRadius * previewScale,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- person picker ---------- */}
      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
            <Users className="h-4 w-4 text-primary-500" />
            المخدومون
            <span className="badge bg-primary-100 text-primary-700">{selected.size} / {persons.length}</span>
          </h3>
          <button onClick={toggleAll} className="flex items-center gap-1 text-xs font-extrabold text-primary-600 hover:underline">
            {allFilteredSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allFilteredSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
          </button>
        </div>
        <div className="relative mb-2">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            className="input-field !py-2 !pr-9 !text-sm"
            placeholder="بحث بالاسم / الرقم القومي / الهاتف"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary-500" /></div>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => toggle(p.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                    selected.has(p.id)
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-100 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {selected.has(p.id) ? <CheckSquare className="h-4 w-4 shrink-0 text-primary-600" /> : <Square className="h-4 w-4 shrink-0 text-slate-300" />}
                  <span className="min-w-0 flex-1 truncate text-right">{p.name}</span>
                  <span className="text-[10px] font-normal text-slate-300" dir="ltr">{p.national_id}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="py-6 text-center text-xs font-bold text-slate-300">لا نتائج</li>
            )}
          </ul>
        )}
      </section>

      {/* ---------- print button ---------- */}
      <button
        onClick={doPrint}
        disabled={selected.size === 0 || perPage === 0 || printing}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
        طباعة {selected.size > 0 ? `(${selected.size} كارت — ${pages} صفحة)` : ''}
      </button>
      <p className="pb-2 text-center text-[11px] font-bold text-slate-400">
        في نافذة الطباعة: اختر نفس مقاس الورق ({settings.paper === 'custom' ? 'مخصص' : settings.paper})
        واضبط الهوامش على «بلا / None» والمقياس على 100%.
      </p>

      {/* ---------- hidden print sheet (portal to body) ---------- */}
      {typeof document !== 'undefined' && createPortal(
        <div id="card-print-root" dir="rtl">
          <style>{`
            #card-print-root { display: none; }
            @media print {
              body > *:not(#card-print-root) { display: none !important; }
              #card-print-root { display: block !important; }
              @page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }
              html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
              .card-print-page {
                width: ${paper.w}mm;
                height: ${paper.h}mm;
                position: relative;
                overflow: hidden;
                page-break-after: always;
                break-after: page;
              }
              .card-print-page:last-child { page-break-after: auto; break-after: auto; }
              .card-print-cell { position: absolute; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            }
          `}</style>
          {printPages.map((pagePersons, pi) => (
            <div key={pi} className="card-print-page">
              {pagePersons.map((person, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                return (
                  <div
                    key={person.id}
                    className="card-print-cell"
                    style={{
                      left: `${cellLeft(col)}mm`,
                      top: `${cellTop(row)}mm`,
                      outline: settings.cutMarks ? '0.2mm solid #cbd5e1' : undefined,
                      width: `${design.width}mm`,
                      height: `${design.height}mm`,
                    }}
                  >
                    <CardCanvas
                      design={design}
                      scale={MM_TO_PX}
                      person={personToCardData(person)}
                      constants={constants}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
