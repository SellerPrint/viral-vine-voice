import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFontCache, fontUrlForLanguage, loadFont } from "./font";

describe("fontUrlForLanguage", () => {
  it("garde Roboto pour les langues a alphabet latin", () => {
    for (const code of ["en", "es", "pt", "de", "it", "nl", "id", "tr"]) {
      expect(fontUrlForLanguage(code)).toBe("/fonts/Roboto-Bold.ttf");
    }
  });

  it("choisit une police couvrant l'ecriture pour ar, hi, ja et ko", () => {
    // Roboto n'a aucun glyphe pour ces ecritures : les sous-titres sortaient
    // en carres (« tofu »), le rectangle dessine faute de glyphe.
    expect(fontUrlForLanguage("ar")).toBe("/fonts/NotoSansArabic-Bold.ttf");
    expect(fontUrlForLanguage("hi")).toBe("/fonts/NotoSansDevanagari-Bold.ttf");
    expect(fontUrlForLanguage("ja")).toBe("/fonts/NotoSansJP-Bold.otf");
    expect(fontUrlForLanguage("ko")).toBe("/fonts/NotoSansKR-Bold.otf");
  });

  it("tolere les etiquettes regionales et la casse", () => {
    expect(fontUrlForLanguage("ja-JP")).toBe("/fonts/NotoSansJP-Bold.otf");
    expect(fontUrlForLanguage("AR_SA")).toBe("/fonts/NotoSansArabic-Bold.ttf");
  });

  it("retombe sur Roboto sans code de langue", () => {
    expect(fontUrlForLanguage()).toBe("/fonts/Roboto-Bold.ttf");
    expect(fontUrlForLanguage("xx")).toBe("/fonts/Roboto-Bold.ttf");
  });
});

describe("loadFont", () => {
  beforeEach(() => {
    __resetFontCache();
    vi.unstubAllGlobals();
  });

  function stubFetch(handler: (url: string) => Response) {
    const fetchMock = vi.fn((url: string) => Promise.resolve(handler(url)));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const ok = () => new Response(new Uint8Array([1, 2, 3]));

  it("telecharge la police correspondant a la langue", async () => {
    const fetchMock = stubFetch(ok);
    await loadFont(undefined, "ja");
    expect(fetchMock).toHaveBeenCalledWith("/fonts/NotoSansJP-Bold.otf", expect.anything());
  });

  it("met en cache par langue, sans confondre deux polices", async () => {
    const fetchMock = stubFetch(ok);

    await loadFont(undefined, "ja");
    await loadFont(undefined, "ja");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Une autre langue ne doit pas recevoir la police mise en cache.
    await loadFont(undefined, "ar");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/fonts/NotoSansArabic-Bold.ttf", expect.anything());
  });

  it("retombe sur Roboto si la police specifique est absente", async () => {
    // Mieux vaut des sous-titres approximatifs qu'un rendu qui echoue.
    const fetchMock = stubFetch((url) =>
      url.includes("Arabic") ? new Response(null, { status: 404 }) : ok(),
    );

    const bytes = await loadFont(undefined, "ar");

    expect(bytes.byteLength).toBe(3);
    expect(fetchMock).toHaveBeenLastCalledWith("/fonts/Roboto-Bold.ttf", expect.anything());
  });

  it("leve si meme la police par defaut est introuvable", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    await expect(loadFont()).rejects.toThrow(/police des sous-titres/i);
  });
});
