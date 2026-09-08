import type { LucideIcon } from 'lucide-react'
import {
  Cake, UserX, Siren, UserPlus, AlarmClock, Star, Moon, GraduationCap, CalendarClock,
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

const base = (churchId: string | null): AutomationInput => ({
  name: '',
  description: null,
  is_active: true,
  trigger: 'birthday',
  trigger_config: {},
  audience: 'children',
  audience_filter: {},
  church_id: churchId,
  service_id: null,
  class_id: null,
  channels: ['in_app'],
  title_template: '',
  body_template: '',
  notification_kind: 'info',
  send_time: '09:00',
  cooldown_hours: 24,
  respect_quiet_hours: true,
})

export const AUTOMATION_PRESETS: AutomationPreset[] = [
  {
    key: 'birthday',
    title: 'تهنئة عيد ميلاد المخدومين',
    desc: 'رسالة تلقائية لكل مخدوم في يوم عيد ميلاده.',
    icon: Cake,
    color: 'text-pink-600 bg-pink-50',
    build: (c) => ({
      ...base(c),
      name: 'تهنئة عيد ميلاد',
      trigger: 'birthday',
      trigger_config: { days_before: 0 },
      audience: 'children',
      notification_kind: 'celebration',
      channels: ['in_app', 'whatsapp'],
      title_template: 'كل سنة وأنت طيب يا [الاسم] 🎂',
      body_template: 'كل سنة وأنت طيب يا [الاسم]! أسرة خدمة [الخدمة] بكنيسة [الكنيسة] تهنئك بعيد ميلادك وتتمنى لك سنة مليئة بالبركة والفرح 🎉',
    }),
  },
  {
    key: 'birthday_staff',
    title: 'تنبيه الخدام بأعياد ميلاد الغد',
    desc: 'إشعار للخدام قبل عيد ميلاد المخدوم بيوم.',
    icon: Cake,
    color: 'text-rose-600 bg-rose-50',
    build: (c) => ({
      ...base(c),
      name: 'أعياد ميلاد الغد',
      trigger: 'birthday',
      trigger_config: { days_before: 1 },
      audience: 'servants',
      notification_kind: 'reminder',
      title_template: 'عيد ميلاد [الاسم] غداً',
      body_template: 'غداً عيد ميلاد المخدوم [الاسم] من فصل [الفصل] — لا تنسَ التهنئة 🎂',
    }),
  },
  {
    key: 'absent',
    title: 'رسالة بعد الغياب',
    desc: 'تصل للمخدوم عند تسجيل غياب مرة واحدة.',
    icon: UserX,
    color: 'text-amber-600 bg-amber-50',
    build: (c) => ({
      ...base(c),
      name: 'افتقاد بعد الغياب',
      trigger: 'absence',
      trigger_config: { consecutive: 1 },
      audience: 'children',
      notification_kind: 'care',
      channels: ['in_app', 'whatsapp'],
      title_template: 'وحشتنا يا [الاسم]',
      body_template: 'افتقدناك اليوم في [الخدمة] يا [الاسم]. نتمنى أن تكون بخير، ومنتظرينك الأسبوع القادم ❤️',
    }),
  },
  {
    key: 'absent3',
    title: 'تنبيه الخدام بغياب متكرر',
    desc: 'إشعار للخدام عند غياب المخدوم 3 مرات متتالية.',
    icon: Siren,
    color: 'text-red-600 bg-red-50',
    build: (c) => ({
      ...base(c),
      name: 'غياب 3 مرات متتالية',
      trigger: 'absence',
      trigger_config: { consecutive: 3 },
      audience: 'servants',
      notification_kind: 'alert',
      title_template: 'غياب متكرر: [الاسم]',
      body_template: 'المخدوم [الاسم] من فصل [الفصل] غاب [عدد_الغياب] مرات متتالية. يُرجى الافتقاد والتواصل مع الأسرة.',
    }),
  },
  {
    key: 'welcome',
    title: 'ترحيب بالمخدوم الجديد',
    desc: 'رسالة ترحيب عند تسجيل مخدوم جديد في الفصل.',
    icon: UserPlus,
    color: 'text-emerald-600 bg-emerald-50',
    build: (c) => ({
      ...base(c),
      name: 'ترحيب بالمنضمين الجدد',
      trigger: 'enrollment',
      trigger_config: {},
      audience: 'children',
      notification_kind: 'celebration',
      title_template: 'أهلاً بك يا [الاسم] 👋',
      body_template: 'نورت خدمة [الخدمة] يا [الاسم]! سعداء جداً بانضمامك لفصل [الفصل]. نلتقي كل [يوم_الخدمة] بإذن الله.',
    }),
  },
  {
    key: 'reminder',
    title: 'تذكير قبل الخدمة',
    desc: 'تذكير أسبوعي للمخدومين قبل موعد الخدمة.',
    icon: AlarmClock,
    color: 'text-sky-600 bg-sky-50',
    build: (c) => ({
      ...base(c),
      name: 'تذكير بموعد الخدمة',
      trigger: 'weekly',
      trigger_config: { weekday: 5 },
      audience: 'children',
      notification_kind: 'reminder',
      send_time: '18:00',
      title_template: 'تذكير: الخدمة غداً',
      body_template: 'نذكرك يا [الاسم] بموعد خدمة [الخدمة] غداً. منتظرينك 😊',
    }),
  },
  {
    key: 'milestone',
    title: 'تهنئة عند الوصول لنقاط',
    desc: 'رسالة تشجيع عند تجاوز المخدوم حدّاً من النقاط.',
    icon: Star,
    color: 'text-yellow-600 bg-yellow-50',
    build: (c) => ({
      ...base(c),
      name: 'تهنئة بالنقاط',
      trigger: 'points_milestone',
      trigger_config: { threshold: 100 },
      audience: 'children',
      notification_kind: 'celebration',
      title_template: 'مبروك يا [الاسم] ⭐',
      body_template: 'وصلت إلى [النقاط] نقطة! استمر في التميز يا [الاسم] 👏',
    }),
  },
  {
    key: 'inactive',
    title: 'افتقاد الغائبين لفترة طويلة',
    desc: 'تنبيه للخدام بالمخدومين الذين لم يحضروا منذ 30 يوماً.',
    icon: Moon,
    color: 'text-indigo-600 bg-indigo-50',
    build: (c) => ({
      ...base(c),
      name: 'افتقاد المنقطعين',
      trigger: 'inactivity',
      trigger_config: { days: 30 },
      audience: 'servants',
      notification_kind: 'care',
      cooldown_hours: 24 * 14,
      title_template: 'منقطع منذ فترة: [الاسم]',
      body_template: 'المخدوم [الاسم] من فصل [الفصل] لم يحضر منذ [أيام_منذ_الحضور] يوماً. آخر حضور: [آخر_حضور].',
    }),
  },
  {
    key: 'exam',
    title: 'إعلان نتيجة الاختبار',
    desc: 'إشعار للمخدوم عند تصحيح اختباره.',
    icon: GraduationCap,
    color: 'text-violet-600 bg-violet-50',
    build: (c) => ({
      ...base(c),
      name: 'نتيجة الاختبار',
      trigger: 'exam_result',
      trigger_config: {},
      audience: 'children',
      notification_kind: 'info',
      title_template: 'نتيجتك في [الاختبار]',
      body_template: 'يا [الاسم]، حصلت على [الدرجة] في اختبار [الاختبار]. أحسنت 👏',
    }),
  },
  {
    key: 'weekly',
    title: 'ملخص أسبوعي للخدام',
    desc: 'تقرير أسبوعي بالحضور والغياب في الفصل.',
    icon: CalendarClock,
    color: 'text-teal-600 bg-teal-50',
    build: (c) => ({
      ...base(c),
      name: 'الملخص الأسبوعي',
      trigger: 'weekly',
      trigger_config: { weekday: 6 },
      audience: 'servants',
      notification_kind: 'info',
      send_time: '20:00',
      title_template: 'ملخص الأسبوع',
      body_template: 'أسبوع مبارك! لا تنسَ مراجعة حضور فصلك وافتقاد الغائبين هذا الأسبوع 🙏',
    }),
  },
]

export function emptyAutomation(churchId: string | null): AutomationInput {
  return base(churchId)
}
