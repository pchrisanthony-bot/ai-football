// Synthesized audio — no asset files. Crowd bed, impacts, whistle, and a
// hip-hop menu loop, all generated with WebAudio.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.excite = 0;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0; this.musicBus.connect(this.master);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startCrowd();
    this.startMusic();
    this.startAmbient();
    if (this.radioOn) this.radio(true);   // a match may have started before the first tap
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = loop;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  env(gain, t0, a, peak, dec) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  }

  tone(freq, dur, vol, type = 'sine', slide = null, delay = 0, dest = null) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    this.env(g, t0, 0.004, vol, dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  burst(fType, freq, q, dur, vol, delay = 0, slideTo = null) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const s = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = fType; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    this.env(g, t0, 0.003, vol, dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------ game sounds
  kick(power = 0.5) {
    this.tone(95 + power * 50, 0.14, 0.35 + power * 0.45, 'sine', 42);
    this.burst('highpass', 1800, 0.7, 0.03, 0.12 + power * 0.25);
    if (power > 0.75) this.burst('bandpass', 700, 1.2, 0.08, 0.15);
  }
  touch(p = 0.3) { this.tone(170, 0.05, 0.08 + p * 0.06, 'sine', 90); this.burst('lowpass', 900, 0.8, 0.03, 0.04); }
  bounce(v) { const k = Math.min(1, v / 8); this.tone(110, 0.08, 0.05 + k * 0.2, 'sine', 60); }
  fence(v, board) {
    const k = Math.min(1, v / 22);
    if (board) {
      this.tone(80 + k * 20, 0.18, 0.2 + k * 0.4, 'sine', 45);
      this.burst('bandpass', 420, 1.5, 0.12, 0.15 + k * 0.3);
    } else {
      // chain-link rattle: inharmonic metallic partials + noise shimmer
      for (const [f, q] of [[2300, 18], [3650, 22], [5200, 25], [1450, 14]]) this.burst('bandpass', f * (0.95 + Math.random() * 0.1), q, 0.22 + k * 0.25, 0.08 + k * 0.22);
      this.burst('highpass', 4000, 0.5, 0.35 + k * 0.3, 0.05 + k * 0.1);
      this.tone(95, 0.12, 0.1 + k * 0.25, 'triangle', 60);
    }
  }
  post(v) {
    const k = Math.min(1, v / 20);
    for (const [f, a] of [[523, 1], [1395, 0.6], [2610, 0.35], [3900, 0.2]]) this.tone(f, 0.9 + k * 0.6, (0.06 + k * 0.14) * a, 'sine');
    this.crowdOoh(0.8);
  }
  net() { this.burst('bandpass', 2600, 1.2, 0.45, 0.22, 0, 900); }
  save(kind) { this.burst('bandpass', 1100, 1.5, 0.07, 0.35); if (kind === 'parry') this.tone(140, 0.1, 0.2, 'sine', 70); this.crowdOoh(0.6); }
  tackle(ok) { this.tone(90, 0.1, 0.3, 'sine', 50); this.burst('lowpass', 600, 0.7, 0.12, ok ? 0.25 : 0.12); }
  slide() { this.burst('lowpass', 1500, 0.5, 0.45, 0.18, 0, 400); }
  whoosh() { this.burst('bandpass', 500, 2, 0.28, 0.16, 0, 2600); }
  whistle(long = false) {
    if (!this.ctx) return;
    const blow = (delay, dur) => {
      const t0 = this.t + delay;
      const o = this.ctx.createOscillator(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(), g = this.ctx.createGain();
      o.frequency.value = 2900; lfo.frequency.value = 28; lg.gain.value = 70;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.setValueAtTime(0.18, t0 + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.sfx);
      o.start(t0); lfo.start(t0); o.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
    };
    if (long) { blow(0, 0.35); blow(0.45, 0.35); blow(0.9, 0.9); } else blow(0, 0.45);
  }
  ui() { this.tone(880, 0.06, 0.08, 'triangle'); }
  uiBack() { this.tone(520, 0.08, 0.08, 'triangle'); }
  style(pts) { this.tone(660, 0.1, 0.1, 'square', null, 0); this.tone(990, 0.14, 0.09, 'square', null, 0.07); if (pts >= 250) this.tone(1320, 0.2, 0.09, 'square', null, 0.14); }
  gbStrike() {
    // Slow-motion strike: a sub drop under a reversed-air whoosh.
    this.tone(70, 1.1, 0.55, 'sine', 32);
    this.burst('bandpass', 300, 1.2, 0.8, 0.22, 0, 3200);
    this.tone(1760, 0.5, 0.05, 'triangle', 880, 0.05);
  }
  gbReady() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.16, 0.08, 'square', null, i * 0.07)); }
  gamebreaker() { [220, 277, 330, 440].forEach((f, i) => this.tone(f, 0.6, 0.12, 'sawtooth', f * 2, i * 0.06)); this.crowdRoar(0.8, 2); }

  // ------------------------------------------------------------ crowd
  startCrowd() {
    const ctx = this.ctx;
    this.crowd = ctx.createGain(); this.crowd.gain.value = 0.0; this.crowd.connect(this.master);
    const mk = (freq, q, g) => {
      const s = this.noiseSrc(true), f = ctx.createBiquadFilter(), gg = ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; gg.gain.value = g;
      s.connect(f).connect(gg).connect(this.crowd); s.start();
      return { f, gg };
    };
    this.crowdLayers = [mk(420, 0.8, 0.5), mk(950, 1.1, 0.35), mk(2200, 1.4, 0.12)];
    // city rumble
    const s = this.noiseSrc(true), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 140; g.gain.value = 0.05;
    s.connect(f).connect(g).connect(this.master); s.start();
    this.cityGain = g;
  }
  setCrowd(level) {
    if (!this.ctx) return;
    this.crowd.gain.setTargetAtTime(level, this.t, 0.5);
  }
  crowdOoh(k = 1) {
    if (!this.ctx) return;
    const t0 = this.t;
    const s = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(380, t0); f.frequency.linearRampToValueAtTime(560, t0 + 0.4); f.frequency.linearRampToValueAtTime(330, t0 + 1.2);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25 * k, t0 + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
    s.connect(f).connect(g).connect(this.master); s.start(t0); s.stop(t0 + 1.4);
  }
  crowdRoar(k = 1, dur = 3.5) {
    if (!this.ctx) return;
    const t0 = this.t;
    for (const [freq, q, v] of [[500, 0.7, 0.5], [1100, 0.9, 0.35], [2400, 1.2, 0.15]]) {
      const s = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v * k, t0 + 0.3);
      g.gain.setValueAtTime(v * k, t0 + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f).connect(g).connect(this.master); s.start(t0); s.stop(t0 + dur + 0.1);
    }
  }
  goal() {
    this.crowdRoar(1.2, 4.5);
    // air horn
    for (const f of [233, 294, 349]) this.tone(f, 1.1, 0.07, 'sawtooth', null, 0.1);
  }

  // ------------------------------------------------------------ music (menus)
  startMusic() {
    const ctx = this.ctx;
    // One source, two outputs: clean for the menus, and a lo-fi "boombox on the roof"
    // for matches (band-limited, a little crunchy, with vinyl hiss).
    this.musicIn = ctx.createGain();
    this.musicIn.connect(this.musicBus);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2300;
    const sh = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    sh.curve = curve;
    this.radioGain = ctx.createGain(); this.radioGain.gain.value = 0;
    this.musicIn.connect(hp).connect(lp).connect(sh).connect(this.radioGain).connect(this.master);
    const hiss = this.noiseSrc(true), hf = ctx.createBiquadFilter(), hg = ctx.createGain();
    hf.type = 'highpass'; hf.frequency.value = 5000; hg.gain.value = 0.05;
    hiss.connect(hf).connect(hg).connect(this.radioGain); hiss.start();
    this.kicks = [];
    this.bpm = 92;
    this.step = 0;
    this.nextT = ctx.currentTime + 0.1;
    const spb = 60 / this.bpm / 4;  // 16th notes
    const bass = [45, 0, 0, 45, 0, 0, 48, 0, 43, 0, 0, 43, 0, 40, 0, 0];
    const kickP = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    const snareP = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
    const hatP = [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1];
    const chords = [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    const midi = n => 440 * Math.pow(2, (n - 69) / 12);
    const sched = () => {
      if (!this.ctx) return;
      while (this.nextT < ctx.currentTime + 0.15) {
        const s = this.step % 16, bar = Math.floor(this.step / 16) % 4, t = this.nextT;
        const out = this.musicIn;
        if (kickP[s]) this.kicks.push(t);
        if (kickP[s]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18); this.envAt(g, t, 0.9, 0.25); o.connect(g).connect(out); o.start(t); o.stop(t + 0.3); }
        if (snareP[s]) { const n = this.noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.6; this.envAt(g, t, 0.35, 0.16); n.connect(f).connect(g).connect(out); n.start(t, Math.random()); n.stop(t + 0.2); }
        if (hatP[s]) { const n = this.noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 7000; this.envAt(g, t, s % 4 === 2 ? 0.12 : 0.06, 0.04); n.connect(f).connect(g).connect(out); n.start(t, Math.random()); n.stop(t + 0.06); }
        const bn = bass[s] ? bass[s] + (bar === 2 ? -4 : bar === 3 ? -2 : 0) : 0;
        if (bn) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = midi(bn); this.envAt(g, t, 0.35, spb * 2.5); o.connect(g).connect(out); o.start(t); o.stop(t + spb * 3); }
        if (s === 0 || s === 10) for (const n of chords[bar]) { const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = midi(n); f.type = 'lowpass'; f.frequency.value = 1400; this.envAt(g, t, 0.05, spb * 5); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + spb * 6); }
        this.nextT += spb; this.step++;
      }
    };
    this.musicTimer = setInterval(sched, 40);
  }
  envAt(g, t, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dec); }
  music(on) { if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.t, 0.6); }
  // The boombox in the corner of the roof during matches, and the night around it.
  radio(on) {
    this.radioOn = on;
    if (!this.ctx) return;
    this.radioGain.gain.setTargetAtTime(on ? 0.16 : 0, this.t, 0.8);
    this.windGain.gain.setTargetAtTime(on ? 0.05 : 0.015, this.t, 1.5);
  }
  // 0..1 envelope on the radio's kick drum (the venue lights breathe with it).
  beatLevel() {
    if (!this.ctx || !this.radioOn) return 0;
    const now = this.ctx.currentTime;
    while (this.kicks.length > 1 && this.kicks[1] <= now) this.kicks.shift();
    const k = this.kicks[0];
    return k != null && k <= now ? Math.exp(-(now - k) * 7) : 0;
  }

  // ------------------------------------------------------------ night ambience
  startAmbient() {
    const ctx = this.ctx;
    // wind across the roof: low noise with a slow swell
    const w = this.noiseSrc(true), wf = ctx.createBiquadFilter(), wg = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    wf.type = 'lowpass'; wf.frequency.value = 420; wf.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.015;
    lfo.frequency.value = 0.09; lg.gain.value = 0.6; wg.gain.value = 1;
    lfo.connect(lg).connect(wg.gain);
    w.connect(wf).connect(wg).connect(this.windGain).connect(this.master);
    w.start(); lfo.start();
    // a siren somewhere far below, now and then
    const siren = () => {
      if (!this.ctx) return;
      if (this.radioOn) {
        const t0 = this.t, dur = 5 + Math.random() * 3;
        const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        o.type = 'triangle';
        for (let t = 0; t < dur; t += 1.3) { o.frequency.setValueAtTime(620, t0 + t); o.frequency.linearRampToValueAtTime(930, t0 + t + 0.65); o.frequency.linearRampToValueAtTime(620, t0 + t + 1.3); }
        f.type = 'lowpass'; f.frequency.value = 1300;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.018, t0 + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        let node = o.connect(f).connect(g);
        if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; node = node.connect(pan); }
        node.connect(this.master);
        o.start(t0); o.stop(t0 + dur + 0.1);
      }
      setTimeout(siren, 35000 + Math.random() * 40000);
    };
    setTimeout(siren, 20000 + Math.random() * 20000);
  }
}
