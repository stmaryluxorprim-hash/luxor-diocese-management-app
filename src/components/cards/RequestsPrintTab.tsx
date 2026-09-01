'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2, Printer, CheckSquare, Square, Inbox, Trash2, X, IdCard, Layers, AlertTriangle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Church, Service, ClassRoom, EnrollmentWithPerson, CardPrintRequest } from '@/lib/types';
import type { CardDesign, CardPrintSettings, CardTemplate } from '@/lib/card-types';
import { normalizeDesign, normalizePrint, paperDims } from '@/lib/card-types';
import CardCanvas, { type CardConstantsData, type CardPersonData } from './CardCanvas';

// CSS defines 1in = 96px and 1in = 25.4mm → exact physical scale for print
const MM_TO_PX = 96 / 25.4;

const enrollmentToCardData = (e: EnrollmentWithPerson): CardPersonData => ({
  name: e.person.name,
  national_id: e.person.national_id,
  birthdate: e.person.birthdate,
  phone: e.person.phone,
  address: e.person.address,
  image_url: e.person.image_url,
});

interface ReqItem {
  requestId: string;
  person: CardPersonData;
  constants: CardConstantsData;
}

interface Group {
  template: CardTemplate; // the bound template
  design: CardDesign;
  settings: CardPrintSettings;
  items: ReqItem[];
}

// full page layout math for a design + print settings
function layoutFor(design: CardDesign, settings: CardPrintSettings) {
  const paper = paperDims(settings);
  const usableW = paper.w - settings.marginRight - settings.marginLeft;
  const usableH = paper.h - settings.marginTop - settings.marginBottom;
  const cols = Math.max(0, Math.floor((usableW + settings.gapX) / (design.width + settings.gapX)));
  const rows = Math.max(0, Math.floor((usableH + settings.gapY) / (design.height + settings.gapY)));
  const perPage = cols * rows;
  const gridW = cols > 0 ? cols * design.width + (cols - 1) * settings.gapX : 0;
  const gridH = rows > 0 ? rows * design.height + (rows - 1) * settings.gapY : 0;
  const alignH = settings.alignH ?? 'center';
  const alignV = settings.alignV ?? 'top';
  const offsetX = alignH === 'left' ? 0 : alignH === 'center' ? (usableW - gridW) / 2 : usableW - gridW;
  const offsetY = alignV === 'top' ? 0 : alignV === 'center' ? (usableH - gridH) / 2 : usableH - gridH;
  const cellLeft = (col: number) => settings.marginLeft + offsetX + col * (design.width + settings.gapX);
  const cellTop = (row: number) => settings.marginTop + offsetY + row * (design.height + settings.gapY);
  return { paper, cols, rows, perPage, cellLeft, cellTop };
}

interface PrintPage {
  design: CardDesign;
  settings: CardPrintSettings;
  layout: ReturnType<typeof layoutFor>;
  items: ReqItem[];
}

// ============================================================
// REQUESTS PRINT TAB — every requested card prints with the
// design of the template BOUND to its scope (church/service/class).
// ============================================================
export default function RequestsPrintTab({
  template, design: liveDesign, settings: liveSettings, constants,
}: {
  template: CardTemplate; // currently open template (uses live unsaved design/settings)
  design: CardDesign;
  settings: CardPrintSettings;
  constants: CardConstantsData;
}) {
  const supabase = createClient();
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentWithPerson[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [requests, setRequests] = useState<CardPrintRequest[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // request ids
  const [deleteAfterPrint, setDeleteAfterPrint] = useState(true);
  const [useCurrentSettings, setUseCurrentSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  // which groups go into the print sheet: 'all' or a template id
  const [printScope, setPrintScope] = useState<'all' | string>('all');

  // ---------- load everything ----------
  const load = useCallback(async () => {
    const [tp, enr, ch, sv, cl, rq] = await Promise.all([
      supabase.from('card_templates').select('*').order('edited_at', { ascending: false }),
      supabase.from('enrollments').select('*, person:persons(*)'),
      supabase.from('churches').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
      supabase.from('card_print_requests').select('*').order('created_at', { ascending: false }),
    ]);
    setTemplates((tp.data ?? []) as CardTemplate[]);
    setEnrollments(((enr.data ?? []) as EnrollmentWithPerson[]).filter((e) => e.person));
    setChurches((ch.data ?? []) as Church[]);
    setServices((sv.data ?? []) as Service[]);
    setClasses((cl.data ?? []) as ClassRoom[]);
    setRequests((rq.data ?? []) as CardPrintRequest[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // realtime: refresh when print requests change
  useEffect(() => {
    const channel = supabase
      .channel('card-print-requests-bound')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_print_requests' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, load]);

  const enrollmentById = useMemo(() => {
    const m = new Map<string, EnrollmentWithPerson>();
    enrollments.forEach((e) => m.set(e.id, e));
    return m;
  }, [enrollments]);

  // per-enrollment constants (church/service/class names)
  const constantsFor = useCallback((e: { church_id: string; service_id: string | null; class_id: string | null }): CardConstantsData => {
    const church = churches.find((c) => c.id === e.church_id);
    const service = services.find((s) => s.id === e.service_id);
    const cls = classes.find((c) => c.id === e.class_id);
    return {
      church_name: church?.name ?? constants.church_name,
      service_name: service?.name ?? constants.service_name,
      class_name: cls?.name ?? constants.class_name,
      church_logo_url: church?.logo_url ?? constants.church_logo_url,
    };
  }, [churches, services, classes, constants]);

  // ---------- bind each request to its template ----------
  // Most specific match wins: exact class → service level (class = all) →
  // church level (service = all). Within a tier the most recently edited wins
  // (templates are already ordered by edited_at desc).
  const bindTemplate = useCallback((r: CardPrintRequest): CardTemplate | null => {
    const exact = templates.find((t) =>
      t.church_id === r.church_id && t.service_id === r.service_id && t.class_id === r.class_id);
    if (exact) return exact;
    const serviceLevel = templates.find((t) =>
      t.church_id === r.church_id && t.service_id === r.service_id && t.class_id === null);
    if (serviceLevel) return serviceLevel;
    const churchLevel = templates.find((t) =>
      t.church_id === r.church_id && t.service_id === null);
    return churchLevel ?? null;
  }, [templates]);

  // ---------- groups: template → its requests ----------
  const { groups, unbound } = useMemo(() => {
    const map = new Map<string, Group>();
    const unbound: { request: CardPrintRequest; name: string }[] = [];
    requests.forEach((r) => {
      const e = enrollmentById.get(r.enrollment_id);
      if (!e) return; // enrollment deleted
      const tpl = bindTemplate(r);
      if (!tpl) {
        unbound.push({ request: r, name: e.person.name });
        return;
      }
      let g = map.get(tpl.id);
      if (!g) {
        // the currently open template uses the LIVE (possibly unsaved) design/settings
        const isCurrent = tpl.id === template.id;
        g = {
          template: tpl,
          design: isCurrent ? liveDesign : normalizeDesign(tpl.design),
          settings: isCurrent ? liveSettings : normalizePrint(tpl.print_settings),
          items: [],
        };
        map.set(tpl.id, g);
      }
      g.items.push({ requestId: r.id, person: enrollmentToCardData(e), constants: constantsFor(e) });
    });
    const groups = Array.from(map.values()).sort((a, b) => a.template.name.localeCompare(b.template.name, 'ar'));
    // stable person order inside each group
    groups.forEach((g) => g.items.sort((a, b) => a.person.name.localeCompare(b.person.name, 'ar')));
    return { groups, unbound };
  }, [requests, enrollmentById, bindTemplate, constantsFor, template.id, liveDesign, liveSettings]);

  const anySelected = selected.size > 0;

  // effective (to-print) items of a group: the selected ones, or ALL when none selected
  const effectiveItems = useCallback((g: Group): ReqItem[] =>
    anySelected ? g.items.filter((i) => selected.has(i.requestId)) : g.items,
  [anySelected, selected]);

  const settingsOf = useCallback((g: Group): CardPrintSettings =>
    useCurrentSettings ? liveSettings : g.settings,
  [useCurrentSettings, liveSettings]);

  // ---------- selection ----------
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (g: Group) => {
    const allOn = g.items.every((i) => selected.has(i.requestId));
    setSelected((prev) => {
      const next = new Set(prev);
      g.items.forEach((i) => { if (allOn) next.delete(i.requestId); else next.add(i.requestId); });
      return next;
    });
  };

  // ---------- delete requests ----------
  const deleteRequests = async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await supabase.from('card_print_requests').delete().in('id', ids);
    if (error) { alert('تعذّر حذف الطلبات: ' + error.message); return; }
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    load();
  };
  const deleteOne = (id: string) => deleteRequests([id]);
  const deleteAll = () => {
    const total = groups.reduce((n, g) => n + g.items.length, 0) + unbound.length;
    if (total === 0) return;
    if (confirm(`حذف كل الطلبات (${total})؟`)) {
      deleteRequests([
        ...groups.flatMap((g) => g.items.map((i) => i.requestId)),
        ...unbound.map((u) => u.request.id),
      ]);
    }
  };

  // ---------- print pages ----------
  const printPages = useMemo<PrintPage[]>(() => {
    const pages: PrintPage[] = [];
    groups
      .filter((g) => printScope === 'all' || g.template.id === printScope)
      .forEach((g) => {
        const st = settingsOf(g);
        const layout = layoutFor(g.design, st);
        if (layout.perPage === 0) return; // card bigger than paper — skip
        const items = effectiveItems(g);
        for (let i = 0; i < items.length; i += layout.perPage) {
          pages.push({ design: g.design, settings: st, layout, items: items.slice(i, i + layout.perPage) });
        }
      });
    return pages;
  }, [groups, printScope, settingsOf, effectiveItems]);

  const totalCards = useMemo(
    () => groups.reduce((n, g) => n + effectiveItems(g).length, 0),
    [groups, effectiveItems]
  );

  const doPrint = (scope: 'all' | string) => {
    setPrintScope(scope);
    setPrinting(true);
    // request ids that will actually be printed
    const printedIds = groups
      .filter((g) => scope === 'all' || g.template.id === scope)
      .filter((g) => layoutFor(g.design, settingsOf(g)).perPage > 0)
      .flatMap((g) => effectiveItems(g).map((i) => i.requestId));
    // give the portal a tick to render QR codes & images before printing
    setTimeout(() => {
      window.print();
      setPrinting(false);
      if (deleteAfterPrint && printedIds.length > 0) {
        if (confirm(`تمت الطباعة — حذف ${printedIds.length} طلب من قائمة المطلوب طباعتهم؟`)) {
          deleteRequests(printedIds);
        }
      }
    }, 800);
  };

  // @page can hold only ONE size — use the first printable page's paper.
  // Groups whose paper differs are best printed via their own group button.
  const firstPaper = printPages[0]?.layout.paper ?? paperDims(liveSettings);
  const mixedPaper = printPages.some(
    (p) => p.layout.paper.w !== firstPaper.w || p.layout.paper.h !== firstPaper.h
  );

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-violet-500" /></div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- header / options ---------- */}
      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
            <Layers className="h-4 w-4 text-violet-500" />
            طباعة الطلبات — كل كارت بتصميمه المرتبط
            <span className="badge bg-violet-100 text-violet-700">
              {anySelected ? `${selected.size} / ` : ''}{groups.reduce((n, g) => n + g.items.length, 0)}
            </span>
          </h3>
          <button
            onClick={deleteAll}
            disabled={groups.length === 0 && unbound.length === 0}
            className="flex items-center gap-1 text-xs font-extrabold text-red-500 hover:underline disabled:opacity-30"
          >
            <Trash2 className="h-3.5 w-3.5" /> حذف الكل
          </button>
        </div>
        <p className="mb-3 text-[11px] font-bold leading-relaxed text-slate-400">
          كل طلب يُطبع تلقائياً بتصميم القالب المرتبط بنطاقه (الفصل ← الخدمة ← الكنيسة — الأكثر تحديداً أولاً).
          بدون تحديد: تُطبع كل الطلبات. حدِّد طلبات معينة لطباعتها فقط.
        </p>
        <label className="flex items-center gap-2 text-xs font-extrabold text-slate-600">
          <input
            type="checkbox"
            checked={useCurrentSettings}
            onChange={(e) => setUseCurrentSettings(e.target.checked)}
            className="h-4 w-4 accent-violet-600"
          />
          توحيد إعدادات الورق: استخدام إعدادات الطباعة الخاصة بهذا القالب لكل المجموعات
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs font-extrabold text-slate-600">
          <input
            type="checkbox"
            checked={deleteAfterPrint}
            onChange={(e) => setDeleteAfterPrint(e.target.checked)}
            className="h-4 w-4 accent-violet-600"
          />
          حذف الطلبات من القائمة بعد الطباعة (بعد تأكيد)
        </label>
      </section>

      {/* ---------- groups ---------- */}
      {groups.length === 0 && unbound.length === 0 && (
        <section className="card py-12 text-center text-sm font-bold text-slate-300">
          <Inbox className="mx-auto mb-2 h-8 w-8" />
          لا توجد طلبات طباعة — أرسلها من صفحة المخدومين (وظيفة «طباعة كارت»)
        </section>
      )}

      {groups.map((g) => {
        const st = settingsOf(g);
        const layout = layoutFor(g.design, st);
        const items = effectiveItems(g);
        const pages = layout.perPage > 0 ? Math.ceil(Math.max(items.length, 0) / layout.perPage) : 0;
        const allOn = g.items.length > 0 && g.items.every((i) => selected.has(i.requestId));
        const previewScale = Math.min(110 / g.design.width, 80 / g.design.height);
        const firstItem = g.items[0];
        const isCurrent = g.template.id === template.id;
        return (
          <section key={g.template.id} className="card">
            {/* group header */}
            <div className="mb-2 flex items-start gap-3">
              {/* mini design preview */}
              <div className="shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200" dir="ltr">
                {firstItem ? (
                  <CardCanvas design={g.design} scale={previewScale} person={firstItem.person} constants={firstItem.constants} />
                ) : (
                  <div style={{ width: g.design.width * previewScale, height: g.design.height * previewScale }} className="bg-slate-50" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate font-extrabold text-slate-700">
                  <IdCard className="h-4 w-4 shrink-0 text-violet-500" />
                  <span className="truncate">{g.template.name}</span>
                  {isCurrent && <span className="badge shrink-0 bg-primary-100 text-primary-700">القالب الحالي</span>}
                </p>
                <p className="mt-0.5 text-[11px] font-bold text-slate-400">
                  {g.items.length} طلب · {layout.cols}×{layout.rows} في الصفحة
                  {layout.perPage > 0
                    ? <> · {items.length} كارت ← {pages} صفحة · ورق {st.paper === 'custom' ? `${layout.paper.w}×${layout.paper.h} مم` : st.paper}</>
                    : <span className="text-red-500"> · الكارت أكبر من الورقة!</span>}
                </p>
                <div className="mt-1.5 flex items-center gap-3">
                  <button onClick={() => toggleGroup(g)} className="flex items-center gap-1 text-xs font-extrabold text-violet-600 hover:underline">
                    {allOn ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    {allOn ? 'إلغاء تحديد المجموعة' : 'تحديد المجموعة'}
                  </button>
                  <button
                    onClick={() => doPrint(g.template.id)}
                    disabled={items.length === 0 || layout.perPage === 0 || printing}
                    className="flex items-center gap-1 text-xs font-extrabold text-primary-600 hover:underline disabled:opacity-30"
                  >
                    <Printer className="h-3.5 w-3.5" /> طباعة المجموعة ({items.length})
                  </button>
                </div>
              </div>
            </div>
            {/* requests of the group */}
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {g.items.map((i) => {
                const checked = selected.has(i.requestId);
                return (
                  <li key={i.requestId} className="flex items-center gap-1">
                    <button
                      onClick={() => toggle(i.requestId)}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                        checked
                          ? 'border-violet-300 bg-violet-50 text-violet-700'
                          : 'border-slate-100 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {checked ? <CheckSquare className="h-4 w-4 shrink-0 text-violet-600" /> : <Square className="h-4 w-4 shrink-0 text-slate-300" />}
                      <span className="min-w-0 flex-1 truncate text-right">{i.person.name}</span>
                      <span className="shrink-0 text-[10px] font-normal text-slate-300" dir="ltr">{i.constants.class_name}</span>
                    </button>
                    <button
                      onClick={() => deleteOne(i.requestId)}
                      className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      title="حذف الطلب"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {/* ---------- unbound requests (no matching template) ---------- */}
      {unbound.length > 0 && (
        <section className="card border-2 border-dashed !border-amber-200">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            طلبات بدون قالب مرتبط ({unbound.length})
          </h3>
          <p className="mb-2 text-[11px] font-bold text-slate-400">
            لا يوجد قالب يغطي نطاق هذه الطلبات — أنشئ قالباً لكنيستها / خدمتها / فصلها أو غيّر ربط قالب موجود.
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {unbound.map((u) => (
              <li key={u.request.id} className="flex items-center gap-1">
                <span className="flex min-w-0 flex-1 items-center rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 text-sm font-bold text-slate-600">
                  <span className="min-w-0 flex-1 truncate text-right">{u.name}</span>
                </span>
                <button
                  onClick={() => deleteOne(u.request.id)}
                  className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                  title="حذف الطلب"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- print all button ---------- */}
      <button
        onClick={() => doPrint('all')}
        disabled={totalCards === 0 || printing}
        className="btn-primary w-full flex items-center justify-center gap-2 !from-violet-600 !to-violet-500"
      >
        {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
        طباعة الكل {totalCards > 0 ? `(${totalCards} كارت — ${printPages.length} صفحة)` : ''}
      </button>
      {mixedPaper && printScope === 'all' && (
        <p className="rounded-xl bg-amber-50 p-2 text-center text-[11px] font-bold text-amber-600">
          ⚠️ المجموعات تستخدم مقاسات ورق مختلفة — يُفضّل طباعة كل مجموعة على حدة بزر «طباعة المجموعة»،
          أو فعِّل «توحيد إعدادات الورق» أعلاه.
        </p>
      )}
      <p className="pb-2 text-center text-[11px] font-bold text-slate-400">
        في نافذة الطباعة: اختر نفس مقاس الورق واضبط الهوامش على «بلا / None» والمقياس على 100%.
      </p>

      {/* ---------- hidden print sheet (portal to body) ---------- */}
      {typeof document !== 'undefined' && createPortal(
        <div id="card-print-root" dir="rtl">
          <style>{`
            #card-print-root { display: none; }
            @media print {
              body > *:not(#card-print-root) { display: none !important; }
              #card-print-root { display: block !important; }
              @page { size: ${firstPaper.w}mm ${firstPaper.h}mm; margin: 0; }
              html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
              .card-print-page {
                position: relative;
                overflow: hidden;
                page-break-after: always;
                break-after: page;
              }
              .card-print-page:last-child { page-break-after: auto; break-after: auto; }
              .card-print-cell { position: absolute; }
              .card-print-centerline { position: absolute; background: #94a3b8; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            }
          `}</style>
          {printPages.map((p, pi) => (
            <div
              key={pi}
              className="card-print-page"
              style={{ width: `${p.layout.paper.w}mm`, height: `${p.layout.paper.h}mm` }}
            >
              {p.settings.centerLineV && (
                <div
                  className="card-print-centerline"
                  style={{ left: `${p.layout.paper.w / 2}mm`, top: 0, width: '0.2mm', height: `${p.layout.paper.h}mm` }}
                />
              )}
              {p.settings.centerLineH && (
                <div
                  className="card-print-centerline"
                  style={{ top: `${p.layout.paper.h / 2}mm`, left: 0, height: '0.2mm', width: `${p.layout.paper.w}mm` }}
                />
              )}
              {p.items.map((item, i) => {
                const col = i % p.layout.cols;
                const row = Math.floor(i / p.layout.cols);
                return (
                  <div
                    key={item.requestId}
                    className="card-print-cell"
                    style={{
                      left: `${p.layout.cellLeft(col)}mm`,
                      top: `${p.layout.cellTop(row)}mm`,
                      outline: p.settings.cutMarks ? '0.2mm solid #cbd5e1' : undefined,
                      width: `${p.design.width}mm`,
                      height: `${p.design.height}mm`,
                    }}
                  >
                    <CardCanvas
                      design={p.design}
                      scale={MM_TO_PX}
                      person={item.person}
                      constants={item.constants}
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
