import { describe, expect, it, vi } from "vitest";

import { isDetached, writeFileSafe } from "./ffmpeg-client";

/**
 * Reproduit le comportement de `FFmpeg.writeFile()` : le buffer passé est
 * ajouté aux transférables de `postMessage`, donc détaché côté appelant.
 */
function makeFakeFfmpeg() {
  const writes: { path: string; bytes: number[] }[] = [];
  const writeFile = vi.fn(async (path: string, data: Uint8Array) => {
    writes.push({ path, bytes: Array.from(data) });
    // Simule le transfert : le buffer reçu devient inutilisable.
    structuredClone(data.buffer, { transfer: [data.buffer] });
  });
  return { ff: { writeFile } as never, writes };
}

describe("writeFileSafe", () => {
  it("ne détache pas le buffer de l'appelant", async () => {
    const { ff } = makeFakeFfmpeg();
    const source = new Uint8Array([1, 2, 3, 4]);

    await writeFileSafe(ff, "input.mp4", source);

    // C'est tout l'enjeu : sans la copie, byteLength tomberait à 0 et le
    // rendu suivant échouerait avec « An ArrayBuffer is detached ».
    expect(source.byteLength).toBe(4);
    expect(isDetached(source)).toBe(false);
  });

  it("permet de réutiliser les mêmes octets plusieurs fois", async () => {
    const { ff, writes } = makeFakeFfmpeg();
    const source = new Uint8Array([9, 8, 7]);

    // Cas réel : un aperçu, puis un second aperçu, puis le rendu final.
    await writeFileSafe(ff, "preview-1.mp4", source);
    await writeFileSafe(ff, "preview-2.mp4", source);
    await writeFileSafe(ff, "render.mp4", source);

    expect(writes).toHaveLength(3);
    // Chaque écriture doit avoir reçu les données réelles, pas un tableau vide.
    for (const write of writes) {
      expect(write.bytes).toEqual([9, 8, 7]);
    }
  });

  it("transmet bien le contenu attendu", async () => {
    const { ff, writes } = makeFakeFfmpeg();
    await writeFileSafe(ff, "font.ttf", new Uint8Array([42]));
    expect(writes[0]).toEqual({ path: "font.ttf", bytes: [42] });
  });

  it("donne un message actionnable si les octets sont déjà perdus", async () => {
    const { ff } = makeFakeFfmpeg();
    await expect(writeFileSafe(ff, "input.mp4", new Uint8Array(0))).rejects.toThrow(
      /Réimporte la vidéo/,
    );
  });
});

describe("isDetached", () => {
  it("détecte un buffer transféré", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(isDetached(bytes)).toBe(false);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(isDetached(bytes)).toBe(true);
  });
});
