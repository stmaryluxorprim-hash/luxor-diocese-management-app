// Web App Manifest — generated at build time from the branding environment
// variables (see src/lib/branding.ts). Served at /manifest.webmanifest.
import type { MetadataRoute } from 'next';
import { BRANDING, appIcon } from '@/lib/branding';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRANDING.appName,
    short_name: BRANDING.shortName,
    description: BRANDING.description,
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    dir: 'rtl',
    lang: 'ar',
    background_color: BRANDING.backgroundColor,
    theme_color: BRANDING.themeColor,
    icons: [
      { src: appIcon(96), sizes: '96x96', type: 'image/png', purpose: 'any' },
      { src: appIcon(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: appIcon(192), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: appIcon(512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: appIcon(512), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
