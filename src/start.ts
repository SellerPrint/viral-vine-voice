import { createStart, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { renderErrorPage } from "./lib/error-page";

/**
 * Distingue un appel de server function d'une navigation.
 *
 * Une page d'erreur HTML renvoyée à un appel RPC est illisible côté client :
 * le message métier (voix refusée, quota atteint, fichier trop lourd) est
 * perdu et l'interface ne peut afficher qu'une erreur générique.
 */
function isServerFnRequest(): boolean {
  try {
    const request = getRequest();
    if (new URL(request.url).pathname.includes("/_serverFn/")) return true;
    const accept = request.headers.get("accept") ?? "";
    return accept.includes("application/json");
  } catch {
    return false;
  }
}

/** Statut approprié : validation invalide, débit dépassé, ou erreur interne. */
function statusFor(error: unknown): number {
  if (error instanceof z.ZodError) return 422;
  if (error != null && typeof error === "object" && "statusCode" in error) {
    const code = Number((error as { statusCode: unknown }).statusCode);
    if (Number.isFinite(code) && code >= 400 && code < 600) return code;
  }
  return 500;
}

function messageFor(error: unknown, status: number): string {
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return first?.message ?? "Requête invalide.";
  }
  if (error instanceof Error && status !== 500) return error.message;
  // Une erreur interne inattendue ne doit rien divulguer de son origine.
  return status === 500
    ? "Une erreur interne est survenue."
    : error instanceof Error
      ? error.message
      : "Requête invalide.";
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // Les redirections et erreurs de routage TanStack doivent remonter telles
    // quelles pour que le routeur les traite.
    if (error != null && typeof error === "object" && "routerCode" in error) {
      throw error;
    }

    const status = statusFor(error);
    if (status === 500) console.error(error);

    if (isServerFnRequest()) {
      return new Response(JSON.stringify({ error: messageFor(error, status) }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }

    return new Response(renderErrorPage(), {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
