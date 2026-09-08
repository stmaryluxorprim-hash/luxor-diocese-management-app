import type { LucideIcon } from 'lucide-react'
import {
  Cake, UserX, Siren, UserPlus, AlarmClock, Star, Moon, GraduationCap, CalendarClock, ShoppingBag,
} from 'lucide-react'
import type { AutomationInput } from '@/lib/messaging-types'

/** Ready-made automation recipes shown in the "new automation" picker. */
export interface AutomationPreset {
  key: string
  title: string
  desc: string
  icon: LucideIcon
  color: string
  build: (churchId: string | null) => AutomationInput
}

export function emptyAutomation(churchId: string | null): AutomationInput {
  return {
    church_id: churchId, service_id: null, class_id: null,
    name: '', description: null, is_active: true,
    trigger: 'birthday', trigger_config: { at: '09:00', days_before: 0 },
    audience: 'children', audience_filter: {},
    channels: ['in_app'], title: '', body: '', kind: 'info', icon: null, color: null, link: null,
    respect_quiet_hours: true, cooldown_hours: 0,
    starts_at: new Date().toISOString(), ends_at: null,
  }
}

const p = (churchId: string | null, patch: Partial<AutomationInput>): AutomationInput => ({ ...emptyAutomation(churchId), ...patch })

export const AUTOMATION_PRESETS: AutomationPreset[] = [
  {
    key: 'birthday', title: 'تهنئة عيد ميلاد المخدومين', desc: 'رسالة تلقائية لكل مخدوم في يوم عيد ميلاده.',
    icon: Cake, color: 'text-pink-600 bg-pink-50',
    build: (c) => p(c, {
      name: 'تهنئة عيد ميلاد', trigger: 'birthday', trigger_config: { at: '09:00', days_before: 0 },
      audience: 'children', kind: 'celebration', channels: ['in_app', 'whatsapp'],
      title: 'كل سنة وأنت طيب يا [الاسم الأول] 🎂',
      body: 'كل سنة وأنت طيب[ضمير] يا [الاسم الأول]! أسرة خدمة [اسم الخدمة] بكنيسة [اسم الكنيسة] تهنئك بعيد ميلادك وتتمنى لك سنة مليئة بالبركة والفرح 🎉',
    }),
  },
  {
    key: 'birthday_staff', title: 'تنبيه الخدام بأعياد ميلاد الغد', desc: 'إشعار للخدام قبل عيد ميلاد المخدوم بيوم.',
    icon: Cake, color: 'text-rose-600 bg-rose-50',
    build: (c) => p(c, {
      name: 'أعياد ميلاد الغد', trigger: 'birthday', trigger_config: { at: '18:00', days_before: 1 },
      audience: 'servants', kind: 'reminder', link: '/birthdays',
      title: 'عيد ميلاد [الاسم الكامل] غداً',
      body: 'غداً عيد ميلاد المخدوم [الاسم الكامل] من فصل [اسم الفصل] — لا تنسَ التهنئة 🎂',
    }),
  },
  {
    key: 'absent', title: 'رسالة بعد الغياب', desc: 'تصل للمخدوم عند تسجيل غيابه في الحضور.',
    icon: UserX, color: 'text-amber-600 bg-amber-50',
    build: (c) => p(c, {
      name: 'افتقاد بعد الغياب', trigger: 'absent', trigger_config: { consecutive: 1 },
      audience: 'children', kind: 'reminder', channels: ['in_app', 'whatsapp'], cooldown_hours: 24,
      title: 'وحشتنا يا [الاسم الأول]',
      body: 'افتقدناك اليوم في [اسم الخدمة] يا [الاسم الأول]. نتمنى أن تكون بخير، ومنتظرينك الأسبوع القادم ❤️',
    }),
  },
  {
    key: 'absent3', title: 'تنبيه الخدام بغياب متكرر', desc: 'إشعار للخدام عند غياب المخدوم 3 مرات متتالية.',
    icon: Siren, color: 'text-red-600 bg-red-50',
    build: (c) => p(c, {
      name: 'غياب 3 مرات متتالية', trigger: 'absent', trigger_config: { consecutive: 3 },
      audience: 'servants', kind: 'alert', cooldown_hours: 24 * 7, link: '/attendance',
      title: 'غياب متكرر: [الاسم الكامل]',
      body: 'المخدوم [الاسم الكامل] من فصل [اسم الفصل] غاب 3 مرات متتالية. آخر حضور: [آخر حضور]. يُرجى الافتقاد والتواصل مع الأسرة.',
    }),
  },
  {
    key: 'welcome', title: 'ترحيب بالمخدوم الجديد', desc: 'رسالة ترحيب عند تسجيل مخدوم جديد في الفصل.',
    icon: UserPlus, color: 'text-emerald-600 bg-emerald-50',
    build: (c) => p(c, {
      name: 'ترحيب بالمنضمين الجدد', trigger: 'new_enrollment', trigger_config: {},
      audience: 'children', kind: 'celebration',
      title: 'أهلاً بك يا [الاسم الأول] 👋',
      body: 'نورت خدمة [اسم الخدمة] يا [الاسم الأول]! سعداء جداً بانضمامك لفصل [اسم الفصل]. منتظرينك دائماً 😊',
    }),
  },
  {
    key: 'reminder', title: 'تذكير أسبوعي قبل الخدمة', desc: 'تذكير أسبوعي للمخدومين في يوم محدد.',
    icon: AlarmClock, color: 'text-sky-600 bg-sky-50',
    build: (c) => p(c, {
      name: 'تذكير بموعد الخدمة', trigger: 'schedule', trigger_config: { at: '18:00', repeat: 'weekly', weekdays: [5] },
      audience: 'children', kind: 'reminder',
      title: 'تذكير: الخدمة غداً',
      body: 'نذكرك يا [الاسم الأول] بموعد خدمة [اسم الخدمة] غداً. منتظرينك 😊',
    }),
  },
  {
    key: 'milestone', title: 'تهنئة عند الوصول لنقاط', desc: 'رسالة تشجيع عند تجاوز المخدوم حدّاً من النقاط.',
    icon: Star, color: 'text-yellow-600 bg-yellow-50',
    build: (c) => p(c, {
      name: 'تهنئة بالنقاط', trigger: 'points', trigger_config: { direction: 'add', milestone: 100 },
      audience: 'children', kind: 'celebration', link: '/child/points',
      title: 'مبروك يا [الاسم الأول] ⭐',
      body: 'وصلت إلى [النقاط] نقطة! استمر في التميز يا [الاسم الأول] 👏',
    }),
  },
  {
    key: 'inactive', title: 'افتقاد المنقطعين', desc: 'تنبيه للخدام بالمخدومين الذين لم يحضروا منذ 30 يوماً.',
    icon: Moon, color: 'text-indigo-600 bg-indigo-50',
    build: (c) => p(c, {
      name: 'افتقاد المنقطعين', trigger: 'inactive', trigger_config: { at: '10:00', days: 30 },
      audience: 'servants', kind: 'warning', cooldown_hours: 24 * 14, link: '/attendance',
      title: 'منقطع منذ فترة: [الاسم الكامل]',
      body: 'المخدوم [الاسم الكامل] من فصل [اسم الفصل] لم يحضر منذ [أيام الغياب] يوماً. آخر حضور: [آخر حضور].',
    }),
  },
  {
    key: 'exam', title: 'إعلان نتيجة الاختبار', desc: 'إشعار للمخدوم عند تصحيح اختباره.',
    icon: GraduationCap, color: 'text-violet-600 bg-violet-50',
    build: (c) => p(c, {
      name: 'نتيجة الاختبار', trigger: 'exam_result', trigger_config: { only: 'any' },
      audience: 'children', kind: 'info', link: '/child/exams',
      title: 'نتيجتك في الاختبار جاهزة',
      body: 'يا [الاسم الأول]، تم تصحيح اختبارك. افتح التطبيق لمعرفة نتيجتك 👏',
    }),
  },
  {
    key: 'order', title: 'تحديث طلب المتجر', desc: 'إشعار للمخدوم عند تغيير حالة طلبه في المتجر.',
    icon: ShoppingBag, color: 'text-orange-600 bg-orange-50',
    build: (c) => p(c, {
      name: 'تحديث طلب المتجر', trigger: 'store_order', trigger_config: { only: 'any' },
      audience: 'children', kind: 'success', link: '/child/store',
      title: 'تحديث على طلبك',
      body: 'يا [الاسم الأول]، تم تحديث حالة طلبك في متجر النقاط. افتح التطبيق لمعرفة التفاصيل 🛍️',
    }),
  },
  {
    key: 'weekly', title: 'ملخص أسبوعي للخدام', desc: 'رسالة أسبوعية للخدام لمراجعة حضور الفصل.',
    icon: CalendarClock, color: 'text-teal-600 bg-teal-50',
    build: (c) => p(c, {
      name: 'الملخص الأسبوعي', trigger: 'schedule', trigger_config: { at: '20:00', repeat: 'weekly', weekdays: [6] },
      audience: 'servants', kind: 'info', link: '/attendance',
      title: 'مراجعة الأسبوع',
      body: 'أسبوع مبارك يا [الاسم الأول]! لا تنسَ مراجعة حضور فصلك وافتقاد الغائبين هذا الأسبوع 🙏',
    }),
  },
]
