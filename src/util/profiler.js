// Section timer for profiling the frame (sim, AI, physics, view, render). Off by
// default; turned on with ?profile in the URL or prof.enable() from the console.
// When off, timing calls cost one boolean check.
export const prof = {
  on: false,
  acc: Object.create(null),    // ms accumulated per section since the last report
  frames: 0,
  enable(on = true) { this.on = on; this.reset(); },
  reset() { this.acc = Object.create(null); this.frames = 0; },
  now() { return this.on ? performance.now() : 0; },
  add(section, t0) { if (this.on) this.acc[section] = (this.acc[section] || 0) + performance.now() - t0; },
  frame() { if (this.on) this.frames++; },
  // Average ms per frame for each section, then reset.
  report() {
    const out = {};
    for (const [k, v] of Object.entries(this.acc)) out[k] = +(v / Math.max(1, this.frames)).toFixed(3);
    out.frames = this.frames;
    this.reset();
    return out;
  },
};
