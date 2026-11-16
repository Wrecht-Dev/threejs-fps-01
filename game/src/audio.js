// Sound, synthesised with WebAudio: no audio files, no network, nothing to load.
// Every effect is a short node graph built on demand and thrown away; the context
// is created on the first user gesture so browsers allow it.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate * 0.5;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return !!ctx;
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // distance in metres attenuates a distant shot; 0 is point-blank.
  function attenuate(distance) {
    return Math.max(0.05, 1 - distance / 55);
  }

  return {
    unlock() { ensure(); },
    shot(distance = 0) {
      const a = attenuate(distance);
      noise(0.09, 1800, 0.55 * a);
      tone(160, 0.08, 0.3 * a, 'square', 60);
    },
    shotgun(distance = 0) {
      const a = attenuate(distance);
      noise(0.16, 1200, 0.7 * a);
      tone(120, 0.14, 0.35 * a, 'square', 45);
    },
    sniper(distance = 0) {
      const a = attenuate(distance);
      noise(0.22, 2600, 0.6 * a, 'bandpass');
      tone(220, 0.18, 0.3 * a, 'sawtooth', 70);
    },
    dry() { tone(900, 0.04, 0.12, 'square'); },
    reload() {
      tone(500, 0.05, 0.15, 'square');
      setTimeout(() => tone(650, 0.05, 0.15, 'square'), 350);
      setTimeout(() => tone(420, 0.06, 0.18, 'square'), 900);
    },
    hit() { tone(1400, 0.05, 0.2, 'sine'); },
    kill() {
      tone(880, 0.07, 0.2, 'sine');
      setTimeout(() => tone(1318, 0.09, 0.2, 'sine'), 70);
    },
    hurt() { noise(0.12, 500, 0.3); tone(110, 0.15, 0.25, 'sawtooth', 60); },
    plantBeep() { tone(1200, 0.09, 0.22, 'sine'); },
    defuseBeep() { tone(900, 0.09, 0.22, 'sine'); },
    explosion(distance = 0) {
      const a = attenuate(distance);
      noise(0.9, 300, 0.9 * a);
      tone(70, 0.8, 0.6 * a, 'sine', 30);
    },
    throwWhoosh() { noise(0.25, 900, 0.2, 'bandpass'); },
    flash() { tone(2400, 0.3, 0.25, 'sine', 1800); },
    buy() { tone(700, 0.06, 0.18, 'sine'); setTimeout(() => tone(1050, 0.08, 0.18, 'sine'), 60); },
    denied() { tone(220, 0.12, 0.2, 'square'); },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.22, 'sine'), i * 110));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.2, 'sine'), i * 130));
    },
    footstep() { noise(0.05, 700, 0.07); },
  };
}
