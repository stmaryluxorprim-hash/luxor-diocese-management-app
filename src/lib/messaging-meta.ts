// ---------- Messaging module — labels, icons, trigger meta ----------
import type { LucideIcon } from 'lucide-react';
import {
  Bell, Info, CheckCircle2, AlertTriangle, PartyPopper, Clock, Siren, MessageCircle,
  Cake, CalendarClock, UserX, Moon, AlarmClock, CalendarCheck, Star, UserPlus, GraduationCap, ShoppingBag, FileEdit,
  Smartphone, MessageSquare, Send,
} from 'lucide-react';
import type { NotificationKind, Channel, Audience, ConversationKind, AutomationTrigger, TemplateCategory } from '@/lib/messaging-types';

export const KIND_META: Record<NotificationKind, { label: string; icon: LucideIcon; bg: string; fg: string; ring: string }> = {
  info:        { label: 'معلومة', icon: Info,          bg: 'bg-sky-50',     fg: 'text-sky-700',     ring: 'ring-sky-200' },
  success:     { label: 'نجاح',   icon: CheckCircle2,  bg: 'bg-emerald-50', fg: 'text-emerald-700', ring: 'ring-emerald-200' },
  warning:     { label: 'تنبيه',  icon: AlertTriangle, bg: 'bg-amber-50',   fg: 'text-amber-700',   ring: 'ring-amber-200' },
  celebration: { label: 'تهنئة',  icon: PartyPopper,   bg: 'bg-pink-50',    fg: 'text-pink-700',    ring: 'ring-pink-200' },
  reminder:    { label: 'تذكير',  icon: Clock,         bg: 'bg-violet-50',  fg: 'text-violet-700',  ring: 'ring-violet-200' },
  alert:       { label: 'هام',    icon: Siren,         bg: 'bg-red-50',     fg: 'text-red-700',     ring: 'ring-red-200' },
  message:     { label: 'رسالة',  icon: MessageCircle, bg: 'bg-indigo-50',  fg: 'text-indigo-700',  ring: 'ring-indigo-200' },
};

export const CHANNEL_META: Record<Channel, { label: string; short: string; icon: LucideIcon; desc: string; bg: string; fg: string }> = {
  in_app:   { label: 'إشعار داخل التطبيق', short: 'إشعار',  icon: Bell,          desc: 'يظهر في جرس الإشعارات (بوابة المخدوم / التطبيق)',            bg: 'bg-indigo-600',  fg: 'text-white' },
  chat:     { label: 'رسالة في المحادثة',  short: 'محادثة', icon: MessageSquare, desc: 'تُكتب في محادثة المخدوم مع خدامه',                            bg: 'bg-sky-600',     fg: 'text-white' },
  whatsapp: { label: 'واتساب',             short: 'واتساب', icon: Smartphone,    desc: 'تدخل قائمة الإرسال — تُرسل من هاتف الخادم بضغطة',             bg: 'bg-emerald-600', fg: 'text-white' },
  sms:      { label: 'رسالة SMS',          short: 'SMS',    icon: Send,          desc: 'تدخل قائمة الإرسال — تُرسل من هاتف الخادم بضغطة',             bg: 'bg-amber-500',   fg: 'text-white' },
};

export const AUDIENCE_LABELS: Record<Audience, string> = { children: 'المخدومين', servants: 'الخدام', both: 'المخدومين والخدام' };
export const CONV_KIND_LABELS: Record<ConversationKind, string> = { direct: 'مخدوم', staff: 'خادم', group: 'مجموعة' };

export interface TriggerMeta { label: string; desc: string; icon: LucideIcon; color: string; timeBased: boolean; vars: string[] }
export const TRIGGER_META: Record<AutomationTrigger, TriggerMeta> = {
  birthday:       { label: 'عيد ميلاد',             desc: 'في يوم عيد الميلاد (أو قبله بأيام) في ساعة محددة',          icon: Cake,          color: 'text-pink-600',    timeBased: true,  vars: ['السن الجديدة', 'تاريخ العيد', 'أيام متبقية', 'أسماء أصحاب العيد'] },
  schedule:       { label: 'موعد مجدول',            desc: 'مرة واحدة أو يومياً / أسبوعياً / شهرياً في ساعة محددة',       icon: CalendarClock, color: 'text-sky-600',     timeBased: true,  vars: [] },
  absent:         { label: 'غياب عن مناسبة',        desc: 'لم يُسجَّل حضوره في مناسبة (أو عدة مرات متتالية)',            icon: UserX,         color: 'text-red-600',     timeBased: true,  vars: ['اسم المناسبة', 'تاريخ الغياب', 'يوم الغياب', 'مرات الغياب', 'اسم المخدوم'] },
  inactive:       { label: 'انقطاع طويل',           desc: 'لم يحضر أي شيء منذ N يوم (يتكرر كل N يوم)',                    icon: Moon,          color: 'text-slate-600',   timeBased: true,  vars: ['أيام الغياب', 'آخر حضور', 'اسم المخدوم'] },
  event_reminder: { label: 'تذكير قبل المناسبة',    desc: 'قبل بداية المناسبة بعدد دقائق',                                icon: AlarmClock,    color: 'text-violet-600',  timeBased: true,  vars: ['اسم المناسبة', 'وقت المناسبة', 'تاريخ المناسبة', 'يوم المناسبة', 'بعد كم دقيقة'] },
  attendance:     { label: 'عند تسجيل الحضور',      desc: 'لحظة تسجيل حضور المخدوم (كل المناسبات أو مناسبة محددة)',     icon: CalendarCheck, color: 'text-emerald-600', timeBased: false, vars: ['اسم المناسبة', 'نقاط الحضور', 'اسم المخدوم'] },
  points:         { label: 'عند تغيّر النقاط',      desc: 'إضافة / خصم نقاط، أو عند الوصول لهدف (كل 100 نقطة مثلاً)',     icon: Star,          color: 'text-gold-600',    timeBased: false, vars: ['التغير', 'السبب', 'الهدف', 'اسم المناسبة', 'اسم المخدوم'] },
  new_enrollment: { label: 'مخدوم جديد',            desc: 'عند تسجيل مخدوم جديد في النطاق (رسالة ترحيب)',                icon: UserPlus,      color: 'text-teal-600',    timeBased: false, vars: ['اسم المخدوم'] },
  exam_result:    { label: 'نتيجة امتحان',          desc: 'عند انتهاء المخدوم من امتحان (الكل / الناجح / غير الناجح)',   icon: GraduationCap, color: 'text-violet-600',  timeBased: false, vars: ['اسم الامتحان', 'الدرجة', 'الدرجة الكاملة', 'النسبة', 'النتيجة', 'نقاط الامتحان', 'اسم المخدوم'] },
  store_order:    { label: 'عملية إستبدال نقاط',    desc: 'عند شراء المخدوم من متجر النقاط',                              icon: ShoppingBag,   color: 'text-orange-600',  timeBased: false, vars: ['عدد الأصناف', 'إجمالي النقاط', 'الرصيد بعد', 'اسم المخدوم'] },
  data_request:   { label: 'قرار طلب تعديل بيانات', desc: 'عند الموافقة على / رفض طلب تعديل بيانات المخدوم',              icon: FileEdit,      color: 'text-indigo-600',  timeBased: false, vars: ['نوع الطلب', 'القرار', 'ملاحظة القرار'] },
};

export const CHILD_VARS = [
  'الاسم الأول', 'الاسم الكامل', 'ضمير', 'السن', 'تاريخ الميلاد', 'رقم الهاتف', 'اسم الفصل', 'اسم الخدمة', 'اسم الكنيسة',
  'النقاط', 'عدد الحضور', 'آخر حضور', 'أيام الغياب', 'التاريخ', 'اليوم', 'الوقت',
];
export const SERVANT_VARS = ['اسم الخادم', 'الاسم الأول', 'الدور', 'اسم الكنيسة', 'اسم الخدمة', 'اسم الفصل', 'التاريخ', 'اليوم', 'الوقت'];
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  general: 'عام', birthday: 'عيد ميلاد', absent: 'غياب', welcome: 'ترحيب', reminder: 'تذكير', points: 'نقاط', exam: 'امتحان', announcement: 'إعلان',
};
export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
