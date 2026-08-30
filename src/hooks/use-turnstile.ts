import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Widget Cloudflare Turnstile.
 *
 * Le widget n'est monté que si `VITE_TURNSTILE_SITE_KEY` est défini : en
 * développement local, sans clé, le hook est inerte et le traitement reste
 * disponible (la limitation de débit serveur s'applique dans tous les cas).
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "flexible" | "compact";
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Turnstile indisponible")));
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile indisponible"));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

export function useTurnstile() {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const enabled = Boolean(siteKey);

  const widgetIdRef = useRef<string | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  /**
   * Callback ref plutôt que `useRef`.
   *
   * Le conteneur n'est monté qu'une fois une vidéo importée. Avec un `useRef`,
   * l'effet s'exécutait au premier rendu — quand `ref.current` valait encore
   * `null` — puis ne se relançait jamais, ses dépendances (`enabled`,
   * `siteKey`) étant inchangées et une ref ne provoquant pas de re-rendu. Le
   * widget n'était donc jamais rendu : ni jeton, ni erreur, et un bouton
   * définitivement grisé. Passer par un state force l'effet à se relancer au
   * moment exact où le nœud entre dans le DOM.
   */
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);

  useEffect(() => {
    if (!enabled || !container) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(container, {
          sitekey: siteKey!,
          theme: "dark",
          size: "flexible",
          callback: (value) => {
            setToken(value);
            setFailed(false);
          },
          "error-callback": () => {
            setToken(undefined);
            setFailed(true);
          },
          "expired-callback": () => setToken(undefined),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Le widget peut déjà avoir été retiré avec son conteneur.
        }
      }
      widgetIdRef.current = null;
    };
  }, [enabled, siteKey, container]);

  const reset = useCallback(() => {
    setToken(undefined);
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  return {
    /** Le widget est configuré et doit être affiché. */
    enabled,
    /** Conteneur à monter dans l'arbre React. */
    containerRef,
    /** Jeton à transmettre aux appels serveur. */
    token,
    /**
     * Prêt à lancer un traitement.
     *
     * `failed` débloque volontairement le bouton : si le widget ne peut pas se
     * charger (réseau, bloqueur de pub, CSP), l'utilisateur restait sinon
     * bloqué sans aucun recours, face à un bouton grisé et sans explication.
     * On laisse tenter — le serveur, lui, refuse toujours un jeton absent ou
     * invalide, donc la protection n'est pas affaiblie.
     */
    ready: !enabled || Boolean(token) || failed,
    failed,
    reset,
  };
}
