// The Lendo hand: one jointed outline hand (orange line, cream fill only to hide overlaps, thumb on the right).
// It lives in ONE place: next to "Lendo" in the logo. Gestures and number poses play there (public/hand.js, CSS in public/app.css).
// Source: "Personality B" artboard (Lendo hand logo design), wrist shortened.
// hand()      → the live logo hand: poses are CSS classes, rest pose = the L (index up, thumb out).
// handStill() → the same hand frozen in its L with plain SVG attributes, for places with no app.css (flyers, the share picture).

const C = '#FF4F00', BG = '#F5F3EE';
/* line weight in drawing units (viewBox 128×130): 7 ≈ 2.4px at the header's ~44px */
const SW = 7;
const R = (x: number, y: number, w: number, h: number, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${BG}" stroke="${C}" stroke-width="${SW}"${extra}/>`;
const L = (d: string, w = 5) => `<path d="${d}" fill="none" stroke="${C}" stroke-width="${w}" stroke-linecap="round"/>`;
const curl = (ox: number, oy: number) => ` transform="translate(${ox} ${oy}) scale(1 .3) translate(${-ox} ${-oy})"`;

function palm(still: boolean): string {
  return `<g class="side palm" transform="translate(130 0) scale(-1 1)"><g class="hd">`
    + L('M38 60 C36 78 39 98 46 112 L47 124', SW)
    + `<g class="th"${still ? ' transform="rotate(-38 44 94)"' : ''}>${R(-7.5, -40, 15, 46, ' transform="translate(44 94) rotate(-52)"')}</g>`
    + `<g class="ix">${R(38, 17, 13.5, 52)}</g>`
    + `<g class="rg"${still ? curl(72.5, 64) : ''}>${R(66, 14, 13, 52)}</g>`
    + `<g class="pk"${still ? curl(84.5, 66) : ''}>${R(79, 30, 11.5, 40, ' transform="rotate(9 84.5 66)"')}</g>`
    + `<g class="md"${still ? curl(58.75, 64) : ''}>${R(52, 8, 13.5, 58)}</g>`
    + `<path d="M39.7 60 L91 60 C92 78 90 98 84 110 L83 124 L48.6 124 L47.6 112 C40.7 98 37.7 78 39.7 60 Z" fill="${BG}"/>`
    + L('M91 60 C92 78 90 98 84 110 L83 124', SW)
    + (still ? '' : `<g class="sp">${L('M44 34 L38 22')}${L('M65 30 L65 16')}${L('M86 34 L92 22')}</g>`)
    + `</g></g>`;
}
/* the fist seen knuckles-first, for the fist bump (the arm tips toward you, the wrist goes behind the fist) */
function front(): string {
  return `<g class="side front"><g class="hd">`
    + `<rect x="33" y="38" width="64" height="60" rx="21" fill="${BG}" stroke="${C}" stroke-width="${SW}"/>`
    + L('M49 43 V64') + L('M65 42 V64') + L('M81 43 V64') + L('M40 68 H90')
    + `<rect x="52" y="73" width="50" height="19" rx="9.5" fill="${BG}" stroke="${C}" stroke-width="${SW}"/>`
    + `<g class="bm">` + ['M65 22 V6', 'M96 30 L108 18', 'M34 30 L22 18', 'M110 66 H124', 'M20 66 H6', 'M98 104 L109 115', 'M32 104 L21 115'].map(d => L(d, 5.5)).join('') + `</g>`
    + `</g></g>`;
}

/** The live logo hand (needs app.css + hand.js). */
export function hand(): string {
  return `<span class="lh" aria-hidden="true"><svg viewBox="0 0 128 130"><g class="tw">${palm(false)}${front()}</g></svg></span>`;
}
/** The hand frozen in its L, self-contained (no CSS needed). */
export function handStill(px = 20): string {
  return `<span class="lhs" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 130" width="${Math.round(px * 128 / 130)}" height="${px}" style="overflow:visible">${palm(true)}</svg></span>`;
}
