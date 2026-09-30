// Online leaderboards (Supabase). Everything here is optional: if the env vars
// are missing or the network is down, the game plays exactly the same offline.
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const db = URL && KEY ? createClient(URL, KEY, { auth: { persistSession: false } }) : null;

export const online = () => !!db;

const TAG_KEY = 'streetcage.tag';
const TAG_RE = /^[A-Za-z0-9 _.-]{2,16}$/;

export function cleanTag(s) {
  return String(s || '').replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, 16);
}
export function getTag() {
  try { const t = localStorage.getItem(TAG_KEY); if (t && TAG_RE.test(t)) return t; } catch { /* storage blocked */ }
  return null;
}
export function setTag(t) {
  const c = cleanTag(t);
  if (!TAG_RE.test(c)) return null;
  try { localStorage.setItem(TAG_KEY, c); } catch { /* storage blocked */ }
  return c;
}

const withTimeout = (p, ms = 6000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function insert(table, row) {
  if (!db) return { ok: false, reason: 'offline' };
  try {
    const { error } = await withTimeout(db.from(table).insert(row));
    return error ? { ok: false, reason: error.message } : { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// A human's finished match. Returns { ok, reason }.
export function saveMatch(match, humanTeam, tag, diffLabel) {
  const me = match.teams[humanTeam], them = match.teams[1 - humanTeam];
  const pos = me.stats.possession + them.stats.possession || 1;
  const duration = match.opts.mode === 'timed' ? match.opts.seconds : Math.round(match.opts.seconds - match.clock);
  return insert('match_results', {
    player_tag: tag,
    team: me.def.name, opponent: them.def.name,
    mode: match.opts.mode, difficulty: diffLabel,
    goals_for: Math.min(99, me.score), goals_against: Math.min(99, them.score),
    cage_goals: Math.min(me.stats.cageGoals, me.score),
    pannas: me.stats.pannas, skills: me.stats.skills, shots: me.stats.shots,
    possession: Math.round((me.stats.possession / pos) * 100),
    duration_s: Math.max(10, Math.min(3600, Math.round(duration) || 10)),
  });
}

export function saveDrill(tag, d) {
  if (!d.attempts) return Promise.resolve({ ok: false, reason: 'no attempts' });
  return insert('drill_runs', { player_tag: tag, attempts: d.attempts, goals: Math.min(d.goals, d.attempts), cage_goals: Math.min(d.cage, d.goals, d.attempts) });
}

// All three boards in one go.
export async function fetchBoards() {
  if (!db) return { ok: false, reason: 'offline' };
  try {
    const [players, drill, recent] = await withTimeout(Promise.all([
      db.from('player_leaderboard').select('*').order('points', { ascending: false }).order('goals', { ascending: false }).limit(10),
      db.from('drill_leaderboard').select('*').order('cage_goals', { ascending: false }).order('accuracy', { ascending: false }).limit(10),
      db.from('match_results').select('player_tag,team,opponent,goals_for,goals_against,result,cage_goals,created_at').order('created_at', { ascending: false }).limit(8),
    ]));
    const err = players.error || drill.error || recent.error;
    if (err) return { ok: false, reason: err.message };
    return { ok: true, players: players.data, drill: drill.data, recent: recent.data };
  } catch (e) { return { ok: false, reason: e.message }; }
}
