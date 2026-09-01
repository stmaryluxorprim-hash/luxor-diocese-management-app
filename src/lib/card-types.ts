// ---------- Card Designer types (JSONB schema of card_templates) ----------
// All positions & sizes are in MILLIMETERS (converted to px on screen).

// ----- element kinds -----
// Variables — filled per person at print time.
export type CardVariableField =
  | 'name'
  | 'age'
  | 'birthdate'
  | 'phone'
  | 'national_id'
  | 'address';

// Constants — fixed values bound to the template scope.
export type CardConstantField = 'church_name' | 'service_name' | 'class_name';

export type CardElementType =
  | 'variable' // person text field
  | 'photo' // person photo
  | 'qr' // QR code of national_id
  | 'constant' // church / service / class name
  | 'text' // free constant text
  | 'logo' // church logo
  | 'image'; // uploaded constant image

export type ImageFit = 'cover' | 'contain' | 'stretch' | 'tile';
export type TextAlign = 'right' | 'center' | 'left';

export interface CardTextStyle {
  fontFamily: string;
  fontSize: number; // pt
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
}

export interface CardElement {
  id: string;
  type: CardElementType;
  field?: CardVariableField | CardConstantField; // for variable / constant
  text?: string; // for free text
  label?: string; // optional prefix shown before variable (e.g. "الاسم:")
  imageUrl?: string; // for image type
  x: number; // mm from left
  y: number; // mm from top
  w: number; // mm
  h: number; // mm
  rotation: number; // degrees
  style: CardTextStyle; // text elements
  imageFit: ImageFit; // photo / logo / image
  borderRadius: number; // mm — for photo / logo / image / qr
  opacity: number; // 0..1
}

// ----- background -----
export interface CardBackground {
  color: string;
  imageUrl: string | null;
  imageFit: ImageFit;
  imageOpacity: number; // 0..1
}

// ----- whole design -----
export interface CardDesign {
  version: 1;
  width: number; // mm
  height: number; // mm
  cornerRadius: number; // mm
  background: CardBackground;
  border: { enabled: boolean; color: string; width: number }; // width mm
  elements: CardElement[];
}

// ----- print settings -----
export type PaperSize = 'A4' | 'A3' | 'A5' | 'Letter' | 'custom';
export type PaperOrientation = 'portrait' | 'landscape';

export interface CardPrintSettings {
  version: 1;
  paper: PaperSize;
  customWidth: number; // mm (paper = custom)
  customHeight: number; // mm
  orientation: PaperOrientation;
  marginTop: number; // mm
  marginBottom: number;
  marginRight: number;
  marginLeft: number;
  gapX: number; // horizontal space between cards (mm)
  gapY: number; // vertical space between cards (mm)
  cutMarks: boolean;
}

// ----- DB row -----
export interface CardTemplate {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  design: CardDesign;
  print_settings: CardPrintSettings;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// ---------- labels ----------
export const VARIABLE_FIELDS: { value: CardVariableField; label: string }[] = [
  { value: 'name', label: 'الاسم' },
  { value: 'age', label: 'السن' },
  { value: 'birthdate', label: 'تاريخ الميلاد' },
  { value: 'phone', label: 'الهاتف' },
  { value: 'national_id', label: 'الرقم القومي' },
  { value: 'address', label: 'العنوان' },
];

export const CONSTANT_FIELDS: { value: CardConstantField; label: string }[] = [
  { value: 'church_name', label: 'اسم الكنيسة' },
  { value: 'service_name', label: 'اسم الخدمة' },
  { value: 'class_name', label: 'اسم الفصل' },
];

export const ELEMENT_TYPE_LABELS: Record<CardElementType, string> = {
  variable: 'بيان متغير',
  photo: 'صورة المخدوم',
  qr: 'رمز QR',
  constant: 'بيان ثابت',
  text: 'نص ثابت',
  logo: 'شعار الكنيسة',
  image: 'صورة / شعار مرفوع',
};

export const IMAGE_FIT_LABELS: Record<ImageFit, string> = {
  cover: 'قص (يملأ)',
  contain: 'احتواء (زووم للداخل)',
  stretch: 'تمديد',
  tile: 'تكرار',
};

export const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: 'Cairo', label: 'Cairo — القاهرة' },
  { value: 'Amiri', label: 'Amiri — أميري' },
  { value: 'Tajawal', label: 'Tajawal — تجوّل' },
  { value: 'El Messiri', label: 'El Messiri — المسيري' },
  { value: 'Reem Kufi', label: 'Reem Kufi — ريم كوفي' },
  { value: 'Noto Naskh Arabic', label: 'Noto Naskh — نسخ' },
  { value: 'Lateef', label: 'Lateef — لطيف' },
  { value: 'Changa', label: 'Changa — تشانجا' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

// Google-font families (need a <link> to load)
export const GOOGLE_FONTS = [
  'Cairo', 'Amiri', 'Tajawal', 'El Messiri', 'Reem Kufi', 'Noto Naskh Arabic', 'Lateef', 'Changa',
];

export const PAPER_SIZES: Record<Exclude<PaperSize, 'custom'>, { w: number; h: number; label: string }> = {
  A4: { w: 210, h: 297, label: 'A4 — ‏210×297 مم' },
  A3: { w: 297, h: 420, label: 'A3 — ‏297×420 مم' },
  A5: { w: 148, h: 210, label: 'A5 — ‏148×210 مم' },
  Letter: { w: 216, h: 279, label: 'Letter — ‏216×279 مم' },
};

// ---------- defaults ----------
export const DEFAULT_TEXT_STYLE: CardTextStyle = {
  fontFamily: 'Cairo',
  fontSize: 12,
  color: '#1e293b',
  bold: true,
  italic: false,
  align: 'center',
};

export const newElement = (type: CardElementType, partial?: Partial<CardElement>): CardElement => ({
  id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  type,
  x: 5,
  y: 5,
  w: type === 'photo' || type === 'qr' || type === 'logo' || type === 'image' ? 20 : 50,
  h: type === 'photo' || type === 'qr' || type === 'logo' || type === 'image' ? 20 : 10,
  rotation: 0,
  style: { ...DEFAULT_TEXT_STYLE },
  imageFit: 'cover',
  borderRadius: type === 'qr' ? 0 : 2,
  opacity: 1,
  ...partial,
});

// Standard CR80 ID-card size (like a credit card)
export const DEFAULT_DESIGN: CardDesign = {
  version: 1,
  width: 85.6,
  height: 54,
  cornerRadius: 3,
  background: { color: '#ffffff', imageUrl: null, imageFit: 'cover', imageOpacity: 1 },
  border: { enabled: true, color: '#1e3a8a', width: 0.5 },
  elements: [
    newElement('logo', { x: 3, y: 3, w: 12, h: 12, borderRadius: 6 }),
    newElement('constant', {
      field: 'church_name', x: 17, y: 3, w: 52, h: 7,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 10, color: '#1e3a8a' },
    }),
    newElement('constant', {
      field: 'service_name', x: 17, y: 10, w: 52, h: 5,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 7, bold: false, color: '#64748b' },
    }),
    newElement('photo', { x: 62, y: 17, w: 20, h: 24, borderRadius: 2 }),
    newElement('variable', {
      field: 'name', x: 4, y: 19, w: 55, h: 8,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 13, align: 'right' },
    }),
    newElement('variable', {
      field: 'phone', label: 'الهاتف:', x: 4, y: 28, w: 55, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, align: 'right' },
    }),
    newElement('constant', {
      field: 'class_name', label: 'الفصل:', x: 4, y: 34, w: 55, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, align: 'right' },
    }),
    newElement('qr', { x: 3, y: 41, w: 11, h: 11, borderRadius: 0 }),
  ],
};

export const DEFAULT_PRINT_SETTINGS: CardPrintSettings = {
  version: 1,
  paper: 'A4',
  customWidth: 210,
  customHeight: 297,
  orientation: 'portrait',
  marginTop: 10,
  marginBottom: 10,
  marginRight: 10,
  marginLeft: 10,
  gapX: 4,
  gapY: 4,
  cutMarks: false,
};

// merge stored JSON (may be partial / old) over defaults
export const normalizeDesign = (d: Partial<CardDesign> | null | undefined): CardDesign => ({
  ...DEFAULT_DESIGN,
  ...d,
  background: { ...DEFAULT_DESIGN.background, ...(d?.background ?? {}) },
  border: { ...DEFAULT_DESIGN.border, ...(d?.border ?? {}) },
  elements: (d?.elements ?? DEFAULT_DESIGN.elements).map((el) => ({
    ...newElement(el.type ?? 'text'),
    ...el,
    style: { ...DEFAULT_TEXT_STYLE, ...(el.style ?? {}) },
  })),
});

export const normalizePrint = (p: Partial<CardPrintSettings> | null | undefined): CardPrintSettings => ({
  ...DEFAULT_PRINT_SETTINGS,
  ...p,
});

// paper size in mm honoring orientation
export const paperDims = (s: CardPrintSettings): { w: number; h: number } => {
  const base = s.paper === 'custom'
    ? { w: s.customWidth, h: s.customHeight }
    : { w: PAPER_SIZES[s.paper].w, h: PAPER_SIZES[s.paper].h };
  return s.orientation === 'landscape' ? { w: base.h, h: base.w } : base;
};

// age in years from birthdate string
export const ageFromBirthdate = (birthdate: string | null): string => {
  if (!birthdate) return '—';
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return '—';
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return String(age);
};
