import type { Env } from './env';
// Item photo with the background removed (Cloudflare Images segment=foreground) on a white canvas. Falls back to the
// plain photo off-zone (workers.dev / localhost), where /cdn-cgi/image is not available.
export function cutoutUrl(env: Env, key: string, w = 800, h = 800): string {
  if (!env.APP_URL.includes('lendo.co')) return `/p/${key}`;
  return `${env.APP_URL}/cdn-cgi/image/segment=foreground,background=white,fit=contain,width=${w},height=${h},trim=auto,format=auto/${env.APP_URL}/p/${key}`;
}
// Small sticker/avatar for lists: the generated avatar if we have one, else a cutout of the first photo.
export function avatarUrl(env: Env, avatarKey: string | null, photoKey: string | null, size = 144): string | null {
  if (avatarKey) return env.APP_URL.includes('lendo.co') ? `${env.APP_URL}/cdn-cgi/image/width=${size},height=${size},fit=contain,format=auto/${env.APP_URL}/p/${avatarKey}` : `/p/${avatarKey}`;
  if (photoKey) return cutoutUrl(env, photoKey, size, size);
  return null;
}
