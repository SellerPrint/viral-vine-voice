import { describe, expect, it } from "vitest";

import { arrayBufferToBase64, base64ToBytes, bytesToBase64, exactArrayBuffer } from "./base64";

describe("base64", () => {
  it("effectue un aller-retour sur du texte ASCII", () => {
    const bytes = new TextEncoder().encode("Hello, world!");
    expect(new TextDecoder().decode(base64ToBytes(bytesToBase64(bytes)))).toBe("Hello, world!");
  });

  it("gère les octets binaires arbitraires", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 254]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("gère un tampon vide", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
    expect(base64ToBytes("").byteLength).toBe(0);
  });

  it("produit le même résultat que l'encodage de référence", () => {
    const bytes = new TextEncoder().encode("ViralDub");
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("traite un contenu plus grand que la taille de tranche", () => {
    // Au-delà de 0x8000, un appel unique à String.fromCharCode déborde la pile.
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const roundTripped = base64ToBytes(bytesToBase64(bytes));
    expect(roundTripped.byteLength).toBe(bytes.byteLength);
    expect(roundTripped[199_999]).toBe(bytes[199_999]);
  });

  it("encode un ArrayBuffer", () => {
    const buffer = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(arrayBufferToBase64(buffer)).toBe(Buffer.from("abc").toString("base64"));
  });
});

describe("exactArrayBuffer", () => {
  it("retourne un tampon dimensionné à la vue", () => {
    const view = new Uint8Array(new ArrayBuffer(100), 10, 20);
    expect(exactArrayBuffer(view).byteLength).toBe(20);
  });

  it("copie les octets de la vue et non ceux du tampon complet", () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5]);
    const view = backing.subarray(1, 4);
    expect(Array.from(new Uint8Array(exactArrayBuffer(view)))).toEqual([2, 3, 4]);
  });
});
