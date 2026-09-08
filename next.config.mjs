/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Serve photos straight from Supabase Storage instead of routing them
    // through Vercel's /_next/image optimizer:
    //  • every child photo is a distinct "source image" — the Hobby plan
    //    quota (1000/month) is exhausted quickly and the optimizer then
    //    answers with errors, so pictures vanished (first noticed on phones,
    //    where nothing was cached);
    //  • the app already uploads compressed 512px WebP (PhotoCropModal /
    //    compressImage), so there is nothing left to optimize.
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.supabase.in' },
    ],
  },
};

export default nextConfig;
