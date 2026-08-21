/** Generated ambient sound for timers — no audio files, no licenses, works
 *  offline. Rain is filtered noise, ocean is noise with a slow swell, drone
 *  is three warm detuned oscillators. All routed through one master gain. */

export type Ambient = "none" | "rain" | "ocean" | "drone";
export const AMBIENT_LABELS: Record<Ambient, string> = {
  none: "Silence", rain: "Rain", ocean: "Ocean", drone: "Drone",
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let live: { stop: () => void } | null = null;
let volume = 0.5;

function ensure(): { ctx: AudioContext; master: GainNode } {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return { ctx, master: master! };
}

function noiseBuffer(c: AudioContext, brown: boolean): AudioBuffer {
  const len = c.sampleRate * 3;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buf;
}

export function setAmbientVolume(v: number) {
  volume = v;
  if (master) master.gain.value = v;
}

export function stopAmbient() {
  live?.stop();
  live = null;
}

export function playAmbient(kind: Ambient) {
  stopAmbient();
  if (kind === "none") return;
  const { ctx: c, master: m } = ensure();
  const cleanup: (() => void)[] = [];

  if (kind === "rain") {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, false);
    src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 500;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.4;
    const g = c.createGain(); g.gain.value = 0.55;
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(m);
    src.start();
    cleanup.push(() => src.stop());
  }

  if (kind === "ocean") {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, true);
    src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 650;
    const swell = c.createGain(); swell.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08;
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.32;
    lfo.connect(lfoGain); lfoGain.connect(swell.gain);
    src.connect(lp); lp.connect(swell); swell.connect(m);
    src.start(); lfo.start();
    cleanup.push(() => { src.stop(); lfo.stop(); });
  }

  if (kind === "drone") {
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 750;
    const g = c.createGain(); g.gain.value = 0.16;
    lp.connect(g); g.connect(m);
    const freqs: [number, OscillatorType][] = [[110, "sine"], [110.6, "sine"], [220.4, "triangle"]];
    const oscs = freqs.map(([f, type]) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = type === "triangle" ? 0.35 : 1;
      o.connect(og); og.connect(lp); o.start();
      return o;
    });
    cleanup.push(() => oscs.forEach((o) => o.stop()));
  }

  live = { stop: () => cleanup.forEach((fn) => { try { fn(); } catch { /* already stopped */ } }) };
}

/** Soft two-note completion chime. */
export function chime() {
  const { ctx: c, master: m } = ensure();
  [[660, 0], [880, 0.18]].forEach(([freq, at]) => {
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime + at);
    g.gain.exponentialRampToValueAtTime(0.4, c.currentTime + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + 1.1);
    o.connect(g); g.connect(m);
    o.start(c.currentTime + at); o.stop(c.currentTime + at + 1.2);
  });
}
