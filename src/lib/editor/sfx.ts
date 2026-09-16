/**
 * Catalogue SFX façon CapCut Pro, synthétisé dans le navigateur.
 *
 * Pas de packs CapCut : chaque son est du PCM 16 bit mono 44,1 kHz, posé
 * comme clip sur la piste `sfx`. L'export les mixe dans un WAV unique
 * (`mixProjectSfx`) que le graphe lit comme une voix off — ducking compris.
 */

import { encodeWav } from "@/lib/video/audio/wav";
import type { Clip } from "./types";

export const SFX_RATE = 44100;

export type SfxCategory =
  | "whoosh"
  | "hit"
  | "ui"
  | "riser"
  | "texture"
  | "cinematic"
  | "cartoon"
  | "tech";

export const SFX_CATEGORIES: { id: SfxCategory; label: string }[] = [
  { id: "whoosh", label: "Whoosh" },
  { id: "hit", label: "Impacts" },
  { id: "ui", label: "UI" },
  { id: "riser", label: "Risers" },
  { id: "texture", label: "Textures" },
  { id: "cinematic", label: "Cinéma" },
  { id: "cartoon", label: "Cartoon" },
  { id: "tech", label: "Tech" },
];

export type SfxVoice = {
  kind:
    | "whoosh"
    | "hit"
    | "click"
    | "tone"
    | "riser"
    | "downer"
    | "glitch"
    | "sparkle"
    | "noise"
    | "beep"
    | "kick"
    | "hat"
    | "clap"
    | "cymbal"
    | "boing"
    | "laser"
    | "heartbeat"
    | "air"
    | "chime"
    | "shutter"
    | "type"
    | "sweep";
  bright?: number;
  reverse?: boolean;
  f0?: number;
  f1?: number;
  decay?: number;
  noiseAmp?: number;
  freqs?: number[];
  pulses?: number;
  bpm?: number;
  hp?: number;
};

export type SfxDef = {
  id: string;
  name: string;
  description: string;
  category: SfxCategory;
  /** Durée nominale, en secondes. */
  duration: number;
  voice: SfxVoice;
};

export const SFX_LIBRARY: SfxDef[] = [
  /* -------------------------------- whoosh --------------------------------- */
  { id: "whoosh", name: "Whoosh", description: "Souffle court de transition.", category: "whoosh", duration: 0.42, voice: { kind: "whoosh", bright: 0.85 } },
  { id: "whoosh-long", name: "Whoosh long", description: "Balayage plus ample, coupe whip.", category: "whoosh", duration: 0.78, voice: { kind: "whoosh", bright: 0.55 } },
  { id: "whoosh-in", name: "Whoosh in", description: "Arrive dans le plan.", category: "whoosh", duration: 0.5, voice: { kind: "whoosh", bright: 1.05 } },
  { id: "whoosh-out", name: "Whoosh out", description: "Sort du plan.", category: "whoosh", duration: 0.48, voice: { kind: "whoosh", bright: 0.45, reverse: true } },
  { id: "swipe", name: "Swipe", description: "Glissement d'écran, UI mobile.", category: "whoosh", duration: 0.32, voice: { kind: "whoosh", bright: 1.1 } },
  { id: "whip", name: "Whip", description: "Coup de fouet, whip pan.", category: "whoosh", duration: 0.28, voice: { kind: "whoosh", bright: 1.35 } },
  { id: "swoosh", name: "Swoosh", description: "Souffle plus grave, logo.", category: "whoosh", duration: 0.55, voice: { kind: "whoosh", bright: 0.35 } },
  { id: "reverse", name: "Reverse", description: "Whoosh à l'envers, anticipation.", category: "whoosh", duration: 0.62, voice: { kind: "whoosh", bright: 0.7, reverse: true } },

  /* -------------------------------- impacts -------------------------------- */
  { id: "impact", name: "Impact", description: "Frappe sèche, punch visuel.", category: "hit", duration: 0.38, voice: { kind: "hit", f0: 62, f1: 124, decay: 14, noiseAmp: 0.55 } },
  { id: "boom", name: "Boom", description: "Sub grave, drop.", category: "hit", duration: 0.72, voice: { kind: "hit", f0: 42, f1: 84, decay: 6, noiseAmp: 0.28 } },
  { id: "bass", name: "Bass drop", description: "Descente de basse, beat.", category: "hit", duration: 0.55, voice: { kind: "downer", f0: 90, f1: 35 } },
  { id: "slam", name: "Slam", description: "Porte / objet qui claque.", category: "hit", duration: 0.34, voice: { kind: "hit", f0: 70, f1: 210, decay: 18, noiseAmp: 0.7 } },
  { id: "punch", name: "Punch", description: "Coup de poing, combat.", category: "hit", duration: 0.26, voice: { kind: "hit", f0: 90, f1: 280, decay: 22, noiseAmp: 0.5 } },
  { id: "thud", name: "Thud", description: "Chute sourde.", category: "hit", duration: 0.44, voice: { kind: "hit", f0: 48, f1: 96, decay: 10, noiseAmp: 0.35 } },
  { id: "crash", name: "Crash", description: "Casse, débris.", category: "hit", duration: 0.7, voice: { kind: "cymbal" } },
  { id: "kick", name: "Kick", description: "Grosse caisse, 808 court.", category: "hit", duration: 0.32, voice: { kind: "kick", f0: 58 } },

  /* ---------------------------------- UI ----------------------------------- */
  { id: "click", name: "Clic", description: "Clic UI, marqueur de cut.", category: "ui", duration: 0.1, voice: { kind: "click", f0: 2400, noiseAmp: 0.7 } },
  { id: "snap", name: "Snap", description: "Claquement de doigts.", category: "ui", duration: 0.16, voice: { kind: "click", f0: 1800, noiseAmp: 0.85 } },
  { id: "pop", name: "Pop", description: "Bulle / sticker qui apparaît.", category: "ui", duration: 0.18, voice: { kind: "tone", freqs: [420, 840], decay: 28 } },
  { id: "tap", name: "Tap", description: "Doigt sur l'écran.", category: "ui", duration: 0.09, voice: { kind: "click", f0: 1600, noiseAmp: 0.45 } },
  { id: "shutter", name: "Shutter", description: "Déclencheur photo, deux lames.", category: "ui", duration: 0.26, voice: { kind: "shutter" } },
  { id: "type", name: "Clavier", description: "Trois frappes, texte qui tombe.", category: "ui", duration: 0.38, voice: { kind: "type" } },
  { id: "notify", name: "Notif", description: "Deux tons, alerte douce.", category: "ui", duration: 0.48, voice: { kind: "tone", freqs: [880, 1320], decay: 11 } },
  { id: "send", name: "Send", description: "Message envoyé.", category: "ui", duration: 0.28, voice: { kind: "sweep", f0: 600, f1: 1400, noiseAmp: 0.08 } },
  { id: "like", name: "Like", description: "Cœur / like TikTok.", category: "ui", duration: 0.36, voice: { kind: "chime", freqs: [988, 1318, 1568] } },
  { id: "toggle", name: "Toggle", description: "Interrupteur, switch.", category: "ui", duration: 0.14, voice: { kind: "click", f0: 900, noiseAmp: 0.35 } },

  /* -------------------------------- risers --------------------------------- */
  { id: "riser", name: "Riser", description: "Montée de tension avant le cut.", category: "riser", duration: 1.15, voice: { kind: "riser", f0: 180, f1: 1580 } },
  { id: "riser-short", name: "Riser court", description: "Montée d'une seconde pile.", category: "riser", duration: 0.7, voice: { kind: "riser", f0: 240, f1: 1800 } },
  { id: "downer", name: "Downer", description: "Descente, fin de séquence.", category: "riser", duration: 0.9, voice: { kind: "downer", f0: 900, f1: 80 } },
  { id: "tension", name: "Tension", description: "Drone qui monte, thriller.", category: "riser", duration: 1.4, voice: { kind: "riser", f0: 90, f1: 420 } },
  { id: "reverse-cym", name: "Cymbale reverse", description: "Anticipation classique.", category: "riser", duration: 1.05, voice: { kind: "cymbal", reverse: true } },

  /* ------------------------------- textures -------------------------------- */
  { id: "glitch", name: "Glitch", description: "Rafales numériques.", category: "texture", duration: 0.34, voice: { kind: "glitch" } },
  { id: "sparkle", name: "Étincelle", description: "Tintements aigus, magic / like.", category: "texture", duration: 0.58, voice: { kind: "sparkle", freqs: [2480, 3120, 3720, 4180] } },
  { id: "static", name: "Static", description: "Souffle TV, neige.", category: "texture", duration: 0.5, voice: { kind: "noise", noiseAmp: 0.55, decay: 3, hp: 0.7 } },
  { id: "zap", name: "Zap", description: "Décharge électrique.", category: "texture", duration: 0.22, voice: { kind: "glitch" } },
  { id: "digital", name: "Digital", description: "Artefact data, buffer.", category: "texture", duration: 0.4, voice: { kind: "glitch" } },
  { id: "record", name: "Vinyl crackle", description: "Poussière de disque.", category: "texture", duration: 0.8, voice: { kind: "noise", noiseAmp: 0.22, decay: 1.2, hp: 0.85 } },

  /* ------------------------------- cinéma ---------------------------------- */
  { id: "braam", name: "Braam", description: "Cuivre Inception, trailer.", category: "cinematic", duration: 1.2, voice: { kind: "hit", f0: 55, f1: 110, decay: 4, noiseAmp: 0.2 } },
  { id: "subdrop", name: "Sub drop", description: "Infra, salle obscure.", category: "cinematic", duration: 1.0, voice: { kind: "hit", f0: 32, f1: 64, decay: 3.5, noiseAmp: 0.12 } },
  { id: "stinger", name: "Stinger", description: "Horreur, jump scare.", category: "cinematic", duration: 0.55, voice: { kind: "hit", f0: 140, f1: 880, decay: 9, noiseAmp: 0.45 } },
  { id: "trailer", name: "Trailer hit", description: "Hit de bande-annonce.", category: "cinematic", duration: 0.85, voice: { kind: "hit", f0: 48, f1: 96, decay: 7, noiseAmp: 0.4 } },
  { id: "heartbeat", name: "Heartbeat", description: "Deux battements, suspense.", category: "cinematic", duration: 1.15, voice: { kind: "heartbeat", bpm: 72 } },
  { id: "air", name: "Souffle", description: "Inspiration, cut dramatique.", category: "cinematic", duration: 0.45, voice: { kind: "air" } },

  /* ------------------------------- cartoon --------------------------------- */
  { id: "boing", name: "Boing", description: "Ressort, rebond.", category: "cartoon", duration: 0.45, voice: { kind: "boing", f0: 280 } },
  { id: "plop", name: "Plop", description: "Goutte / bulle.", category: "cartoon", duration: 0.2, voice: { kind: "tone", freqs: [320, 180], decay: 22 } },
  { id: "zip", name: "Zip", description: "Course cartoon.", category: "cartoon", duration: 0.3, voice: { kind: "sweep", f0: 400, f1: 2200, noiseAmp: 0.1 } },
  { id: "slide", name: "Sifflet", description: "Glissando descendant.", category: "cartoon", duration: 0.55, voice: { kind: "downer", f0: 1400, f1: 280 } },
  { id: "honk", name: "Klaxon", description: "Poire, gag.", category: "cartoon", duration: 0.28, voice: { kind: "tone", freqs: [380, 420], decay: 8 } },
  { id: "clap", name: "Clap", description: "Claquement de mains.", category: "cartoon", duration: 0.22, voice: { kind: "clap" } },
  { id: "hat", name: "Hi-hat", description: "Cymbale fermée, rythme.", category: "cartoon", duration: 0.14, voice: { kind: "hat" } },

  /* --------------------------------- tech ---------------------------------- */
  { id: "laser", name: "Laser", description: "Tir sci-fi.", category: "tech", duration: 0.32, voice: { kind: "laser", f0: 1800, f1: 220 } },
  { id: "beep", name: "Beep", description: "Bip machine, UI rétro.", category: "tech", duration: 0.18, voice: { kind: "beep", f0: 880, pulses: 1 } },
  { id: "beep-double", name: "Beep ×2", description: "Deux bips, confirmation.", category: "tech", duration: 0.32, voice: { kind: "beep", f0: 990, pulses: 2 } },
  { id: "scan", name: "Scan", description: "Balayage sonar / HUD.", category: "tech", duration: 0.7, voice: { kind: "sweep", f0: 500, f1: 2400, noiseAmp: 0.12 } },
  { id: "warp", name: "Warp", description: "Saut hyperspace.", category: "tech", duration: 0.85, voice: { kind: "riser", f0: 80, f1: 2400 } },
  { id: "powerup", name: "Power-up", description: "Bonus jeu vidéo.", category: "tech", duration: 0.5, voice: { kind: "chime", freqs: [523, 659, 784, 1046] } },
  { id: "powerdown", name: "Power-down", description: "Machine qui s'éteint.", category: "tech", duration: 0.6, voice: { kind: "downer", f0: 700, f1: 90 } },
  { id: "modem", name: "Modem", description: "Handshake 56k, nostalgie.", category: "tech", duration: 0.65, voice: { kind: "glitch" } },
];

const BY_ID = new Map(SFX_LIBRARY.map((item) => [item.id, item]));

export function getSfx(id: string | undefined | null): SfxDef {
  return BY_ID.get(id ?? "") ?? SFX_LIBRARY[0];
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function alloc(duration: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(duration * SFX_RATE)));
}

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function adsr(t: number, dur: number, a: number, d: number, s: number, r: number): number {
  if (t < 0 || t > dur) return 0;
  if (t < a) return a <= 0 ? 1 : t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / Math.max(1e-6, d));
  if (t > dur - r) return s * Math.max(0, (dur - t) / Math.max(1e-6, r));
  return s;
}

function addSine(
  out: Float32Array,
  freq: number,
  amp: number,
  start = 0,
  length = out.length,
  decay = 0,
): void {
  const end = Math.min(out.length, start + length);
  for (let i = start; i < end; i++) {
    const local = (i - start) / SFX_RATE;
    const env = decay > 0 ? Math.exp(-local * decay) : 1;
    out[i] += Math.sin(2 * Math.PI * freq * local) * amp * env;
  }
}

function addNoise(
  out: Float32Array,
  rng: () => number,
  amp: number,
  start: number,
  length: number,
  decay: number,
  hp = 0.4,
): void {
  const end = Math.min(out.length, start + length);
  let prev = 0;
  for (let i = start; i < end; i++) {
    const local = (i - start) / SFX_RATE;
    const white = rng() * 2 - 1;
    prev = prev * (1 - hp) + white * hp;
    const env = decay > 0 ? Math.exp(-local * decay) : 1;
    out[i] += prev * amp * env;
  }
}

function reverseInPlace(samples: Float32Array): Float32Array {
  const copy = samples.slice();
  for (let i = 0; i < samples.length; i++) samples[i] = copy[samples.length - 1 - i];
  return samples;
}

function whoosh(duration: number, bright: number, seed: string): Float32Array {
  const out = alloc(duration);
  const rng = mulberry32(seedOf(seed));
  for (let i = 0; i < out.length; i++) {
    const t = i / SFX_RATE;
    const sweep = t / duration;
    const hp = 0.15 + sweep * bright;
    const white = rng() * 2 - 1;
    const filtered = white * hp + (i ? out[i - 1] * (1 - hp) * 0.35 : 0);
    const env = adsr(t, duration, 0.04, duration * 0.35, 0.55, duration * 0.4);
    out[i] = filtered * env * 0.85;
  }
  return out;
}

function renderVoice(id: string, def: SfxDef): Float32Array {
  const v = def.voice;
  const rng = mulberry32(seedOf(id));
  const n = Math.round(def.duration * SFX_RATE);
  const dur = def.duration;

  switch (v.kind) {
    case "whoosh": {
      const out = whoosh(dur, v.bright ?? 0.7, id);
      return v.reverse ? reverseInPlace(out) : out;
    }
    case "hit": {
      const out = alloc(dur);
      addSine(out, v.f0 ?? 60, 0.95, 0, n, v.decay ?? 12);
      addSine(out, v.f1 ?? 120, 0.35, 0, n, (v.decay ?? 12) + 4);
      addNoise(out, rng, v.noiseAmp ?? 0.4, 0, Math.round(0.1 * SFX_RATE), 36);
      return out;
    }
    case "click": {
      const out = alloc(dur);
      addNoise(out, rng, v.noiseAmp ?? 0.7, 0, Math.round(0.014 * SFX_RATE), 160);
      addSine(out, v.f0 ?? 2000, 0.35, 0, Math.round(0.03 * SFX_RATE), 80);
      return out;
    }
    case "tone": {
      const out = alloc(dur);
      const freqs = v.freqs ?? [440];
      freqs.forEach((freq, index) => {
        const start = Math.round(index * 0.12 * SFX_RATE);
        addSine(out, freq, 0.42, start, n, v.decay ?? 12);
      });
      return out;
    }
    case "riser": {
      const out = alloc(dur);
      const f0 = v.f0 ?? 180;
      const f1 = v.f1 ?? 1400;
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const p = t / dur;
        const freq = f0 + p * p * (f1 - f0);
        const env = Math.pow(p, 1.35) * (1 - Math.pow(p, 8));
        out[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.7 + (rng() * 2 - 1) * 0.1 * p;
      }
      return out;
    }
    case "downer": {
      const out = alloc(dur);
      const f0 = v.f0 ?? 800;
      const f1 = v.f1 ?? 80;
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const p = t / dur;
        const freq = f0 + p * (f1 - f0);
        const env = adsr(t, dur, 0.02, 0.12, 0.7, dur * 0.45);
        out[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.85;
        out[i] += Math.sin(2 * Math.PI * freq * 2 * t) * env * 0.18;
      }
      return out;
    }
    case "glitch": {
      const out = alloc(dur);
      let i = 0;
      while (i < n) {
        const burst = Math.round((0.008 + rng() * 0.03) * SFX_RATE);
        const gap = Math.round(rng() * 0.025 * SFX_RATE);
        const freq = 200 + rng() * 2400;
        const kind = rng();
        for (let k = 0; k < burst && i + k < n; k++) {
          const t = k / SFX_RATE;
          const sample =
            kind < 0.45
              ? rng() * 2 - 1
              : kind < 0.8
                ? Math.sign(Math.sin(2 * Math.PI * freq * t))
                : Math.sin(2 * Math.PI * freq * t);
          out[i + k] += sample * 0.55;
        }
        i += burst + gap;
      }
      return out;
    }
    case "sparkle": {
      const out = alloc(dur);
      (v.freqs ?? [2480, 3120, 3720]).forEach((freq, index) => {
        addSine(out, freq, 0.28 - index * 0.04, Math.round(index * 0.05 * SFX_RATE), n, 7 + index);
      });
      return out;
    }
    case "noise": {
      const out = alloc(dur);
      addNoise(out, rng, v.noiseAmp ?? 0.4, 0, n, v.decay ?? 2, v.hp ?? 0.5);
      return out;
    }
    case "beep": {
      const out = alloc(dur);
      const pulses = v.pulses ?? 1;
      const freq = v.f0 ?? 880;
      for (let p = 0; p < pulses; p++) {
        const start = Math.round((p * dur) / pulses * SFX_RATE);
        addSine(out, freq, 0.5, start, Math.round(0.09 * SFX_RATE), 14);
      }
      return out;
    }
    case "kick": {
      const out = alloc(dur);
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const freq = (v.f0 ?? 60) * Math.exp(-t * 18);
        const env = Math.exp(-t * 10);
        out[i] = Math.sin(2 * Math.PI * freq * t) * env;
      }
      addNoise(out, rng, 0.25, 0, Math.round(0.02 * SFX_RATE), 80);
      return out;
    }
    case "hat": {
      const out = alloc(dur);
      addNoise(out, rng, 0.7, 0, n, 55, 0.85);
      return out;
    }
    case "clap": {
      const out = alloc(dur);
      addNoise(out, rng, 0.7, 0, Math.round(0.012 * SFX_RATE), 90, 0.7);
      addNoise(out, rng, 0.55, Math.round(0.018 * SFX_RATE), Math.round(0.02 * SFX_RATE), 70, 0.7);
      return out;
    }
    case "cymbal": {
      const out = alloc(dur);
      addNoise(out, rng, 0.7, 0, n, v.reverse ? 1.2 : 6, 0.8);
      addSine(out, 3200, 0.12, 0, n, 8);
      addSine(out, 4800, 0.08, 0, n, 10);
      return v.reverse ? reverseInPlace(out) : out;
    }
    case "boing": {
      const out = alloc(dur);
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const freq = (v.f0 ?? 280) * (1 + 0.55 * Math.exp(-t * 8) * Math.cos(2 * Math.PI * 9 * t));
        const env = Math.exp(-t * 5);
        out[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.85;
      }
      return out;
    }
    case "laser": {
      const out = alloc(dur);
      const f0 = v.f0 ?? 1600;
      const f1 = v.f1 ?? 200;
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const p = t / dur;
        const freq = f0 + p * (f1 - f0);
        const env = adsr(t, dur, 0.01, 0.05, 0.5, 0.12);
        out[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.8;
      }
      return out;
    }
    case "heartbeat": {
      const out = alloc(dur);
      const period = 60 / (v.bpm ?? 72);
      for (const offset of [0, 0.18]) {
        const start = Math.round(offset * SFX_RATE);
        addSine(out, 48, 0.9, start, Math.round(0.12 * SFX_RATE), 18);
        addSine(out, 96, 0.3, start, Math.round(0.12 * SFX_RATE), 22);
      }
      const second = Math.round(period * SFX_RATE);
      if (second + 2000 < n) {
        addSine(out, 48, 0.7, second, Math.round(0.12 * SFX_RATE), 18);
        addSine(out, 96, 0.22, second, Math.round(0.12 * SFX_RATE), 22);
      }
      return out;
    }
    case "air": {
      const out = alloc(dur);
      addNoise(out, rng, 0.55, 0, n, 4, 0.25);
      return out;
    }
    case "chime": {
      const out = alloc(dur);
      (v.freqs ?? [880, 1320]).forEach((freq, index) => {
        addSine(out, freq, 0.38, Math.round(index * 0.07 * SFX_RATE), n, 8);
      });
      return out;
    }
    case "shutter": {
      const out = alloc(dur);
      const click = Math.round(0.012 * SFX_RATE);
      addNoise(out, rng, 0.75, 0, click, 160);
      addNoise(out, rng, 0.65, Math.round(0.09 * SFX_RATE), click, 160);
      return out;
    }
    case "type": {
      const out = alloc(dur);
      for (const at of [0, 0.09, 0.2]) {
        addNoise(out, rng, 0.55, Math.round(at * SFX_RATE), Math.round(0.014 * SFX_RATE), 150);
        addSine(out, 2100, 0.2, Math.round(at * SFX_RATE), Math.round(0.03 * SFX_RATE), 80);
      }
      return out;
    }
    case "sweep": {
      const out = alloc(dur);
      const f0 = v.f0 ?? 400;
      const f1 = v.f1 ?? 1600;
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const p = t / dur;
        const freq = f0 + p * (f1 - f0);
        const env = adsr(t, dur, 0.03, 0.1, 0.7, 0.12);
        out[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.65;
        out[i] += (rng() * 2 - 1) * (v.noiseAmp ?? 0.1) * env;
      }
      return out;
    }
    default:
      return whoosh(dur, 0.7, id);
  }
}

const SAMPLE_CACHE = new Map<string, Float32Array>();

/** Échantillons du SFX, mis en cache (déterministe). */
export function synthesizeSfx(id: string): Float32Array {
  const cached = SAMPLE_CACHE.get(id);
  if (cached) return cached;
  const def = getSfx(id);
  const raw = renderVoice(id, def);
  const out = new Float32Array(raw.length);
  let peak = 1e-6;
  for (let i = 0; i < raw.length; i++) peak = Math.max(peak, Math.abs(raw[i]));
  const gain = peak > 1 ? 0.95 / peak : 0.95;
  for (let i = 0; i < raw.length; i++) out[i] = clampSample(raw[i] * gain);
  SAMPLE_CACHE.set(id, out);
  return out;
}

export function sfxWavBytes(id: string): Uint8Array {
  return encodeWav(synthesizeSfx(id), SFX_RATE);
}

export function sfxObjectUrl(id: string): string {
  const bytes = sfxWavBytes(id);
  return URL.createObjectURL(new Blob([bytes.slice()], { type: "audio/wav" }));
}

/** Crêtes pour la forme d'onde de la timeline. */
export function peaksOf(samples: Float32Array, bars = 28): number[] {
  if (!samples.length) return [];
  const size = Math.max(1, Math.floor(samples.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    let max = 0;
    const start = i * size;
    const end = Math.min(samples.length, start + size);
    for (let j = start; j < end; j++) max = Math.max(max, Math.abs(samples[j]));
    peaks.push(Math.min(1, max));
  }
  return peaks;
}

/**
 * Mixe tous les clips SFX sur un lit de la durée du plan.
 *
 * Les identifiants inconnus sont ignorés. Retourne `null` s'il n'y a rien à
 * mixer — le graphe n'ouvre alors pas d'entrée voix fantôme.
 */
export function mixProjectSfx(clips: Clip[], duration: number): Uint8Array | null {
  const items = clips.filter((clip) => clip.track === "sfx" && clip.sfxId);
  if (!items.length || !(duration > 0)) return null;

  const total = Math.ceil(duration * SFX_RATE);
  const bed = new Float32Array(total);

  for (const clip of items) {
    const samples = synthesizeSfx(clip.sfxId ?? "");
    const start = Math.max(0, Math.floor(clip.start * SFX_RATE));
    for (let i = 0; i < samples.length && start + i < total; i++) {
      bed[start + i] += samples[i];
    }
  }

  let peak = 0;
  for (let i = 0; i < bed.length; i++) peak = Math.max(peak, Math.abs(bed[i]));
  if (peak < 1e-5) return null;
  const gain = peak > 1 ? 0.95 / peak : 1;
  if (gain !== 1) {
    for (let i = 0; i < bed.length; i++) bed[i] *= gain;
  }
  return encodeWav(bed, SFX_RATE);
}
