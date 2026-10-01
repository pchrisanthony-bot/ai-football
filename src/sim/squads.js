// =====================================================================
// Clubs and squads. Every club has 16 players; each one has an archetype and the
// positions he can play, best first. buildLineup() fits a squad to any formation by
// role fit (position preference, side, quality) — the same club fields its street
// five in the cage and a full XI on a big pitch.
// =====================================================================
import { ROLES } from './roles.js';
import { formation } from './formations.js';

// 0..1 attributes per archetype (the GDD roadmap).
export const ARCHETYPES = {
  Keeper:    { pace: 0.62, accel: 0.75, control: 0.6,  pass: 0.7,  shot: 0.6,  tackle: 0.5,  skill: 0.3,  strength: 0.8,  keeping: 0.85 },
  Enforcer:  { pace: 0.74, accel: 0.72, control: 0.62, pass: 0.7,  shot: 0.68, tackle: 0.95, skill: 0.4,  strength: 0.95, keeping: 0 },
  Playmaker: { pace: 0.78, accel: 0.82, control: 0.9,  pass: 0.95, shot: 0.72, tackle: 0.6,  skill: 0.78, strength: 0.6,  keeping: 0 },
  Trickster: { pace: 0.82, accel: 0.92, control: 0.95, pass: 0.76, shot: 0.72, tackle: 0.45, skill: 0.98, strength: 0.45, keeping: 0 },
  Speedster: { pace: 0.97, accel: 0.95, control: 0.72, pass: 0.66, shot: 0.72, tackle: 0.5,  skill: 0.72, strength: 0.55, keeping: 0 },
  Finisher:  { pace: 0.84, accel: 0.8,  control: 0.82, pass: 0.7,  shot: 0.97, tackle: 0.5,  skill: 0.7,  strength: 0.75, keeping: 0 },
};

// [name, number, archetype, positions (best first), side ('L'|'R', when the positions
// don't say), quality offset applied to every attribute]. The first five are each
// club's street five (keeper, fixo, left ala, right ala, pivot).
const P = (name, number, arch, pos, side = null, q = 0) => ({ name, number, arch, pos: pos.split(' '), side, q });

export const TEAMS = {
  cage: {
    id: 'cage', name: 'CAGE KINGS', short: 'CGK',
    kit: { shirt: '#1466FF', trim: '#FFD400', shorts: '#0B1F4D', socks: '#FFD400', gk: '#18C27A' },
    squad: [
      P('Okafor', 1, 'Keeper', 'GK'), P('Brandt', 4, 'Enforcer', 'FIXO CB DM'), P('Silva', 7, 'Trickster', 'ALA LW AM LM', 'L'),
      P('Diallo', 11, 'Speedster', 'ALA RW RM ST', 'R'), P('Reyes', 10, 'Finisher', 'PIVO ST CF'),
      P('Haddad', 13, 'Keeper', 'GK', null, -0.06), P('Varga', 5, 'Enforcer', 'CB FIXO', null, -0.02), P('Quinn', 2, 'Speedster', 'RB RWB RM', null, -0.04),
      P('Petrov', 3, 'Speedster', 'LB LWB LM', null, -0.04), P('Larsen', 6, 'Enforcer', 'DM CM CB', null, -0.03), P('Fofana', 8, 'Playmaker', 'CM DM AM', null, -0.02),
      P('Moreno', 14, 'Playmaker', 'AM CM', null, -0.03), P('Takahashi', 17, 'Trickster', 'LW LM AM', null, -0.04), P('Abara', 19, 'Speedster', 'RW RM ST', null, -0.04),
      P('Kowalczyk', 9, 'Finisher', 'ST CF PIVO', null, -0.03), P('Duarte', 21, 'Enforcer', 'CB RB', null, -0.05),
    ],
  },
  rooftop: {
    id: 'rooftop', name: 'ROOFTOP FC', short: 'RFC',
    kit: { shirt: '#FF3B3B', trim: '#FFFFFF', shorts: '#1A1A1A', socks: '#FF3B3B', gk: '#FF9F1C' },
    squad: [
      P('Kowal', 1, 'Keeper', 'GK'), P('Moreau', 5, 'Enforcer', 'FIXO CB'), P('Tanaka', 8, 'Playmaker', 'ALA CM AM LM', 'L'),
      P('Mensah', 17, 'Speedster', 'ALA RW RM', 'R'), P('Vidal', 9, 'Finisher', 'PIVO ST CF'),
      P('Brennan', 12, 'Keeper', 'GK', null, -0.05), P('Okoro', 4, 'Enforcer', 'CB DM FIXO', null, -0.02), P('Lindgren', 2, 'Speedster', 'RB RWB', null, -0.04),
      P('Ferreira', 3, 'Playmaker', 'LB LWB LM', null, -0.05), P('Sato', 6, 'Enforcer', 'DM CB', null, -0.03), P('Hale', 10, 'Playmaker', 'AM CM', null, -0.02),
      P('Ibarra', 14, 'Playmaker', 'CM DM', null, -0.04), P('Nkosi', 7, 'Speedster', 'RW RM', null, -0.03), P('Volkov', 11, 'Trickster', 'LW LM AM', null, -0.03),
      P('Achebe', 19, 'Finisher', 'ST CF', null, -0.04), P('Dumont', 15, 'Enforcer', 'CB LB', null, -0.05),
    ],
  },
  neon: {
    id: 'neon', name: 'NEON STREETS', short: 'NEO',
    kit: { shirt: '#B84DFF', trim: '#39FF88', shorts: '#140A26', socks: '#39FF88', gk: '#FFE14D' },
    squad: [
      P('Adeyemi', 1, 'Keeper', 'GK'), P('Kaya', 3, 'Enforcer', 'FIXO CB LB'), P('Lopes', 10, 'Trickster', 'ALA AM LW', 'L'),
      P('Novak', 14, 'Playmaker', 'ALA CM RM', 'R'), P('Hughes', 9, 'Finisher', 'PIVO ST CF'),
      P('Santos', 22, 'Keeper', 'GK', null, -0.06), P('Bauer', 4, 'Enforcer', 'CB FIXO', null, -0.03), P('Mwangi', 2, 'Speedster', 'RB RWB RM', null, -0.04),
      P('Ricci', 5, 'Enforcer', 'CB DM', null, -0.04), P('Yilmaz', 6, 'Playmaker', 'DM CM', null, -0.03), P('Castro', 8, 'Playmaker', 'CM AM', null, -0.03),
      P('Olsen', 15, 'Speedster', 'LB LWB LM', null, -0.05), P('Diaz', 7, 'Trickster', 'RW RM AM', null, -0.03), P('Kim', 11, 'Speedster', 'LW LM ST', null, -0.03),
      P('Grant', 19, 'Finisher', 'ST CF', null, -0.04), P('Ndiaye', 16, 'Enforcer', 'DM CB', null, -0.05),
    ],
  },
  harbour: {
    id: 'harbour', name: 'HARBOUR SIDE', short: 'HBS',
    kit: { shirt: '#F2F2F2', trim: '#0FB5AE', shorts: '#0FB5AE', socks: '#F2F2F2', gk: '#E83F6F' },
    squad: [
      P('Lindqvist', 1, 'Keeper', 'GK'), P('Osei', 6, 'Enforcer', 'FIXO DM CB'), P('Costa', 8, 'Playmaker', 'ALA CM LM', 'L'),
      P('Park', 7, 'Speedster', 'ALA RW RM', 'R'), P('Ivanov', 11, 'Trickster', 'PIVO ST AM'),
      P('Murphy', 13, 'Keeper', 'GK', null, -0.06), P('Jansen', 4, 'Enforcer', 'CB FIXO', null, -0.02), P('Afolabi', 5, 'Enforcer', 'CB RB', null, -0.04),
      P('Moretti', 3, 'Speedster', 'LB LWB', null, -0.04), P('Roux', 2, 'Speedster', 'RB RWB', null, -0.05), P('Hussein', 16, 'Playmaker', 'DM CM', null, -0.03),
      P('Aguilar', 10, 'Playmaker', 'AM CM', null, -0.02), P('Berg', 14, 'Playmaker', 'CM LM', null, -0.04), P('Tembo', 17, 'Speedster', 'LW LM', null, -0.03),
      P('Ortiz', 9, 'Finisher', 'ST CF', null, -0.02), P('Novik', 19, 'Finisher', 'ST RW', null, -0.05),
    ],
  },
};

// Validate the squad data once.
for (const T of Object.values(TEAMS)) {
  const nums = new Set();
  for (const s of T.squad) {
    if (!ARCHETYPES[s.arch]) throw new Error(`${T.id}/${s.name}: unknown archetype ${s.arch}`);
    for (const r of s.pos) if (!ROLES[r]) throw new Error(`${T.id}/${s.name}: unknown position ${r}`);
    if (nums.has(s.number)) throw new Error(`${T.id}: shirt number ${s.number} used twice`);
    nums.add(s.number);
  }
}

export function attrsOf(s) {
  const a = { ...ARCHETYPES[s.arch] };
  if (s.q) for (const k in a) if (a[k] > 0) a[k] = Math.min(0.99, Math.max(0.05, a[k] + s.q));
  return a;
}

const sideOfRole = r => (r[0] === 'L' ? 'L' : r[0] === 'R' ? 'R' : 'C');   // LB LWB LM LW / RB RWB RM RW
const sideOfSlot = y => (y < 0.4 ? 'L' : y > 0.6 ? 'R' : 'C');
const overall = a => (a.pace + a.accel + a.control + a.pass + a.shot + a.tackle + a.skill + a.strength + a.keeping * 2) / 10;

// How well squad player s fits formation slot sl (higher is better): his position
// preference, his side, and how good he is — a manager picks his best players first.
const PREF = [10, 9.5, 9, 8.5];
function fit(s, sl) {
  if ((sl.role === 'GK') !== (s.pos[0] === 'GK')) return -1000;
  const i = s.pos.indexOf(sl.role);
  let f = i >= 0 ? PREF[Math.min(i, PREF.length - 1)] : ROLES[s.pos[0]].line === ROLES[sl.role].line ? 4 : 0;
  const ss = sideOfSlot(sl.y), ps = s.side || sideOfRole(s.pos[0]);
  if (ss !== 'C' && ps === ss) f += 1.5;
  else if (ss !== 'C' && ps !== 'C') f -= 1.5;
  return f + 60 * overall(attrsOf(s));
}

// Fit a club's squad to a formation, maximising the total fit: a greedy start, then
// swaps (two starters trade slots, or a substitute comes in) until nothing improves.
// Returns one entry per formation slot, in slot order.
export function buildLineup(team, formationId) {
  const fm = formation(formationId), sq = team.squad, n = fm.slots.length;
  if (sq.length < n) throw new Error(`${team.id}: squad too small for ${formationId}`);
  const F = sq.map(s => fm.slots.map(sl => fit(s, sl)));
  const pick = new Array(n).fill(-1), used = new Set();
  const pairs = [];
  sq.forEach((_, si) => fm.slots.forEach((_, k) => pairs.push([F[si][k] - si * 1e-6, si, k])));
  pairs.sort((a, b) => b[0] - a[0]);
  for (const [, si, k] of pairs) if (pick[k] < 0 && !used.has(si)) { pick[k] = si; used.add(si); }
  for (let improved = true, guard = 0; improved && guard < 100; guard++) {
    improved = false;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const pa = pick[a], pb = pick[b];
        if (F[pb][a] + F[pa][b] > F[pa][a] + F[pb][b] + 1e-9) { pick[a] = pb; pick[b] = pa; improved = true; }
      }
      for (let si = 0; si < sq.length; si++) {
        if (used.has(si) || F[si][a] <= F[pick[a]][a] + 1e-9) continue;
        used.delete(pick[a]); used.add(si); pick[a] = si; improved = true;
      }
    }
  }
  if (pick.some(si => F[si][pick.indexOf(si)] <= -1000)) throw new Error(`${team.id}: no keeper for ${formationId}`);
  return pick.map((si, k) => {
    const s = sq[si], sl = fm.slots[k];
    return { squadIdx: si, name: s.name, number: s.number, arch: s.arch, attrs: attrsOf(s), role: sl.role, form: { x: sl.x, y: sl.y } };
  });
}
