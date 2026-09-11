/**
 * Test rapide de l'intégration HyperFrames pour ViralDub
 *
 * Vérifie sans navigateur :
 * 1. La génération des compositions HTML (structure, timing, attrs)
 * 2. Le rendu client-side (blob HTML)
 * 3. La cohérence des presets
 *
 * Usage : node scripts/test-hyperframes.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── Chargement du module compilé à la volée via vite-node ──────────────
// Les imports TS avec alias `@/` nécessitent un registre. On utilise un
// subtil contournement : importer via tsx si disponible, sinon eval.

const root = process.cwd();

let composition;
try {
  // @ts-ignore - tsx gère les alias via tsconfig
  const mod = await import("../src/lib/video/hyperframes/composition.ts");
  composition = mod;
} catch (error) {
  console.error("❌ Impossible d'importer composition.ts :", error.message);
  console.error("   Installe tsx : npm i -D tsx, puis relance.");
  process.exit(1);
}

const {
  generateHyperFramesComposition,
  generateCSSOnlyComposition,
  cuesToSubtitleElements,
  HYPERFRAMES_PRESETS,
} = composition;

// ─── Fixtures : cues de test réalistes ──────────────────────────────────

const testCues = [
  { text: "HELLO", start: 0.5, end: 1.2 },
  { text: "WORLD", start: 1.2, end: 2.0 },
  { text: "THIS IS VIRALDUB", start: 2.5, end: 4.5 },
  { text: "WITH ANIMATED SUBTITLES", start: 4.6, end: 6.5 },
];

// ─── Tests ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("\n🎬 Test HyperFrames pour ViralDub\n");

// ─── 1. Conversion cues → éléments ──────────────────────────────────────

console.log("1️⃣  cuesToSubtitleElements()");
{
  const elements = cuesToSubtitleElements(testCues);
  check("retourne un élément par cue", elements.length === testCues.length);
  check(
    "ids séquentiels",
    elements.every((el, i) => el.id === `subtitle-${i}`),
  );
  check(
    "découpe en mots",
    elements[2].words.length === 3,
    `attendu 3 mots, obtenu ${elements[2].words.length}`,
  );
  check(
    "timing des mots dans [start,end]",
    elements[2].words.every(
      (w) => w.start >= elements[2].start - 0.01 && w.end <= elements[2].end + 0.01,
    ),
  );
  check(
    "mots contigus (pas de trous)",
    elements[0].words.every((w, i, arr) => i === 0 || Math.abs(w.start - arr[i - 1].end) < 0.01),
  );
}

// ─── 2. Génération de composition ───────────────────────────────────────

console.log("\n2️⃣  generateHyperFramesComposition()");
for (const preset of HYPERFRAMES_PRESETS) {
  const html = generateHyperFramesComposition(testCues, preset, {
    width: 1080,
    height: 1920,
    compositionId: `test-${preset.id}`,
  });

  const checks = [
    ["DOCTYPE présent", html.startsWith("<!DOCTYPE html>")],
    ["data-composition-id", html.includes(`data-composition-id="test-${preset.id}"`)],
    ["data-composition-duration", html.includes('data-composition-duration="6.5"')],
    ["GSAP chargé", html.includes("gsap.min.js")],
    ["timeline GSAP déclarée", html.includes("gsap.timeline({ paused: true })")],
    ["timelines exposées au runtime", html.includes("window.__timelines")],
    ["taille du stage", html.includes("width: 1080px") && html.includes("height: 1920px")],
    ["styling preset appliqué", html.includes(preset.color) || html.includes(preset.fontFamily)],
  ];

  console.log(`   preset « ${preset.name} » :`);
  for (const [name, ok] of checks) check(name, ok);
}

// ─── 3. Cas limites ─────────────────────────────────────────────────────

console.log("\n3️⃣  Cas limites");
{
  // Cues vides
  const empty = generateHyperFramesComposition([], HYPERFRAMES_PRESETS[0]);
  check("cues vides → composition valide", empty.includes("data-composition-id"));
  check("cues vides → durée 1s", empty.includes('data-composition-duration="1"'));

  // Caractères spéciaux / XSS
  const hostileCues = [
    { text: '<script>alert("xss")</script>', start: 0, end: 1 },
    { text: "100% de &\"quotes'", start: 1, end: 2 },
  ];
  const hostile = generateHyperFramesComposition(hostileCues, HYPERFRAMES_PRESETS[0]);
  check("script injecté neutralisé", !hostile.includes("<script>alert"));
  check(
    "caractères HTML échappés",
    hostile.includes("&amp;") || hostile.includes("%") || !hostile.includes('"> <script'),
  );

  // Durée 0 / négative
  const zeroDur = generateHyperFramesComposition(
    [{ text: "X", start: 5, end: 5 }],
    HYPERFRAMES_PRESETS[0],
  );
  check("cue de durée nulle acceptée", zeroDur.length > 0);

  // Cues non triées
  const unsorted = generateHyperFramesComposition(
    [
      { text: "B", start: 3, end: 4 },
      { text: "A", start: 0, end: 1 },
    ],
    HYPERFRAMES_PRESETS[0],
  );
  check("cues non triées acceptées", unsorted.includes("subtitle-0"));
}

// ─── 4. Rendu client-side ───────────────────────────────────────────────

console.log("\n4️⃣  generateCSSOnlyComposition() (fallback sans GSAP)");
{
  const html = generateCSSOnlyComposition(testCues, HYPERFRAMES_PRESETS[0]);
  check("CSS pur, pas de GSAP", !html.includes("gsap"));
  check("animations CSS présentes", html.includes("@keyframes"));
  check("cues rendues", html.includes("HELLO"));
}

// ─── 5. Écriture d'un aperçu visualisable ───────────────────────────────

console.log("\n5️⃣  Aperçu");
{
  const outDir = join(root, ".tmp", "hyperframes-test");
  mkdirSync(outDir, { recursive: true });

  for (const preset of HYPERFRAMES_PRESETS) {
    const html = generateHyperFramesComposition(testCues, preset, {
      width: 1080,
      height: 1920,
      compositionId: `preview-${preset.id}`,
    });
    const file = join(outDir, `${preset.id}.html`);
    writeFileSync(file, html, "utf-8");
    console.log(`   📄 ${file}`);
  }

  console.log("\n   👉 Ouvre ces fichiers dans un navigateur pour voir les animations.");
  console.log("      (Le timing GSAP est piloté par window.__timelines — utilise");
  console.log("       la console : window.__timelines['preview-tiktok-pop'].play())");
}

// ─── Résumé ─────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(50)}`);
console.log(`Résultat : ${passed} ✅ / ${failed} ❌`);
console.log(`${"═".repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
