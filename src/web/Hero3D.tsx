import { useEffect, useRef, useState } from "react";
import type { TagScene } from "./scene/tagScene";

/**
 * Hosts the masthead's three.js scene. three.js loads after the page, and the
 * scene is decoration (the headline says the same thing), so it is hidden from
 * screen readers and simply absent when WebGL isn't available.
 */
export function Hero3D({ busy }: { busy: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<TagScene | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    Promise.all([import("./scene/tagScene"), document.fonts?.ready])
      .then(([{ createTagScene }]) => {
        if (cancelled || !canvas.current) return;
        const el = canvas.current;
        scene.current = createTagScene(el, {
          still,
          // Only when the canvas sits behind the headline (wide layout); below it, nothing to avoid.
          clearOf: () => {
            const copy = el.parentElement?.querySelector(".masthead-copy");
            if (!copy || getComputedStyle(el).position !== "absolute") return 0;
            return copy.getBoundingClientRect().right - el.getBoundingClientRect().left + 32;
          },
        });
        setReady(true);
      })
      .catch(() => {
        // No WebGL: leave the masthead as text.
      });
    const onResize = () => scene.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => scene.current?.setBusy(busy), [busy, ready]);

  return <canvas ref={canvas} className={`hero3d${ready ? " is-ready" : ""}`} aria-hidden="true" />;
}
