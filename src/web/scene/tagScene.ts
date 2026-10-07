/**
 * The masthead's 3D scene: SameSame's price tags, extruded from the logo's
 * shape, hang from a lit rail over a receding grid. They drop in out of order,
 * sort themselves by price and the lowest lights up. While a search runs they
 * keep reshuffling. Imported lazily so three.js stays out of the first load.
 */

import * as THREE from "three";
import { HERO_TAGS, priceRanks, settledAt, slotX, tagPose } from "./motion";

const AMBER = new THREE.Color("#ff7a1a");
const BENCH = new THREE.Color("#08090b");
const TAG_W = 0.92;
const TAG_H = 1.18;
const RAIL_Y = 1.25;
const STRING = 0.5;

export type TagScene = { setBusy(busy: boolean): void; resize(): void; dispose(): void };

/** A shelf tag hanging point-up, with the logo's punched hole near the point. */
function tagShape(): THREE.Shape {
  const w = TAG_W / 2;
  const roof = 0.26;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(w, -roof);
  s.lineTo(w, -TAG_H);
  s.lineTo(-w, -TAG_H);
  s.lineTo(-w, -roof);
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, -0.17, 0.055, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

function faceTexture(shop: string, price: number, lit: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 736;
  c.height = 800;
  const g = c.getContext("2d")!;
  g.scale(2, 2);
  g.textAlign = "center";
  g.fillStyle = lit ? "#211507" : "#f4f1ea";
  const label = `S$${price}`;
  let size = 112;
  do g.font = `800 ${size}px Archivo, system-ui, sans-serif`;
  while (g.measureText(label).width > 320 && (size -= 4) > 40);
  g.fillText(label, 184, 210);
  g.font = "600 34px 'Atkinson Hyperlegible Next', system-ui, sans-serif";
  g.globalAlpha = lit ? 0.8 : 0.6;
  g.fillText(shop, 184, 290);
  g.globalAlpha = lit ? 0.5 : 0.35;
  g.fillRect(64, 326, 240, 3);
  g.font = "600 26px ui-monospace, Consolas, monospace";
  g.fillText(lit ? "LOWEST" : "SGD", 184, 372);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A floor of glowing grid lines drifting toward the viewer, fading into fog. */
function gridFloor(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: AMBER.clone() }, uSpeed: { value: 0.15 } },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      uniform vec3 uColor;
      varying vec2 vPos;
      // Anti-aliased lines about 1px wide at any distance, at two scales.
      float grid(vec2 p, float scale) {
        vec2 q = p / scale;
        vec2 d = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
        return 1.0 - smoothstep(0.0, 1.2, min(d.x, d.y));
      }
      void main() {
        vec2 p = vPos + vec2(0.0, uTime * uSpeed);
        float minor = grid(p, 0.5) * 0.35;
        float major = grid(p, 2.0);
        float fade = smoothstep(18.0, 1.5, length(vPos * vec2(0.55, 1.0)));
        // Fine lines shimmer into moiré far away, so they fade out sooner than the major ones.
        float near = smoothstep(9.0, 3.0, length(vPos * vec2(0.55, 1.0)));
        float a = max(major * 0.5, minor * near) * fade;
        gl_FragColor = vec4(uColor * (1.0 + major * 0.4), a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -1.9, -6);
  return mesh;
}

/** Dust motes rising slowly through the light. */
function motes(count: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 22;
    pos[i * 3 + 1] = Math.random() * 8 - 2;
    pos[i * 3 + 2] = -Math.random() * 14 + 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: AMBER,
    size: 0.035,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

/** `clearOf` gives the px from the canvas's left edge that the headline covers, so tags hang clear of it. */
export function createTagScene(canvas: HTMLCanvasElement, opts: { still: boolean; clearOf?: () => number }): TagScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  // Supersample on 1x screens so the grid and tag text stay crisp; cap at 2x for speed.
  renderer.setPixelRatio(Math.min(2, Math.max(1.5, window.devicePixelRatio)));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BENCH, 7, 20);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 0.5, 9);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xfff1e0, 1.6);
  key.position.set(3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 0.9);
  rim.position.set(-6, 2, -4);
  scene.add(rim);
  const hot = new THREE.PointLight(AMBER, 0, 6, 1.6);
  scene.add(hot);

  const floor = gridFloor();
  scene.add(floor);
  const dust = motes(opts.still ? 0 : 420);
  scene.add(dust);

  // Everything that hangs lives in one group, so it can be moved beside the headline.
  const rig = new THREE.Group();
  scene.add(rig);

  const width = 5.6;
  const rail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, width + 1.6, 16),
    new THREE.MeshStandardMaterial({ color: 0x2a2e34, emissive: AMBER, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.3 }),
  );
  rail.rotation.z = Math.PI / 2;
  rail.position.y = RAIL_Y;
  rig.add(rail);

  const tags = HERO_TAGS;
  const ranks = priceRanks(tags);
  const shape = tagShape();
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3 });
  bodyGeo.translate(0, 0, -0.035);
  const edgeGeo = new THREE.EdgesGeometry(new THREE.ShapeGeometry(shape));
  const faceGeo = new THREE.PlaneGeometry(TAG_W * 0.9, TAG_W * 0.9 * (400 / 368));
  const stringGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -STRING - 0.17, 0)]);
  const stringMat = new THREE.LineBasicMaterial({ color: 0xc3cad0, transparent: true, opacity: 0.45 });
  const disposables: { dispose(): void }[] = [bodyGeo, edgeGeo, faceGeo, stringGeo, stringMat, rail.geometry, rail.material];

  const items = tags.map((t, i) => {
    const lit = ranks[i] === 0;
    const pivot = new THREE.Group(); // at the peg, so rotation is a swing on the string
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x15181d,
      metalness: 0.35,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
      emissive: AMBER,
      emissiveIntensity: 0,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = -STRING;
    const edgeMat = new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: lit ? 0.9 : 0.35 });
    const edge = new THREE.LineSegments(edgeGeo, edgeMat);
    edge.position.z = 0.051;
    body.add(edge);
    const dark = faceTexture(t.shop, t.price, false);
    const light = faceTexture(t.shop, t.price, true);
    const faceMat = new THREE.MeshBasicMaterial({ map: dark, transparent: true, toneMapped: false });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(0, -TAG_H * 0.6, 0.056);
    body.add(face);
    pivot.add(new THREE.Line(stringGeo, stringMat), body);
    rig.add(pivot);
    disposables.push(bodyMat, edgeMat, faceMat, dark, light);
    return { pivot, body, bodyMat, edgeMat, faceMat, dark, light, lit, hover: 0 };
  });

  // Order the tags land in before they sort: a fixed shuffle, so the first view is the same every time.
  const scatter = [2, 4, 0, 3, 1];
  let slots = ranks.slice();
  let busy = false;
  let shuffleFrom = slots.slice();
  let shuffleAt = 0;

  // Pointer in the canvas's own -1..1 space; outside the canvas it is past 1, so nothing is hovered.
  const pointer = new THREE.Vector2(9, 9);
  const aim = new THREE.Vector2(0, 0);
  const ray = new THREE.Raycaster();
  let hovered = -1;

  function onPointer(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  window.addEventListener("pointermove", onPointer, { passive: true });

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Fit the rig into the free space: right of the headline when there is room, else centred.
    const visibleW = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect;
    const toWorld = (px: number) => (px / w - 0.5) * visibleW;
    const clear = opts.clearOf?.() ?? 0;
    const besideText = clear > 0 && w - clear > w * 0.4;
    const left = toWorld(besideText ? clear : 16);
    const right = toWorld(w - 16);
    const scale = Math.min(1, (right - left) / (width + 1.6));
    rig.scale.setScalar(scale);
    rig.position.set((left + right) / 2, besideText ? 0.1 : -0.1, 0);
  }

  // Scene time only advances while it is drawn, so scrolling back doesn't replay the opening.
  let t = opts.still ? settledAt(tags.length) + 10 : 0;
  let last = performance.now();
  let raf = 0;
  let running = true;

  function frame() {
    const now = performance.now();
    if (!opts.still) t += Math.min(0.05, (now - last) / 1000);
    last = now;
    const opening = t < settledAt(tags.length) + 0.2;

    const target = Math.abs(pointer.x) <= 1.5 && Math.abs(pointer.y) <= 1.5 ? pointer : new THREE.Vector2();
    aim.lerp(target, 0.05);
    camera.position.x = aim.x * 0.6;
    camera.position.y = 0.5 + aim.y * 0.3;
    camera.lookAt(0, 0, 0);

    if (!opts.still) {
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(items.map((it) => it.body), false)[0];
      hovered = hit ? items.findIndex((it) => it.body === hit.object) : -1;
    }

    // While searching, tags trade places every so often.
    if (busy && t - shuffleAt > 1.3) {
      shuffleFrom = slots.slice();
      slots = slots.slice().sort(() => Math.random() - 0.5);
      shuffleAt = t;
    }
    const shuffleT = Math.min(1, (t - shuffleAt) / 0.8);
    const shuffleEase = shuffleT < 0.5 ? 2 * shuffleT * shuffleT : 1 - (-2 * shuffleT + 2) ** 2 / 2;

    items.forEach((it, i) => {
      const pose = tagPose(i, opening ? t : settledAt(tags.length), ranks, scatter, width);
      let x = pose.x;
      let swing = pose.swing;
      if (!opening) {
        const from = slotX(shuffleFrom[i], tags.length, width);
        const to = slotX(slots[i], tags.length, width);
        x = from + (to - from) * shuffleEase;
        swing = shuffleT < 1 ? -Math.sign(to - from) * Math.sin(shuffleT * Math.PI) * 0.3 : 0;
      }
      // Idle life: a slow breathing sway, and a lift toward you on hover.
      const idle = opts.still ? 0 : Math.sin(t * 0.9 + i * 1.7) * 0.035;
      it.hover += ((hovered === i ? 1 : 0) - it.hover) * 0.12;
      it.pivot.position.set(x, RAIL_Y + pose.y + it.hover * 0.12, pose.z + it.hover * 0.6);
      it.pivot.rotation.z = swing + idle;
      it.pivot.rotation.y = aim.x * 0.35 + it.hover * Math.sin(t * 2) * 0.25 + Math.sin(t * 0.6 + i) * 0.06;

      const glow = it.lit && !busy ? (opening ? pose.glow : 1) : 0;
      it.bodyMat.emissiveIntensity = glow * (1.1 + Math.sin(t * 2.4) * 0.12) + it.hover * 0.15;
      it.bodyMat.color.setHex(glow > 0.5 ? 0xff7a1a : 0x15181d);
      it.faceMat.map = glow > 0.5 ? it.light : it.dark;
      it.edgeMat.opacity = 0.35 + glow * 0.6 + it.hover * 0.4;
      if (it.lit) {
        hot.position.set(it.pivot.position.x * rig.scale.x + rig.position.x, RAIL_Y - 1, 1.2);
        hot.intensity = glow * 5;
      }
    });

    floor.material.uniforms.uTime.value = t;
    floor.material.uniforms.uSpeed.value += ((busy ? 1.4 : 0.15) - floor.material.uniforms.uSpeed.value) * 0.03;
    dust.rotation.y = t * 0.01;
    dust.position.y = (t * 0.05) % 1;
    renderer.render(scene, camera);
  }

  function loop() {
    if (!running) return;
    frame();
    raf = requestAnimationFrame(loop);
  }

  // Stop drawing when the masthead is off screen or the tab is hidden.
  const seen = new IntersectionObserver(([e]) => {
    const want = e.isIntersecting && !document.hidden && !opts.still;
    if (want && !running) {
      running = true;
      last = performance.now();
      loop();
    } else if (!want) {
      running = false;
      cancelAnimationFrame(raf);
    }
  });
  seen.observe(canvas);

  resize();
  if (opts.still) {
    running = false;
    frame();
  } else {
    loop();
  }

  return {
    setBusy(next) {
      if (next === busy) return;
      busy = next;
      if (!busy) {
        // Back to price order once the search settles.
        shuffleFrom = slots.slice();
        slots = ranks.slice();
        shuffleAt = t;
      }
      if (opts.still) frame();
    },
    resize() {
      resize();
      if (!running) frame();
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      seen.disconnect();
      window.removeEventListener("pointermove", onPointer);
      disposables.forEach((d) => d.dispose());
      floor.geometry.dispose();
      floor.material.dispose();
      dust.geometry.dispose();
      (dust.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
