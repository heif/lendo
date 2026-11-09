// Seed a showcase city with demo users, listings and past rentals (demo=1). Prints SQL; pipe into wrangler d1 execute.
// Usage: node scripts/seed-demo.mjs > /tmp/seed.sql && npx wrangler d1 execute lendo --remote --file /tmp/seed.sql
// Listings reuse the generated wanted-catalog stickers (wanted/<key>.png) as avatars so pins look real on the map.
import { readFileSync } from 'node:fs';

const CITY = 'Iowa City';
const ICON_KEYS = JSON.parse(process.env.ICON_KEYS || '[]'); // keys that already have a sticker in R2
const src = readFileSync(new URL('../src/lib/places.ts', import.meta.url), 'utf8');
const cityBlock = src.slice(src.indexOf("id: 'iac'"), src.indexOf("id: 'chi'"));
const HOODS = [...cityBlock.matchAll(/\['([^']+)', ([\d.]+), (-?[\d.]+)\]/g)].map(m => ({ name: m[1], lat: +m[2], lng: +m[3] }));
const CAT = [...src.matchAll(/\['(\w+)', '([^']+)', '([^']+)'\]/g)].map(m => ({ key: m[1], label: m[2], emoji: m[3] }));

// deterministic PRNG so re-runs produce the same ids (idempotent via INSERT OR IGNORE)
const OFF = parseInt(process.env.OFFSET || '0', 10), NL = parseInt(process.env.NL || '480', 10), NU_NEW = parseInt(process.env.NU || '120', 10), U_OFF = parseInt(process.env.UOFFSET || '0', 10);
let seed = 20261109 + OFF; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const idOf = (p, n) => `${p}_demo${String(n).padStart(4, '0')}`;

const FIRST = ['Maya', 'Jordan', 'Priya', 'Luis', 'Hannah', 'Theo', 'Grace', 'Omar', 'Elena', 'Marcus', 'Nora', 'Caleb', 'Ava', 'Diego', 'Ruth', 'Sam', 'Leah', 'Ben', 'Zoe', 'Isaac', 'Fatima', 'Owen', 'Mei', 'Eli', 'Sofia', 'Noah', 'Ines', 'Kai', 'Amara', 'Jonah', 'Tess', 'Ravi', 'Clara', 'Max', 'Nadia', 'Will', 'Iris', 'Hugo', 'Lena', 'Amir', 'June', 'Felix', 'Rosa', 'Jack', 'Yara', 'Liam', 'Esme', 'Tomas', 'Ada', 'Nico'];
const LAST = 'A B C D E F G H J K L M N O P R S T V W'.split(' ');
const STREETS = ['Dubuque', 'Linn', 'Gilbert', 'Clinton', 'Market', 'Jefferson', 'Bloomington', 'Davenport', 'Church', 'Fairchild', 'Burlington', 'College', 'Washington', 'Iowa Ave', 'Summit', 'Governor', 'Lucas', 'Dodge', 'Johnson', 'Van Buren', 'Muscatine', 'Court', 'Bowery', 'Sheridan', 'Kirkwood', 'Rochester', 'Melrose', 'Riverside', 'Benton', 'Grand', 'Park Rd', 'River St', 'Ferson', 'Lexington', 'Woolf'];
const SPOTS = ['Prairie Lights (bookstore)', 'the Ped Mall fountain', 'Java House on Washington', 'the Northside Marketplace', 'Hy-Vee lot on Dodge', 'Hickory Hill Park entrance', 'the Old Capitol steps', 'College Green Park', 'the Englert marquee', 'the Farmers Market ramp', 'Dey House', 'High Ground Cafe', 'the library (ICPL)', 'Mercer Park', 'Hamburg Inn'];
const NOTES = {
  default: ['Works great. Text me when you’re close.', 'Barely used. Pickup is easy.', 'Clean and ready to go.', 'Happy to show you how it works.', 'Bring it back when you said you would and we’re good.', 'Great for a weekend. I’ll include the extras.'],
};
const PRICE = { projector: 18, laptop: 25, monitor: 12, printer: 30, camera: 25, camcorder: 20, drone: 35, tv: 15, console: 15, speaker: 14, mic: 10, dj: 12, disco: 10, radio: 9, guitar: 12, piano: 18, violin: 15, drums: 25, sax: 20, trumpet: 14, banjo: 12, accordion: 15, bike: 20, escooter: 18, skateboard: 9, rollerskates: 10, moped: 45, car: 60, van: 80, truck: 70, kayak: 30, sailboat: 90, surf: 20, wheelchair: 12, crutch: 8, skis: 25, snowboard: 25, skates: 10, sled: 8, tent: 15, umbrella: 8, telescope: 20, microscope: 15, fishing: 10, bow: 15, kite: 8, scuba: 12, parachute: 60, pickle: 9, racket: 8, hockey: 8, lacrosse: 8, cricket: 8, boxing: 8, goal: 12, ladder: 9, saw: 12, axe: 8, toolbox: 10, hammer: 8, chair: 10, luggage: 10, backpack: 9, gown: 25, jacket: 12, heels: 10, boots: 10, tophat: 8, vr: 20, clapper: 8, battery: 15 };
const usable = CAT.filter(c => ICON_KEYS.includes(c.key));
const out = [];
const now = Date.now(), DAY = 86400000;

// users
const NU = U_OFF + NU_NEW;
for (let i = U_OFF; i < NU; i++) {
  const h = pick(HOODS); const lat = h.lat + (rnd() - .5) * 0.008, lng = h.lng + (rnd() - .5) * 0.011;
  const name = `${pick(FIRST)} ${pick(LAST)}.`; const xs = `${pick(STREETS)} & ${pick(STREETS)}`;
  const spots = JSON.stringify([pick(SPOTS)]);
  out.push(`INSERT OR IGNORE INTO users (id, phone, name, hood, cross_streets, lat, lng, pickup_spots, created_at, replied, demo) VALUES (${q(idOf('u', i))}, ${q('+1319555' + String(1000 + i))}, ${q(name)}, ${q(h.name)}, ${q(xs)}, ${lat.toFixed(5)}, ${lng.toFixed(5)}, ${q(spots)}, ${now - rint(5, 300) * DAY}, 1, 1);`);
}
// listings: ~4 per user, biased to a few power-listers
const listings = [];
for (let i = OFF; i < OFF + NL; i++) {
  const ui = rnd() < .3 ? rint(0, 14) : rint(0, NU - 1);
  const c = pick(usable); const h = pick(HOODS);
  const lat = Math.min(41.715, Math.max(41.605, h.lat + (rnd() - .5) * 0.0075)), lng = Math.min(-91.465, Math.max(-91.655, h.lng + (rnd() - .5) * 0.0105));
  const base = PRICE[c.key] || 12; const price = Math.max(8, Math.round(base * (0.8 + rnd() * 0.5))) * 100; const week = Math.round(price * 7 * 0.7 / 100) * 100;
  const label = c.label.charAt(0).toUpperCase() + c.label.slice(1);
  const L = { id: idOf('l', i), owner: idOf('u', ui), price, created: now - rint(0, 240) * DAY }; listings.push(L);
  out.push(`INSERT OR IGNORE INTO listings (id, owner_id, name, description, price_cents, week_cents, status, hood, lat, lng, emoji, avatar_key, avatar_style, created_at, demo) VALUES (${q(L.id)}, ${q(L.owner)}, ${q(label)}, ${q(pick(NOTES.default))}, ${price}, ${week}, 'live', ${q(h.name)}, ${lat.toFixed(5)}, ${lng.toFixed(5)}, ${q(c.emoji)}, ${q('wanted/' + c.key + '.png')}, 'ai', ${L.created}, 1);`);
}
// past rentals with ratings → owners show "N rentals · 4.9★"
const REV = ['Right on time, easy handoff.', 'Showed me how it works. Really helpful.', 'Clean, exactly as described.', 'Met me at the Ped Mall, super chill.', 'Would rent again.', 'Great neighbor.', 'Flexible on the return time, thanks!', 'Perfect for the weekend.'];
let rn = OFF * 3;
for (const l of listings) {
  const k = rnd() < .55 ? rint(1, 6) : 0;
  for (let j = 0; j < k; j++) {
    let renter = idOf('u', rint(0, NU - 1)); if (renter === l.owner) renter = idOf('u', (parseInt(l.owner.slice(-4)) + 1) % NU);
    const days = rnd() < .7 ? rint(1, 3) : 7; const start = now - rint(2, 200) * DAY; const sd = new Date(start).toISOString().slice(0, 10), ed = new Date(start + (days - 1) * DAY).toISOString().slice(0, 10);
    const rent = days === 7 ? Math.round(l.price * 7 * 0.7) : l.price * days; const fee = Math.round(rent * 0.15);
    const rr = rnd() < .85 ? 5 : 4, orr = rnd() < .9 ? 5 : 4;
    out.push(`INSERT OR IGNORE INTO rentals (id, listing_id, owner_id, renter_id, start_day, end_day, days, rent_cents, fee_cents, total_cents, status, paid_out, renter_rating, renter_review, owner_rating, created_at, updated_at) VALUES (${q(idOf('r', rn++))}, ${q(l.id)}, ${q(l.owner)}, ${q(renter)}, ${q(sd)}, ${q(ed)}, ${days}, ${rent}, ${fee}, ${rent + fee}, 'closed', 1, ${rr}, ${q(pick(REV))}, ${orr}, ${start}, ${start + days * DAY});`);
  }
}
console.log(out.join('\n'));
console.error(`users ${NU}, listings ${NL} (from ${usable.length} icon kinds), rentals ${rn}`);
