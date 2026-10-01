// Ball control regressions: stopping with the ball and the first touch, measured with
// the same scenarios as tools/metrics.mjs (baseline numbers in docs/metrics/baseline.json).
import { stopTest, touchTest } from './lib/scenarios.mjs';

export default function (matchOpts = {}) {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // ---- stopping (baseline: jog 0.93 s / 2.9 m; sprint never stopped in 2 s)
  const jog = stopTest('jog', { matchOpts });
  check('releasing at a jog stops with the ball in 0.2–0.55 s', jog.tStop > 0.2 && jog.tStop < 0.55 && jog.owned && jog.ballGap < 0.7, `${jog.tStop?.toFixed(2)} s, ${jog.dist.toFixed(2)} m, gap ${jog.ballGap.toFixed(2)}`);
  check('…smoothly (still moving at 0.2 s)', jog.v02 > 1.0, `${jog.v02.toFixed(2)} m/s at 0.2 s`);
  const spr = stopTest('sprint', { sprint: true, matchOpts });
  check('releasing at a sprint stops with the ball in under 0.8 s', spr.tStop != null && spr.tStop < 0.8 && spr.owned && spr.dist < 3, `${spr.tStop?.toFixed(2)} s, ${spr.dist.toFixed(2)} m`);
  const knock = stopTest('knock', { sprint: true, afterKnock: true, matchOpts });
  check('…even right after a knock-on (no chasing the ball)', knock.tStop != null && knock.tStop < 0.9 && knock.owned, `${knock.tStop?.toFixed(2)} s, ${knock.dist.toFixed(2)} m`);
  const opp = stopTest('opp', { sprint: true, opponent: true, matchOpts });
  check('…and with a defender close by he keeps it', opp.owned, `owned ${opp.owned}`);

  // ---- first touch (baseline: a 10 m/s pass died at the feet in 0.02 s, ~0.7 m/s)
  const neutral = touchTest({ from: 'front', speed: 10, input: 'none', matchOpts });
  check('a 10 m/s pass is not killed dead: a neutral touch keeps ≥ 2 m/s', neutral.contact && neutral.outV > 2, `${neutral.inV.toFixed(1)} → ${neutral.outV.toFixed(1)} m/s`);
  const cushioned = touchTest({ from: 'front', speed: 10, input: 'none', cushion: true, matchOpts });
  check('cushioning (close control held) takes more pace off than a neutral touch', cushioned.contact && cushioned.outV < neutral.outV - 0.5, `cushion ${cushioned.outV.toFixed(1)} vs neutral ${neutral.outV.toFixed(1)} m/s`);
  const behind = touchTest({ from: 'behind', speed: 15, input: 'none', matchOpts });
  check('a hot ball from behind runs on before he gathers it (≥ 1.2 m)', behind.contact && behind.travel05 > 1.2, `ball travelled ${behind.travel05.toFixed(2)} m in 0.5 s`);
  const directed = touchTest({ from: 'front', speed: 10, input: 'side', matchOpts });
  check('a directed touch takes it across (into space), not back at the passer', directed.contact && directed.turnDeg < 120 && directed.travel05 > 1, `turned ${directed.turnDeg.toFixed(0)}°, ${directed.travel05.toFixed(2)} m`);
  const good = touchTest({ from: 'side', speed: 12, input: 'none', control: 0.95, matchOpts });
  const poor = touchTest({ from: 'side', speed: 12, input: 'none', control: 0.45, matchOpts });
  check('better feet = a tidier first touch (less pace left on it)', good.contact && poor.contact && good.outV < poor.outV, `control 0.95 → ${good.outV.toFixed(1)} m/s, 0.45 → ${poor.outV.toFixed(1)} m/s`);
  const easy = touchTest({ from: 'front', speed: 6, input: 'none', matchOpts });
  check('a gentle pass is still easy to control', easy.contact && easy.owned1 && easy.gap05 < 0.8, `gap ${easy.gap05.toFixed(2)} m at 0.5 s`);
  return out;
}
