// Branding — everything that identifies *this* deployment of the PWA.
//
// All values come from environment variables so one codebase can be deployed
// for many dioceses from Vercel without touching the source: set them in
// Vercel → Project → Settings → Environment Variables and redeploy
// (NEXT_PUBLIC_* variables are inlined at build time).
//
//   NEXT_PUBLIC_APP_NAME          full app name  (manifest `name`, <title>)
//   NEXT_PUBLIC_APP_SHORT_NAME    home-screen label (manifest `short_name`, iOS title)
//   NEXT_PUBLIC_APP_DESCRIPTION   manifest / meta description
//   NEXT_PUBLIC_APP_ICON_URL      square PNG/JPG/WebP/SVG (≥ 512px) used for the
//                                 PWA icons, favicon, apple-touch-icon and push
//                                 notifications. Served resized through
//                                 /branding/icon/{96|180|192|512}.
//   NEXT_PUBLIC_DIOCESE_NAME      diocese name — header fallback (before a church
//                                 is resolved) and the login / signup pages.
//   NEXT_PUBLIC_DIOCESE_LOGO_URL  diocese logo — same places. Falls back to the
//                                 app icon when unset. Served through
//                                 /branding/logo/{size}.
//   NEXT_PUBLIC_THEME_COLOR       manifest theme colour / browser UI (default #1e3a8a)
//   NEXT_PUBLIC_BACKGROUND_COLOR  manifest splash background (default #fdf8ee)
//
// Icons: when NEXT_PUBLIC_APP_ICON_URL is unset the bundled files in
// /public/icons are used, so a deployment with no variables behaves exactly
// as before.

const env = (v: string | undefined, fallback: string): string => {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : fallback;
};

export const ICON_SIZES = [96, 180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export const BRANDING = {
  appName: env(process.env.NEXT_PUBLIC_APP_NAME, 'مطرانية الأقباط الأرثوذكس — إيبارشية الأقصر وتوابعها'),
  shortName: env(process.env.NEXT_PUBLIC_APP_SHORT_NAME, 'الإيبارشية'),
  description: env(process.env.NEXT_PUBLIC_APP_DESCRIPTION, 'تطبيق إدارة كنائس وخدمات إيبارشية الأقصر وتوابعها'),
  /** Remote source of the app icon (empty → bundled /public/icons). */
  appIconUrl: env(process.env.NEXT_PUBLIC_APP_ICON_URL, ''),
  dioceseName: env(process.env.NEXT_PUBLIC_DIOCESE_NAME, 'إيبارشية الأقصر وتوابعها'),
  /** Remote source of the diocese logo (empty → app icon). */
  dioceseLogoUrl: env(process.env.NEXT_PUBLIC_DIOCESE_LOGO_URL, ''),
  themeColor: env(process.env.NEXT_PUBLIC_THEME_COLOR, '#1e3a8a'),
  backgroundColor: env(process.env.NEXT_PUBLIC_BACKGROUND_COLOR, '#fdf8ee'),
} as const;

/**
 * Short fingerprint of the branding values. Appended to the service-worker
 * URL so that changing any variable in Vercel makes browsers install a fresh
 * worker (and drop the cached icons / offline page of the old brand).
 */
export const BRANDING_VERSION: string = (() => {
  const s = Object.values(BRANDING).join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
})();

/**
 * Every branded URL carries `?v=<BRANDING_VERSION>`. The value is ignored by
 * the routes, but it makes the URL — and therefore every cache key (browser
 * HTTP cache, Vercel CDN, service-worker cache, cached manifest) — change the
 * moment a branding variable changes. Without it a phone that visited the
 * production domain once keeps showing the previous icon for hours or days.
 */
const versioned = (path: string): string => `${path}?v=${BRANDING_VERSION}`;

/** Same-origin URL of the app icon at a given size (resized server-side). */
export const appIcon = (size: IconSize = 192): string => versioned(`/branding/icon/${size}`);

/** Same-origin URL of the diocese logo at a given size (falls back to the app icon). */
export const dioceseLogo = (size: IconSize = 192): string => versioned(`/branding/logo/${size}`);

/** Manifest URL, versioned for the same reason (browsers cache manifests hard). */
export const manifestUrl = (): string => versioned('/branding/manifest');

/** Bundled fallback used when no icon URL is configured or the remote fetch fails. */
export const bundledIcon = (size: IconSize): string =>
  size === 180 ? '/icons/apple-touch-icon.png' : `/icons/icon-${size}.png`;
