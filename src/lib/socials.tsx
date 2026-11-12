// Instagram / X / LinkedIn on the profile: stored as bare handles, shown as icons
export const SOCIALS = [
  { k: 'ig', label: 'Instagram', pre: 'instagram.com/', url: (h: string) => `https://instagram.com/${h}`, re: /(?:instagram\.com\/)?@?([a-z0-9._]{1,30})\/?$/i,
    svg: <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="#1E3A2B" stroke-width="2" /><circle cx="12" cy="12" r="4.2" fill="none" stroke="#1E3A2B" stroke-width="2" /><circle cx="17.3" cy="6.7" r="1.3" fill="#1E3A2B" /></svg> },
  { k: 'x', label: 'X', pre: 'x.com/', url: (h: string) => `https://x.com/${h}`, re: /(?:(?:x|twitter)\.com\/)?@?([a-z0-9_]{1,15})\/?$/i,
    svg: <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h4.6l4.2 5.9L18 3h2.4l-6.5 7.5L21 21h-4.6l-4.6-6.4L6.2 21H3.8l7-8z" fill="#1E3A2B" /></svg> },
  { k: 'linkedin', label: 'LinkedIn', pre: 'linkedin.com/in/', url: (h: string) => `https://www.linkedin.com/in/${h}`, re: /(?:linkedin\.com\/in\/)?@?([a-z0-9-]{3,100})\/?$/i,
    svg: <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" fill="#1E3A2B" /><rect x="6.5" y="10" width="2.6" height="7.5" fill="#fff" /><circle cx="7.8" cy="7.2" r="1.5" fill="#fff" /><path d="M11.3 10h2.5v1.1c.5-.8 1.4-1.3 2.6-1.3 2 0 3 1.2 3 3.6v4.1h-2.6v-3.7c0-1.1-.4-1.7-1.3-1.7s-1.6.6-1.6 1.8v3.6h-2.6z" fill="#fff" /></svg> },
] as const;

// "https://instagram.com/scott/" or "@scott" → "scott"; junk → null
export function socialHandle(k: string, raw: unknown): string | null {
  const s = SOCIALS.find(x => x.k === k); const v = String(raw || '').trim().replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '');
  if (!s || !v) return null;
  const m = v.match(s.re); return m ? m[1] : null;
}

export const SocialIcons = (p: { u: { ig?: string | null; x?: string | null; linkedin?: string | null } }) => {
  const has = SOCIALS.filter(s => (p.u as any)[s.k]);
  return has.length ? <div class="pf-soc">{has.map(s => <a href={s.url((p.u as any)[s.k])} target="_blank" rel="noopener nofollow" aria-label={s.label}>{s.svg}</a>)}</div> : null;
};
