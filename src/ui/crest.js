// Team crests: small original SVG badges (shield + emblem) in each team's colours.
// Used by the score bug, lower-thirds, line-ups and full-time stats.

const EMBLEM = {
  // a crown over cage bars
  cage: c => `<path d="M30 30 l6-9 6 7 6-7 6 9 z" fill="${c.trim}" stroke="#000" stroke-width="1.2"/>
    ${[36, 42, 48].map(x => `<rect x="${x - 1.2}" y="33" width="2.4" height="17" fill="${c.trim}"/>`).join('')}
    <rect x="31" y="33" width="22" height="2.4" fill="${c.trim}"/><rect x="31" y="47.6" width="22" height="2.4" fill="${c.trim}"/>`,
  // a rooftop skyline with a water tank
  rooftop: c => `<path d="M26 50 v-10 h5 v-6 h6 v9 h4 v-14 h6 v11 h5 v-4 h6 v14 z" fill="${c.trim}"/>
    <rect x="49" y="25" width="7" height="6" rx="1" fill="${c.trim}"/><path d="M50 31 l-1 5 M55 31 l1 5" stroke="${c.trim}" stroke-width="1.4"/>`,
  // a lightning bolt
  neon: c => `<path d="M46 20 L33 40 h8 l-4 16 L51 34 h-8 l5-14 z" fill="${c.trim}" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>`,
  // an anchor
  harbour: c => `<circle cx="42" cy="25" r="3.6" fill="none" stroke="${c.trim}" stroke-width="2.6"/>
    <path d="M42 29 v24 M34 34 h16 M29 43 q3 11 13 10 q10 1 13 -10" fill="none" stroke="${c.trim}" stroke-width="3" stroke-linecap="round"/>`,
};

// def: a TEAMS entry. size in px.
export function crest(def, size = 28) {
  const k = def.kit;
  const em = (EMBLEM[def.id] || EMBLEM.cage)(k);
  return `<svg class="crest" width="${size}" height="${Math.round(size * 1.16)}" viewBox="0 0 84 98" aria-label="${def.name} crest">
    <path d="M42 3 L78 13 V47 C78 71 62 86 42 95 C22 86 6 71 6 47 V13 Z" fill="#0d0f14" stroke="${k.trim}" stroke-width="4"/>
    <path d="M42 11 L71 19 V47 C71 66 58 78 42 86 C26 78 13 66 13 47 V19 Z" fill="${k.shirt}"/>
    <path d="M13 58 H71 C69 64 66 69 62 73 H22 C18 69 15 64 13 58 Z" fill="rgba(0,0,0,.28)"/>
    <text x="42" y="70" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="11" fill="#fff" letter-spacing="1">${def.short}</text>
    <g transform="translate(0,0)">${em}</g>
  </svg>`;
}
