import { useEffect, useMemo, useRef } from "react";

import { useEditor } from "./editor-context";

/**
 * Joue les clips SFX calés sur la tête de lecture, en parallèle de la vidéo.
 *
 * Les `<audio>` restent hors DOM : on n'a pas besoin de les montrer, seulement
 * de les synchroniser. Un écart de plus de 300 ms (seek, coupe) recale.
 */
export function SfxPlayback() {
  const { project, ui } = useEditor();
  const nodes = useRef(new Map<string, HTMLAudioElement>());

  const clips = useMemo(
    () => project.clips.filter((clip) => clip.track === "sfx" && clip.audioUrl),
    [project.clips],
  );

  useEffect(() => {
    const keep = new Set(clips.map((clip) => clip.id));
    for (const [id, audio] of nodes.current) {
      if (!keep.has(id)) {
        audio.pause();
        audio.removeAttribute("src");
        nodes.current.delete(id);
      }
    }
    for (const clip of clips) {
      if (!clip.audioUrl) continue;
      let audio = nodes.current.get(clip.id);
      if (!audio) {
        audio = new Audio(clip.audioUrl);
        audio.preload = "auto";
        nodes.current.set(clip.id, audio);
      } else if (audio.src !== clip.audioUrl) {
        audio.src = clip.audioUrl;
      }
    }
  }, [clips]);

  useEffect(() => {
    if (!ui.playing) {
      for (const audio of nodes.current.values()) audio.pause();
      return;
    }
    for (const clip of clips) {
      const audio = nodes.current.get(clip.id);
      if (!audio) continue;
      const local = ui.playhead - clip.start;
      if (local >= 0 && local < clip.duration) {
        if (audio.paused) {
          try {
            audio.currentTime = local;
          } catch {
            /* metadata pas encore là */
          }
          void audio.play().catch(() => {});
        } else if (Math.abs(audio.currentTime - local) > 0.3) {
          try {
            audio.currentTime = Math.max(0, local);
          } catch {
            /* ignore */
          }
        }
      } else if (!audio.paused) {
        audio.pause();
      }
    }
  }, [ui.playing, ui.playhead, clips]);

  useEffect(() => {
    const alive = nodes.current;
    return () => {
      for (const audio of alive.values()) {
        audio.pause();
        audio.removeAttribute("src");
      }
      alive.clear();
    };
  }, []);

  return null;
}
