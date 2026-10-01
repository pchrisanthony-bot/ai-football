// Human controller: maps input onto the same Match API the AI uses.
// Context-sensitive like FIFA: J passes with the ball, switches player without it.
import { KICK, SWITCH, footballGameplayConfig as GP } from '../config.js';
import { maxSpeed } from '../sim/players.js';
import { clampToField } from '../sim/pitch.js';
import { clamp, rotateTowards } from '../util/math.js';

export class HumanController {
  constructor(match, team, input) {
    this.m = match; this.team = team; this.in = input;
    this.charge = null;          // { kind: 'shot'|'pass'|'through'|'lob', t }
    this.switchCD = 0;
    this.lastOwner = null;
    this.setHuman(this.pickStart());
  }

  // Start on the man taking the kick-off (or the nearest to the ball when he's gone).
  pickStart() { return this.m.kickTaker(this.team) || this.bestDefender(); }

  get p() { return this.m.human; }

  setHuman(p) {
    if (!p || p === this.m.human) return;
    if (this.m.human) { this.m.human.human = false; this.m.human.closeControl = false; this.m.human.jockey = false; this.m.human.faceTarget = null; }
    p.human = true;
    this.m.human = p;
    this.charge = null;
    this.switchCD = 0.25;
  }

  // Screen → world: the camera looks down −z, so "up" on screen is −z.
  stick() { return { x: this.in.move.x, z: -this.in.move.y }; }

  update(dt) {
    const m = this.m, inp = this.in, b = m.ball;
    this.switchCD = Math.max(0, this.switchCD - dt);
    if (m.phase !== 'play' && m.phase !== 'restart') { this.charge = null; return; }
    this.autoSwitch();
    const p = this.p;
    if (!p || !p.active) { this.setHuman(this.pickStart()); return; }

    const st = this.stick();
    const hasStick = Math.hypot(st.x, st.z) > 0.15;
    const mine = b.owner === p;
    const sprint = inp.down('sprint') && p.stamina > 0.05;
    p.sprinting = sprint;
    p.wantShoot = inp.down('shoot');

    // ---- movement (at a restart: still until it's set, and the taker stays at the ball)
    const r = m.phase === 'restart' ? m.restart : null;
    if (r && (r.state !== 'READY' || r.type === 'KICKOFF' || p === r.taker)) { p.move.speed = 0; }
    else {
      const sp = maxSpeed(p, sprint) * (mine ? 0.94 : 1) * (this.charge ? 0.8 : 1);
      p.move.x = st.x; p.move.z = st.z; p.move.speed = hasStick ? sp * Math.min(1, Math.hypot(st.x, st.z) * 1.2) : 0;
    }
    // Street Ball Control with the ball, jockey without it.
    const ctl = inp.down('control');
    p.cushion = ctl;                      // held while a pass arrives: cushion the first touch
    p.closeControl = mine && ctl && !b.inHands;
    p.jockey = !mine && ctl;
    p.faceTarget = p.jockey ? { x: b.x, z: b.z } : null;
    if (p.jockey) p.move.speed *= 0.7;

    if (r) { if (p === r.taker && r.state === 'READY') this.restartInput(dt, st, hasStick); return; }
    if (m.phase !== 'play') return;
    this.receiveAssist(p, hasStick, sprint);
    if (inp.pressed('gamebreaker')) m.activateGB(this.team);   // G / L3·R3 / the GB button
    const canUseBall = mine || (!b.owner && m.ballReachableSoon(p, 1.6));

    // Double-tap PASS: the second tap lands while the first pass is winding up and dinks it.
    const dinked = mine && inp.pressed('pass') && m.dinkPass(p);

    // ---- charged kicks (hold for power, release to strike)
    for (const kind of ['shoot', 'pass', 'through', 'lob']) {
      if (inp.pressed(kind) && (canUseBall || kind === 'shoot') && !this.charge && !(dinked && kind === 'pass')) {
        this.charge = { kind, t: 0, aimed: hasStick, ang: hasStick ? Math.atan2(st.z, st.x) : Math.atan2(-b.z, m.oppGoalX(p.team) - b.x) };
      }
    }
    if (this.charge) {
      this.charge.t += dt;
      // Aim sweeps toward the held direction (so a keyboard can reach any bank angle).
      if (hasStick) {
        this.charge.aimed = true;
        this.charge.ang = rotateTowards(this.charge.ang, Math.atan2(st.z, st.x), 2.3 * dt);
      }
      const kind = this.charge.kind;
      if (inp.released(kind)) {
        const power = clamp(this.charge.t / KICK.chargeTime, 0.05, 1);
        const flair = inp.down('flair');
        const aim = this.aimStick();
        this.charge = null;
        if (mine || canUseBall) this.fire(kind, power, flair, kind === 'shoot' ? aim : st, inp.gest[kind]);
      }
    }

    // ---- defence (no ball)
    if (!mine) {
      if (inp.pressed('pass') && !canUseBall && this.switchCD <= 0) this.manualSwitch();
      if (inp.pressed('through')) m.requestTackle(p);
      if (inp.pressed('shoot') && !canUseBall && b.owner && b.owner.team !== p.team) { this.charge = null; m.requestSlide(p); }
      m.ai.team[this.team].forcePress = inp.down('lob');
      m.ai.team[this.team].gkRush = inp.down('rush');
    } else {
      m.ai.team[this.team].forcePress = false;
      // ---- skills (keyboard keys or right-stick flicks, FIFA Street style)
      if (inp.skill) this.touchSkill(inp.skill, st);
      const flick = inp.rflick;
      const skill =
        inp.pressed('stepover') || flick === 'left' || flick === 'right' ? 'stepover' :
        inp.pressed('roulette') ? 'roulette' :
        inp.pressed('dragback') || flick === 'down' ? 'dragback' :
        inp.pressed('rainbow') || flick === 'up' ? 'rainbow' :
        inp.pressed('flickup') ? 'flickup' : null;
      if (skill) m.requestSkill(p, skill, flick === 'left' ? -1 : flick === 'right' ? 1 : st.x, st.z);
      // Panna: hold Street Ball Control, tap sprint toward a defender (touch: long-press SKILL).
      if ((ctl && inp.pressed('sprint')) || inp.pressed('panna')) m.requestSkill(p, 'panna');
    }
  }

  // Receiving: with the stick neutral, the man a pass is meant for goes to meet it (his
  // touch stays a neutral one — or a cushion with Street Ball Control held). Any stick input
  // is his own run and his own touch.
  receiveAssist(p, hasStick, sprint) {
    const m = this.m, b = m.ball;
    p.autoReceive = false;
    if (!GP.passing.receiveAssist || hasStick || b.owner || b.passTo !== p) return;
    const ic = m.ai.intercept(p, m.nearestOpponent(p) > 3 ? 1.3 : 2.2, true);
    const dx = ic.x - p.x, dz = ic.z - p.z, d = Math.hypot(dx, dz);
    if (d > 0.3) { p.move.x = dx / d; p.move.z = dz / d; p.move.speed = Math.min(maxSpeed(p, sprint || d > 4), 0.8 + d * 2.6); }
    p.autoReceive = true;
  }

  // Taking a set piece: aim with the stick, hold for power, release to play it.
  //   PASS = short (a throw / a pass) · THROUGH, LOB or SHOOT = long (a long throw, a
  //   cross, a long ball). Toward a team-mate in the stick's direction, else into space.
  restartInput(dt, st, hasStick) {
    const m = this.m, inp = this.in, p = this.p, r = m.restart;
    for (const kind of ['pass', 'through', 'lob', 'shoot']) if (inp.pressed(kind) && !this.charge) this.charge = { kind, t: 0 };
    if (!this.charge) return;
    this.charge.t += dt;
    if (!inp.released(this.charge.kind)) return;
    const long = this.charge.kind !== 'pass', power = clamp(this.charge.t / KICK.chargeTime, 0.05, 1);
    this.charge = null;
    const to = m.passing.receiverFor(p, st.x, st.z, long);
    const ang = hasStick ? Math.atan2(st.z, st.x) : p.facing;
    const dist = long ? 16 + 22 * power : 7 + 8 * power;
    const target = to ? { x: to.x, z: to.z } : clampToField(p.x + Math.cos(ang) * dist, p.z + Math.sin(ang) * dist, 1);
    if (r.type === 'THROW_IN') m.takeRestart(p, 'throwin', to ? { receiver: to } : { target });
    else if (long) m.takeRestart(p, 'lob', { target, receiver: to });
    else m.takeRestart(p, 'pass', to ? { receiver: to, power } : { target, power });
  }

  // gesture: how a touch button was released, e.g. SHOOT swiped 'up' = chip, 'down' = curl.
  fire(kind, power, flair, st, gesture = null) {
    const m = this.m, p = this.p;
    const side = gesture === 'left' || gesture === 'right';
    if (kind === 'shoot') {
      const chip = gesture === 'up';
      const aim = m.humanAim(p, st.x, st.z, power, (flair || gesture === 'down') && !chip, chip);
      m.requestShot(p, aim);
    } else if (kind === 'lob' && flair) {
      // Chip shot
      const aim = m.humanAim(p, st.x, st.z, power, false, true);
      m.requestShot(p, aim);
    } else if (kind === 'through' && gesture === 'up') {
      m.requestPass(p, st.x, st.z, 'lob', null, false, { lead: true });   // lofted through ball
    } else if (kind === 'pass' && side) {
      m.requestPass(p, st.x, st.z, 'pass', 0.75, flair, { driven: true }); // driven ground pass
    } else {
      // On touch the pass winds up a little longer so a second tap can dink it.
      const opts = kind === 'pass' && this.in.touch?.enabled ? { contact: 0.21 } : {};
      // The charge weights every pass: how far into space, and (less so, with assist) how hard.
      m.requestPass(p, st.x, st.z, kind, power, flair, opts);
    }
  }

  // Skill from the touch SKILL button: { name, dx, dy } with the swipe in screen pixels.
  touchSkill(sk, st) {
    const m = this.m, p = this.p;
    if (sk.name === 'panna') { m.requestSkill(p, 'panna'); return; }
    // Side for stepovers/roulettes: the swipe's side of the player's facing, else the stick's.
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const len = Math.hypot(sk.dx || 0, sk.dy || 0);
    const perp = len ? ((sk.dx || 0) * -fz + (sk.dy || 0) * fx) / len : 0;   // screen y down = +z
    const side = Math.abs(perp) > 0.3 ? Math.sign(perp) : (st.x * -fz + st.z * fx) >= 0 ? 1 : -1;
    m.requestSkill(p, sk.name, -fz * side, fx * side);
  }

  // A panna is on: we have the ball and a defender is close in front (drives the touch prompt).
  pannaReady() {
    const m = this.m, p = this.p;
    return !!p && m.phase === 'play' && m.ball.owner === p && !m.ball.inHands && m.canAct(p) && !!m.pannaTarget(p);
  }

  // While charging, what would the shot do? (drives the aim preview)
  aimStick() {
    const c = this.charge;
    if (!c || !c.aimed) return { x: 0, z: 0 };
    return { x: Math.cos(c.ang), z: Math.sin(c.ang) };
  }

  previewAim() {
    const m = this.m, p = this.p;
    if (!this.charge || this.charge.kind !== 'shoot' || !p) return null;
    const st = this.aimStick();
    const power = clamp(this.charge.t / KICK.chargeTime, 0.05, 1);
    return m.humanAim(p, st.x, st.z, power, this.in.down('flair'), false);
  }

  chargeLevel() { return this.charge ? clamp(this.charge.t / KICK.chargeTime, 0, 1) : 0; }

  // ---- player switching
  // Without the ball the human follows the team-mate best placed to win it: the one
  // who gets to it soonest (a loose ball: where it's going, not where it is), shaded
  // toward men goal-side of it. Scored in seconds, so it reads the same on any pitch.
  switchScore(q) {
    const m = this.m, b = m.ball, gx = m.ownGoalX(this.team);
    const goalSide = Math.abs(q.x - gx) < Math.abs(b.x - gx) ? SWITCH.goalSide : 0;
    return m.ai.intercept(q, 2.2, true).t - goalSide;
  }

  autoSwitch() {
    const m = this.m, b = m.ball, cur = this.p;
    if (this.charge) return;
    const o = b.owner;
    if (o && o.team === this.team && o !== cur && o.line !== 'GK') { this.setHuman(o); return; }
    if (m.phase === 'restart' && m.restart.state !== 'READY') return;   // no switching while a restart is set up
    if (b.passTo && b.passTo.team === this.team && b.passTo !== cur && b.passTo.line !== 'GK') { this.setHuman(b.passTo); return; }
    if (o && o.team === this.team) return;
    // Defending or loose: follow the best-placed man, with hysteresis — readily right
    // after the ball changes hands, otherwise only for a clearly better one.
    if (this.switchCD > 0) return;
    const changed = o !== this.lastOwner;
    this.lastOwner = o;
    const best = this.bestDefender();
    if (!best || best === cur) return;
    const sc = this.switchScore(cur), sb = this.switchScore(best);
    if ((changed && sb < sc - SWITCH.onChange) || sb < sc - SWITCH.margin) this.setHuman(best);
  }

  bestDefender(exclude = null) {
    let best = null, bs = Infinity;
    for (const q of this.m.teamPlayers(this.team)) {
      if (q.line === 'GK' || q === exclude) continue;
      const s = this.switchScore(q);
      if (s < bs) { bs = s; best = q; }
    }
    return best;
  }

  manualSwitch() {
    const next = this.bestDefender(this.p);
    if (next) this.setHuman(next);
  }
}
