import { useCallback, useEffect, useRef, useState } from "react";

import { appliquerConfiguration, configurationDuProjet } from "@/lib/editor/appliquer-config";
import { useEditor, useEditorActions } from "./editor-context";
import { Icon, Kv, Notice, Section } from "./ui";

/**
 * Le fil MCP, depuis l'interface.
 *
 * Le serveur ne vit pas dans la page : c'est un processus (stdio) ou une route
 * (`POST /api/mcp`) qu'un agent — Claude, Cursor, un script — appelle pour
 * composer un montage à la place de la souris. Ce volet ne fait donc pas le
 * montage : il rend l'état du fil lisible, permet de le tester sans quitter
 * l'atelier, et sert de rampe de branchement (le bloc à coller chez le client,
 * déjà rempli de l'URL de ce déploiement).
 *
 * Deux choses sont volontairement absentes :
 *
 * - le jeton n'est jamais écrit nulle part — ni localStorage, ni URL, ni
 *   historique : il tient dans l'état de ce composant, le temps de l'onglet.
 *   Un `MCP_TOKEN` qui fuiterait ouvre un atelier de montage sur une facture.
 * - aucun appel réseau sortant : tout passe par cette origine, donc la CSP
 *   existante (`connect-src 'self'`) couvre ce volet sans y toucher.
 *
 * Et une garantie de fond : « Composer un exemple » applique le document rendu
 * par le fil par `appliquerConfiguration` — la porte du bouton Importer, avec
 * `parseConfig` et le bornage à la durée réelle du plan. L'agent n'a pas de
 * chemin de travers vers la timeline.
 */

const FIL = "/api/mcp";
/** Une réponse du fil est petite par construction ; au-delà, on ne parse pas. */
const LIMITE_TEXTE = 512 * 1024;

type Ouverture = "inconnue" | "fermee" | "jeteau" | "ouverte";

type Sante = {
  serveur?: string;
  version?: string;
  outils?: number;
  dispo?: { disque?: boolean };
  sessions?: { ouvertes?: number };
};

type Reponse = {
  statut: number;
  donnees: { result?: { content?: { text?: string }[] } & Record<string, unknown> } | null;
  session: string | null;
};

async function poster(
  corps: unknown,
  options: { jeton?: string; session?: string | null; signal?: AbortSignal } = {},
): Promise<Reponse> {
  const reponse = await fetch(FIL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.jeton ? { authorization: `Bearer ${options.jeton}` } : {}),
      ...(options.session ? { "mcp-session-id": options.session } : {}),
    },
    body: JSON.stringify(corps),
    signal: options.signal,
  });
  const texte = await reponse.text();
  if (texte.length > LIMITE_TEXTE) throw new Error("réponse du fil trop volumineuse");
  return {
    statut: reponse.status,
    donnees: texte ? JSON.parse(texte) : null,
    session: reponse.headers.get("mcp-session-id"),
  };
}

/** Le texte que le fil rend dans `content[0]`, désossé s'il est JSON. */
function payload(reponse: Reponse): Record<string, unknown> {
  const texte = reponse.donnees?.result?.content?.[0]?.text;
  if (!texte) return {};
  try {
    return JSON.parse(texte) as Record<string, unknown>;
  } catch {
    return { avis: texte };
  }
}

export function AgentMcp() {
  const { project } = useEditor();
  const actions = useEditorActions();
  const [sante, setSante] = useState<Sante | null>(null);
  const [ouverture, setOuverture] = useState<Ouverture>("inconnue");
  const [jeton, setJeton] = useState("");
  const [session, setSession] = useState<string | null>(null);
  const [outils, setOutils] = useState<string[]>([]);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const controle = useRef<AbortController | null>(null);

  /** Ce que le fil dit de lui, et s'il s'ouvre. Le test est en lecture seule. */
  const regarder = useCallback(async (signaux?: AbortSignal) => {
    setErreur(null);
    try {
      const etat = await fetch(FIL, { signal: signaux });
      if (etat.ok) setSante((await etat.json()) as Sante);
      const sonde = await poster(
        { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        { signal: signaux },
      );
      // 503 : aucun jeton réglé côté serveur. 401 : un jeton est exigé, le
      // voici vide. 200 sans credentials : ce serait une porte grande ouverte,
      // et cela ne doit pas arriver — autant le dire que le laisser croire.
      setOuverture(
        sonde.statut === 503
          ? "fermee"
          : sonde.statut === 401
            ? "jeteau"
            : sonde.statut === 200
              ? "ouverte"
              : "jeteau",
      );
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        setErreur(`Fil injoignable : ${(cause as Error).message}`);
        setOuverture("inconnue");
      }
    }
  }, []);

  useEffect(() => {
    const controleur = new AbortController();
    controle.current = controleur;
    void regarder(controleur.signal);
    return () => controleur.abort();
  }, [regarder]);

  const tester = async () => {
    setEnCours("Ouverture d'une session…");
    setErreur(null);
    try {
      const ouvertureTest = await poster(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        { jeton: jeton || undefined },
      );
      if (ouvertureTest.statut !== 200) {
        setErreur(
          ouvertureTest.statut === 503
            ? "Le fil répond 503 : la variable MCP_TOKEN est absente du serveur. En local, relancez avec `MCP_TOKEN=… npm run dev`."
            : "Le fil attend un jeton : renseignez-le ci-dessus (il reste dans cette page).",
        );
        return;
      }
      setSession(ouvertureTest.session);
      const liste = await poster(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jeton: jeton || undefined, session: ouvertureTest.session },
      );
      const noms = (
        (liste.donnees?.result as { tools?: { name: string }[] } | undefined)?.tools ?? []
      ).map((outil) => outil.name);
      setOutils(noms);
      actions.notify({
        kind: "ok",
        text: `Fil ouvert : ${noms.length} outils, session ${(ouvertureTest.session ?? "").slice(0, 8)}…${
          noms.length ? ` — ${noms.slice(0, 4).join(", ")}, …` : "."
        }`,
      });
    } catch (cause) {
      setErreur(`Test échoué : ${(cause as Error).message}`);
    } finally {
      setEnCours(null);
    }
  };

  /**
   * L'agent compose sur la table actuelle : le document part, le document
   * revient, et l'atelier l'avale par la porte habituelle.
   */
  const exemple = async () => {
    setEnCours("L'agent compose…");
    setErreur(null);
    try {
      const appel = await poster(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "montage_energetique",
            arguments: { intensite: "nerveux" },
            document: JSON.parse(configurationDuProjet(project)),
          },
        },
        { jeton: jeton || undefined },
      );
      if (appel.statut !== 200) {
        setErreur(
          appel.statut === 503
            ? "Le fil répond 503 : réglez MCP_TOKEN, puis réessayez."
            : `Le fil a refusé la requête (${appel.statut}).`,
        );
        return;
      }
      const refus = (appel.donnees?.result as { content?: { text?: string }[] } | undefined)
        ?.content?.[0]?.text;
      const donnees = payload(appel);
      if (donnees.refus) {
        setErreur(String(donnees.refus));
        return;
      }
      const document = (appel.donnees?.result as { document?: unknown } | undefined)?.document;
      if (!document) {
        setErreur(`Réponse sans document${refus ? ` : ${String(refus).slice(0, 120)}` : "."}`);
        return;
      }
      appliquerConfiguration(JSON.stringify(document), project, actions, "agent");
    } catch (cause) {
      setErreur(`Compose échoué : ${(cause as Error).message}`);
    } finally {
      setEnCours(null);
    }
  };

  const origine = typeof window === "undefined" ? "" : window.location.origin;
  const blocCursor = JSON.stringify(
    {
      mcpServers: {
        "viraldub-monteur": {
          url: `${origine}${FIL}`,
          headers: { Authorization: `Bearer ${jeton || "<MCP_TOKEN>"}` },
        },
      },
    },
    null,
    2,
  );
  const blocPont = `npx -y mcp-remote ${origine ? `${origine}${FIL}` : `http://127.0.0.1:4750/`} --transport http-only${
    jeton ? ` --header "Authorization: Bearer ${jeton}"` : ""
  }`;

  const copier = async (texte: string, quoi: string) => {
    try {
      await navigator.clipboard.writeText(texte);
      actions.notify({ kind: "ok", text: `${quoi} copié dans le presse-papiers.` });
    } catch {
      actions.notify({
        kind: "warn",
        text: `Copie refusée par le navigateur : sélectionne le bloc.`,
      });
    }
  };

  return (
    <Section title="Agent de montage (MCP)" collapsible>
      <div className="flex flex-col gap-1">
        <Kv
          k="fil"
          v={
            sante
              ? `${sante.serveur ?? "viraldub-monteur"} ${sante.version ?? ""} · ${sante.outils ?? "?"} outils`
              : "aucune réponse sur /api/mcp"
          }
        />
        <Kv
          k="accès"
          v={
            ouverture === "fermee"
              ? "fermé — MCP_TOKEN non réglé"
              : ouverture === "jeteau"
                ? "jeton exigé"
                : ouverture === "ouverte"
                  ? "ouvert sans jeton (à corriger)"
                  : "à vérifier"
          }
        />
        <Kv
          k="disque"
          v={
            sante?.dispo?.disque === false
              ? "aucun fichier écrit, le document voyage"
              : sante?.dispo?.disque
                ? "écriture de fichiers autorisée"
                : "?"
          }
        />
        <Kv
          k="sessions"
          v={session ? `${(session ?? "").slice(0, 8)}…` : (sante?.sessions?.ouvertes ?? 0)}
        />
      </div>

      <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
        <input
          className="ed-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Jeton MCP (facultatif)"
          aria-label="Jeton du fil MCP"
          value={jeton}
          onChange={(event) => setJeton(event.target.value)}
        />
        <button
          type="button"
          className="ed-btn ed-btn--sm"
          onClick={() => void regarder()}
          title="Relancer l'état du fil"
        >
          <Icon name="info" size={12} />
          État
        </button>
      </div>

      <div className="ed-btn-row">
        <button
          type="button"
          className="ed-btn ed-btn--sm"
          onClick={() => void tester()}
          disabled={enCours !== null}
        >
          <Icon name="check" size={12} />
          {enCours === "Ouverture d'une session…" ? "Test en cours…" : "Tester le fil"}
        </button>
        <button
          type="button"
          className="ed-btn ed-btn--sm ed-btn--primary"
          onClick={() => void exemple()}
          disabled={enCours !== null}
          title="Envoie le montage actuel au fil, qui le recale au rythme, et l'applique ici"
        >
          <Icon name="wand" size={12} />
          {enCours === "L'agent compose…" ? "Composition…" : "Composer un exemple"}
        </button>
      </div>

      {erreur ? (
        <Notice notice={{ kind: "warn", text: erreur }} onDismiss={() => setErreur(null)} />
      ) : null}

      {outils.length > 0 ? (
        <details>
          <summary style={{ fontSize: 11, color: "var(--ed-text-dim)", cursor: "pointer" }}>
            {outils.length} outils annoncés
          </summary>
          <p className="ed-note" style={{ marginTop: 4 }}>
            {outils.join(" · ")}
          </p>
        </details>
      ) : null}

      <div className="ed-btn-row">
        <button
          type="button"
          className="ed-btn ed-btn--sm"
          onClick={() => void copier(blocCursor, "Bloc de branchement")}
        >
          <Icon name="download" size={12} />
          Copier le bloc client
        </button>
        <button
          type="button"
          className="ed-btn ed-btn--sm"
          onClick={() => void copier(blocPont, "Commande du pont")}
        >
          <Icon name="arrowRight" size={12} />
          Copier le pont stdio
        </button>
      </div>
      <pre
        className="ed-note"
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontFamily: "var(--ed-mono, ui-monospace)",
        }}
      >
        {blocCursor}
      </pre>

      <p className="ed-note">
        Le fil compose un montage — il ne rend rien, ne lit aucun média, et ne voit ni clé d'API ni
        voix clonée. Côté client : Cursor accepte <code>url</code> et <code>headers</code> ; Claude
        Desktop enregistre l'URL comme connecteur personnalisé, pas dans son fichier de config ; un
        client qui ne parle que stdio passe par le pont <code>mcp-remote</code>. Le détail est dans{" "}
        <code>mcp/MCP.md</code>.
      </p>
    </Section>
  );
}
