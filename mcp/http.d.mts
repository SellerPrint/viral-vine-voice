/**
 * Le contrat du fil HTTP, écrit à la main pour que TypeScript n'ait pas à
 * deviner les types d'un module JavaScript sans annotation.
 *
 * Ce fichier ne fait que décrire `mcp/http.mjs`. Si les deux décrochent, c'est
 * `mcp/http.test.mjs` qui le voit — un type inventé ici ne ferait pas passer un
 * appel que le serveur refuse vraiment.
 */

export type SessionMcp = {
  session: {
    traiter: (message: unknown) => Record<string, unknown> | null;
    document: () => Record<string, unknown>;
    projetCourant: () => Record<string, unknown>;
  };
  vu: number;
  id?: string;
  collante?: boolean;
};

export type TransportMcp = {
  /** Les sessions collantes de cette instance : 0 apr un redploiement. */
  sessions: Map<string, SessionMcp>;
  fetch: (requete: Request) => Promise<Response>;
};

export type OptionsTransport = {
  /** Jeton d'accès ; absent = le fil répond 503, jamais ouvert. */
  secret?: string;
  /** Plafond du corps, en octets. */
  limiteOctets?: number;
  /** Durée de vie d'une session collante, en millisecondes. */
  dureeVieMs?: number;
  /** Au-delà, la plus ancienne session est recyclée. */
  maxSessions?: number;
  /** Cartographie de sessions partagée (un test, ou plusieurs transports). */
  sessions?: Map<string, SessionMcp>;
  /** `true` n'autorise plus `exporter_config`/`importer_config` à toucher au disque. */
  disque?: boolean;
  /** Horloge injectable, pour tester l'expiration sans attendre. */
  horloge?: () => number;
};

export function CREER_TRANSPORT(options?: OptionsTransport): TransportMcp;

export type ServeurNode = {
  serveur: import("node:http").Server;
  transport: TransportMcp;
  port: number;
};

/** Le même transport posé sur `node:http`, pour un essai local ou un client à distance. */
export function CREER_SERVEUR_NODE(
  options?: OptionsTransport & { port?: number; host?: string },
): Promise<ServeurNode>;
