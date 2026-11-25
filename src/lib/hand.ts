// The Lendo hand: one jointed outline hand (ink line, cream fill only to hide overlaps, thumb on the right).
// Source: "Personality B" artboard (Lendo hand logo design). Gestures are CSS classes in public/app.css (.lh.g31/.g1/.g10/.g15/.g19);
// public/hand.js plays them (one at a time, twice with a pause, never in a loop, none under reduce motion).
// L pose (index up, thumb out = the logo's L) is baked into SVG attributes, so a still hand, a canvas copy or a
// reduce-motion page all show the L without any CSS.

const INK = '#1E3A2B', BG = '#F5F3EE';
/* line weight in drawing units (viewBox 128×150): 7 ≈ 2px at the header's ~44px, ≈2.2px at 48px */
const SW = 7;
const R = (x: number, y: number, w: number, h: number, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${BG}" stroke="${INK}" stroke-width="${SW}"${extra}/>`;
const curl = (ox: number, oy: number) => ` transform="translate(${ox} ${oy}) scale(1 .3) translate(${-ox} ${-oy})"`;

/** Inner SVG of the hand. L = fingers curled + thumb out (the logo pose); otherwise an open palm. */
export function handInner(L: boolean): string {
  return `<g transform="translate(130 0) scale(-1 1)"><g class="hd">`
    + `<path d="M38 60 C36 78 39 98 46 112 L47 140" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linecap="round"/>`
    + `<g class="th"${L ? ' transform="rotate(-38 44 94)"' : ''}>${R(-7.5, -40, 15, 46, ' transform="translate(44 94) rotate(-52)"')}</g>`
    + `<g class="ix">${R(38, 17, 13.5, 52)}</g>`
    + `<g class="rg"${L ? curl(72.5, 64) : ''}>${R(66, 14, 13, 52)}</g>`
    + `<g class="pk"${L ? curl(84.5, 66) : ''}>${R(79, 30, 11.5, 40, ' transform="rotate(9 84.5 66)"')}</g>`
    + `<g class="md"${L ? curl(58.75, 64) : ''}>${R(52, 8, 13.5, 58)}</g>`
    + `<path d="M39.7 60 L91 60 C92 78 90 98 84 110 L83 140 L48.6 140 L47.6 112 C40.7 98 37.7 78 39.7 60 Z" fill="${BG}"/>`
    + `<path d="M91 60 C92 78 90 98 84 110 L83 140" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linecap="round"/>`
    + `</g></g>`;
}

export type Gesture = 'g31' | 'g1' | 'g10' | 'g15' | 'g19' | '';

/** A hand as HTML. `g` = gesture class to play at once ('' = still); `play` = gesture hand.js plays after the logo is done. `L` = logo pose at rest. `px` = height. */
export function hand(opt: { g?: Gesture; L?: boolean; px?: number; cls?: string; play?: Gesture } = {}): string {
  const px = opt.px || 48, w = Math.round(px * 128 / 150);
  return `<span class="lh${opt.g ? ' ' + opt.g : ''}${opt.cls ? ' ' + opt.cls : ''}" aria-hidden="true"${opt.play ? ` data-play="${opt.play}"` : ''}>`
    + `<svg viewBox="0 0 128 150" width="${w}" height="${px}" style="overflow:visible">${handInner(!!opt.L)}</svg></span>`;
}
