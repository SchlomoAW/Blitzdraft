// BlitzDraft Sound-Effekte: alles per Web Audio synthetisiert (keine Audiodateien noetig).
(() => {
  let ctx = null, master = null, noiseBuf = null;
  let muted = localStorage.getItem("blitzdraft_muted") === "1";
  let vol = Number(localStorage.getItem("blitzdraft_vol"));
  if (!Number.isFinite(vol) || vol <= 0 || vol > 1) vol = 0.6;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : vol;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // Tonspur mit Huellkurve; f2 = Zielfrequenz (Glissando), vib = Vibrato-Frequenz
  // Ausgang: optional mit Stereo-Panner (pan -1 links ... +1 rechts)
  function out(c, node, pan) {
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); p.connect(master); }
    else node.connect(master);
  }

  function tone({ f = 440, f2 = null, type = "sine", t = 0, a = 0.005, d = 0.15, v = 0.3, vib = 0, pan = 0 }) {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime + t, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + a + d);
    if (vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = vib; lg.gain.value = f * 0.04;
      l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + a + d + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    o.connect(g); out(c, g, pan);
    o.start(t0); o.stop(t0 + a + d + 0.05);
  }

  // Gefiltertes Rauschen (Donner, Explosion, Windgeraeusche ...)
  function noise({ t = 0, d = 0.3, type = "lowpass", f = 1000, f2 = null, q = 1, v = 0.3, a = 0.005, pan = 0 }) {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime + t, src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf; src.loop = true;
    fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t0);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + a + d);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    src.connect(fl); fl.connect(g); out(c, g, pan);
    src.start(t0, Math.random()); src.stop(t0 + a + d + 0.05);
  }

  const S = {
    // --- Bedienung ---
    pick(pan = 0) { tone({ f: 420, f2: 900, d: 0.09, v: 0.25, pan }); tone({ f: 1320, type: "triangle", t: 0.04, d: 0.08, v: 0.1, pan }); },
    // Pick eines anderen Spielers: leises Ticken, nach Kartenposition links/rechts
    tickOther(pan = 0) { tone({ f: 640, f2: 520, type: "triangle", d: 0.05, v: 0.07, pan }); },
    error() { tone({ f: 170, f2: 110, type: "square", d: 0.13, v: 0.1 }); tone({ f: 170, f2: 100, type: "square", t: 0.14, d: 0.15, v: 0.1 }); },
    collect() { [660, 880, 1100, 1480].forEach((f, i) => tone({ f, type: "triangle", t: i * 0.06, d: 0.13, v: 0.18 })); },
    tick() { tone({ f: 880, d: 0.07, v: 0.2 }); },
    // --- Runden ---
    roundStart() {
      noise({ type: "bandpass", f: 300, f2: 3200, q: 1.2, d: 0.35, v: 0.2 });
      [523, 659, 784, 1047].forEach(f => tone({ f, type: "triangle", t: 0.3, d: 0.4, v: 0.13 }));
    },
    roundEnd() {
      tone({ f: 784, type: "triangle", d: 0.22, v: 0.2 });
      tone({ f: 587, type: "triangle", t: 0.14, d: 0.3, v: 0.2 });
      tone({ f: 392, type: "triangle", t: 0.3, d: 0.5, v: 0.22 });
      tone({ f: 100, f2: 50, t: 0.05, d: 0.3, v: 0.25 });
    },
    finished() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, type: "triangle", t: i * 0.11, d: i === 4 ? 0.9 : 0.25, v: 0.2 }));
      [523, 659, 784].forEach(f => tone({ f, type: "sine", t: 0.6, d: 1.0, v: 0.12 }));
    },
    // --- Items ---
    wall() {
      tone({ f: 110, f2: 45, d: 0.35, v: 0.5 });
      noise({ type: "lowpass", f: 500, f2: 120, d: 0.3, v: 0.35 });
      tone({ f: 90, f2: 40, t: 0.14, d: 0.25, v: 0.3 });
    },
    blitz(n = 1, pans = []) {
      for (let i = 0; i < n; i++) {
        const t = i * 0.14, pan = pans[i] || 0;
        noise({ t, type: "highpass", f: 2000, d: 0.08, v: 0.45, pan });
        tone({ f: 2400, f2: 150, type: "sawtooth", t, d: 0.18, v: 0.13, pan });
      }
      noise({ t: 0.05, type: "lowpass", f: 220, d: 1.0, v: 0.35, a: 0.03 });
    },
    explosion(pan = 0) {
      noise({ type: "lowpass", f: 2500, f2: 80, d: 0.9, v: 0.6, pan: pan * 0.6 });
      tone({ f: 140, f2: 35, d: 0.7, v: 0.6 });
      noise({ t: 0.02, type: "highpass", f: 3000, d: 0.15, v: 0.25, pan });
    },
    swap() {
      tone({ f: 300, f2: 900, d: 0.5, v: 0.15 });
      tone({ f: 900, f2: 300, d: 0.5, v: 0.15 });
      noise({ type: "bandpass", f: 700, f2: 1800, q: 2, d: 0.5, v: 0.08 });
      tone({ f: 1400, type: "triangle", t: 0.55, d: 0.15, v: 0.12 });
      tone({ f: 1850, type: "triangle", t: 0.65, d: 0.2, v: 0.12 });
    },
    maze() {
      noise({ type: "bandpass", f: 250, f2: 520, q: 4, d: 0.7, v: 0.3 });
      tone({ f: 70, f2: 95, type: "sawtooth", d: 0.7, v: 0.1 });
      tone({ f: 120, f2: 60, t: 0.75, d: 0.15, v: 0.35 });
      noise({ t: 0.75, type: "lowpass", f: 300, d: 0.1, v: 0.25 });
    },
    // Bonus-Sterne
    award() {
      tone({ f: 988, type: "triangle", d: 0.3, v: 0.2 });
      tone({ f: 1319, type: "triangle", t: 0.08, d: 0.45, v: 0.2 });
      tone({ f: 1976, t: 0.16, d: 0.5, v: 0.08 });
      noise({ t: 0.05, type: "highpass", f: 6000, d: 0.12, v: 0.05 });
    },
    stars() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ f, type: "triangle", t: i * 0.12, d: 0.3, v: 0.2 }));
      [523, 659, 784, 1047].forEach(f => tone({ f, type: "sine", t: 0.55, d: 1.3, v: 0.11 }));
      [1568, 1976, 2349, 3136].forEach((f, i) => tone({ f, type: "sine", t: 0.7 + i * 0.09, d: 0.4, v: 0.06 }));
    },
    // Geist: gespenstisches Heulen
    ghost() {
      tone({ f: 520, f2: 260, d: 0.9, v: 0.12, vib: 6, a: 0.08 });
      tone({ f: 780, f2: 390, t: 0.05, d: 0.9, v: 0.07, vib: 7, a: 0.08 });
      noise({ type: "bandpass", f: 800, f2: 300, q: 3, d: 0.8, v: 0.06, a: 0.1 });
    },
    // Empfaenger: tiefes "Buuuh" und dumpfer Aufprall, wenn die Karte faellt
    ghostBig() {
      tone({ f: 200, f2: 120, d: 1.2, v: 0.25, vib: 5, a: 0.1 });
      tone({ f: 400, f2: 240, d: 1.2, v: 0.12, vib: 6, a: 0.1 });
      noise({ type: "bandpass", f: 900, f2: 250, q: 3, d: 1.0, v: 0.08, a: 0.15 });
      tone({ f: 200, f2: 60, t: 1.0, d: 0.25, v: 0.4 });
      noise({ t: 1.0, type: "lowpass", f: 400, d: 0.12, v: 0.25 });
    },
  };

  const api = {};
  for (const k of Object.keys(S)) api[k] = (...a) => { try { S[k](...a); } catch (e) { console.warn("sfx", k, e); } };
  api.setMuted = m => {
    muted = !!m; localStorage.setItem("blitzdraft_muted", muted ? "1" : "0");
    if (master) master.gain.value = muted ? 0 : vol;
    updateUi();
  };
  api.toggle = () => { ensure(); api.setMuted(!muted); if (!muted) api.pick(); };
  api.setVolume = v => {
    vol = Math.min(1, Math.max(0.02, v)); localStorage.setItem("blitzdraft_vol", String(vol));
    if (master && !muted) master.gain.value = vol;
  };
  api.isMuted = () => muted;
  window.sfx = api;

  // Audio darf erst nach einer Nutzeraktion starten
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, () => ensure(), { passive: true });

  function updateUi() {
    const b = document.getElementById("soundBtn"), r = document.getElementById("soundVol");
    if (b) { b.textContent = muted ? "🔇" : "🔊"; b.title = muted ? "Sound einschalten" : "Sound ausschalten"; }
    if (r) r.value = String(Math.round(vol * 100));
  }
  window.addEventListener("DOMContentLoaded", updateUi);
  updateUi();
  const b = document.getElementById("soundBtn"), r = document.getElementById("soundVol");
  if (b) b.addEventListener("click", () => api.toggle());
  if (r) r.addEventListener("input", () => { api.setVolume(Number(r.value) / 100); if (muted) api.setMuted(false); });
})();
