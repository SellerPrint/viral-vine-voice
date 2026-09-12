import { describe, expect, it } from "vitest";

import { DEFAULT_MASKS, SUBTITLE_PRESETS, TARGET_LANGUAGES } from "@/lib/video/presets";
import { SOURCE_LANGUAGES } from "@/lib/languages";
import { projectPreset } from "@/lib/editor/project";
import type { Project } from "@/lib/editor/types";

import { appliquerConfiguration, configurationDuProjet } from "@/lib/editor/appliquer-config";

/**
 * La porte partagée du fichier et de l'agent.
 *
 * Ces cas existent parce que le chemin a été extrait de l'onglet Projet pour
 * être aussi celui du volet MCP : ce qui est vérifié ici, c'est que la
 * extraction n'a rien changé — mêmes fusions, mêmes refus, même bornage à la
 * durée réelle du plan — et que les deux portes produisent des projets
 * identiques à partir du même document.
 */

const projetDeBase = (): Project => ({
  name: "plan de test",
  source: null,
  clips: [],
  masks: DEFAULT_MASKS.map((zone) => ({ ...zone })),
  presetId: "capcut-pop",
  overrides: {},
  wordByWord: false,
  boxOpacity: 0.92,
  removeOriginalAudio: false,
  ambienceLevel: 0.25,
  cutSilences: true,
  transition: "none",
  transitionDuration: 0.25,
  mirror: false,
  filterId: "none",
  upscale: "none",
  maskStrength: "medium",
  sourceLanguage: SOURCE_LANGUAGES[0],
  targetLanguage: TARGET_LANGUAGES[0],
  ttsProvider: "elevenlabs",
  clonedVoiceId: "voix-secrete-de-l-utilisateur",
  quality: "standard",
});

const journal = () => {
  const patchs: Partial<Project>[] = [];
  const avis: { kind: string; text: string }[] = [];
  return {
    cible: {
      patch: (patch: Partial<Project>) => patchs.push(patch),
      notify: (a: { kind: "ok" | "warn" | "error"; text: string }) => avis.push(a),
    },
    patchs,
    avis,
  };
};

describe("appliquerConfiguration", () => {
  it("applique réglages, masques et montage, dans le même ordre que le bouton Importer", () => {
    const projet = projetDeBase();
    const document = JSON.stringify({
      app: "viraldub",
      version: 2,
      presetId: "capcut-classic",
      options: { wordByWord: true, transition: "fade", subtitleOpacity: 0.5 },
      masks: [{ id: "bottom", x: 0, y: 0.6, w: 1, h: 0.2, enabled: true }],
      timeline: {
        clips: [{ track: "subs", start: 0, duration: 1.4, text: "une ligne posée par l'agent" }],
        cuts: [{ start: 2, duration: 0.4 }],
      },
      subtitle: { fontsize: 96, uppercase: true },
    });

    const { cible, patchs, avis } = journal();
    expect(appliquerConfiguration(document, projet, cible, "agent")).toBe(true);

    const fusion = Object.assign({}, ...patchs) as Partial<Project>;
    expect(fusion.presetId).toBe("capcut-classic");
    expect(fusion.wordByWord).toBe(true);
    expect(fusion.boxOpacity).toBe(0.5);
    expect(fusion.overrides).toMatchObject({ fontsize: 96, uppercase: true });
    expect(fusion.masks?.find((zone) => zone.id === "bottom")).toMatchObject({
      y: 0.6,
      enabled: true,
    });
    expect(fusion.clips).toHaveLength(2); // un bloc + une coupe
    expect(fusion.clips?.[0].text).toBe("une ligne posée par l'agent");
    expect(avis.at(-1)).toMatchObject({ kind: "ok" });
    expect(avis.at(-1)?.text).toContain("Montage venu de l'agent");
  });

  it("garde la voix clonée de l'utilisateur et n'en lit jamais dans le document", () => {
    const projet = projetDeBase();
    const { cible, patchs } = journal();
    // une tentative de faire entrer un identifiant par le fichier
    appliquerConfiguration(
      JSON.stringify({ app: "viraldub", version: 2, options: { clonedVoiceId: "une-autre-voix" } }),
      projet,
      cible,
      "fichier",
    );
    const fusion = Object.assign({}, ...patchs) as Partial<Project>;
    expect(fusion.clonedVoiceId).toBeUndefined();
    expect(projet.clonedVoiceId).toBe("voix-secrete-de-l-utilisateur");
  });

  it("refuse un document qui n'est pas une configuration de l'atelier, sans rien toucher", () => {
    const { cible, patchs, avis } = journal();
    expect(appliquerConfiguration('{"app":"autre-chose"}', projetDeBase(), cible, "agent")).toBe(
      false,
    );
    expect(patchs).toHaveLength(0);
    expect(avis[0]?.kind).toBe("error");
  });

  it("refuse une clé inventée plutôt que de l'ignorer", () => {
    // le `subtitleSchema` de l'app est strict : un agent qui enverrait
    // `xAnchor` ou `fps` obtient un refus nommé, pas un reglage muet
    const { cible, patchs, avis } = journal();
    expect(
      appliquerConfiguration(
        JSON.stringify({ app: "viraldub", version: 2, subtitle: { xAnchor: 0.4 } }),
        projetDeBase(),
        cible,
        "agent",
      ),
    ).toBe(false);
    expect(patchs).toHaveLength(0);
    expect(avis[0]?.text).toMatch(/subtitle|xAnchor|inconnu/i);
  });

  it("écarte les segments hors durée et le dit", () => {
    const projet = {
      ...projetDeBase(),
      // seul le champ `duration` du média compte pour le bornage
      source: { duration: 2 },
    } as unknown as Project;
    const { cible, patchs, avis } = journal();
    appliquerConfiguration(
      JSON.stringify({
        app: "viraldub",
        version: 2,
        timeline: {
          clips: [
            { track: "subs", start: 0, duration: 1 },
            { track: "subs", start: 90, duration: 1 },
          ],
          cuts: [],
        },
      }),
      projet,
      cible,
      "agent",
    );
    expect((Object.assign({}, ...patchs) as Partial<Project>).clips).toHaveLength(1);
    expect(avis.at(-1)?.text).toMatch(/1 segment\(s\) hors durée écartés/);
    expect(avis.at(-1)?.kind).toBe("warn");
  });

  it("fait le voyage dans les deux sens sans perte", () => {
    const projet = {
      ...projetDeBase(),
      clips: [{ id: "b1", track: "subs", start: 0.5, duration: 1.2, text: "allée" }],
      overrides: { fontsize: 88, yAnchor: 0.77 },
    } as Project;
    const { cible, patchs } = journal();
    appliquerConfiguration(configurationDuProjet(projet), projetDeBase(), cible, "fichier");
    const fusion = Object.assign({}, ...patchs) as Partial<Project>;
    expect(fusion.overrides).toEqual(projet.overrides);
    expect(fusion.clips).toHaveLength(1);
    expect(fusion.clips?.[0].text).toBe("allée");
    // et le corps survit au preset, ce que la version 2 du fichier a ajouté
    expect(projectPreset({ ...projetDeBase(), ...fusion })).toEqual(
      projectPreset({ ...projet, overrides: projet.overrides }),
    );
    expect(SUBTITLE_PRESETS.some((p) => p.id === fusion.presetId)).toBe(true);
  });
});
