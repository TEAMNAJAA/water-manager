import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type WJob = {
  id: number; kind: string; status: string; zone_id: number | null; technician: string | null; eta: string | null;
  litres_per_day: number | null; people_per_day: number | null; note: string | null;
  problems: { at: string; by: string | null; text: string }[]; created: string; updated: string; proof: any;
};
export type WVillage = {
  id: number; name: string; simulated: boolean; lat: number | null; lon: number | null; network_id: number | null;
  level: "green" | "yellow" | "red"; score: number; rank: number; households: number; zones: { id: number; name: string }[];
  alerts: string[]; litres_lost_per_day: number | null; people_lost: number | null; burst_litres_per_hour: number | null;
  leak_started: string | null; nights: number | null; jobs: WJob[]; recent_done: WJob[];
  litres_saved_per_day: number | null; people_saved: number | null; repair_fund: number; has_main_meter: boolean;
  agencies: { name: string; kind?: string; phone?: string; email?: string; helps_with?: string; verified?: boolean }[]; currency: string;
};
type Props = {
  villages: WVillage[]; selected: number | null; night: boolean; onSelect: (id: number | null) => void;
  etaText: (j: WJob) => string | null; label: string;
};

const LEAKY = ["leak_detected", "burst_detected", "leak", "wet_ground"];
const LEVEL = { green: 0x2fa84f, yellow: 0xf2a516, red: 0xe0412f };
const PIPE_DAY = { green: 0x5f86b5, yellow: 0xf2a516, red: 0xe0412f };

const mat = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
function mesh(geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], vid?: number, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = shadow;
  o.receiveShadow = true;
  if (vid != null) o.userData.vid = vid;
  return o;
}
function between(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}
const rnd = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function layout(vs: WVillage[]) {
  const geo = vs.filter((v) => v.lat != null && v.lon != null);
  const spiral = (i: number) => {
    if (i === 0 && vs.length === 1) return new THREE.Vector2(0, 0);
    const a = i * 2.4, r = 13 + i * 4.5;
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  };
  if (geo.length === vs.length && vs.length > 1) {
    const lat = vs.map((v) => v.lat!), lon = vs.map((v) => v.lon!);
    const cx = (Math.max(...lon) + Math.min(...lon)) / 2, cz = (Math.max(...lat) + Math.min(...lat)) / 2;
    const span = Math.max(Math.max(...lon) - Math.min(...lon), Math.max(...lat) - Math.min(...lat), 1e-6);
    const R = 12 + vs.length * 5.5;
    const pts = vs.map((v) => new THREE.Vector2(((v.lon! - cx) / span) * 2 * R, -((v.lat! - cz) / span) * 2 * R));
    const ok = pts.every((p, i) => pts.every((q, k) => k === i || p.distanceTo(q) > 17));
    if (ok) return pts;
  }
  return vs.map((_, i) => spiral(i));
}

function house(vid: number, night: boolean, r: () => number) {
  const g = new THREE.Group();
  const wall = [0xf1e2c6, 0xe8d3b0, 0xf4ead8, 0xdcc8a3][Math.floor(r() * 4)];
  const roofC = [0xc0573e, 0xa8483a, 0x8e5b3c, 0x4f6d8f][Math.floor(r() * 4)];
  for (const [x, z] of [[-0.7, -0.6], [0.7, -0.6], [-0.7, 0.6], [0.7, 0.6]]) {
    const leg = mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), mat(0x6b4a2e), vid);
    leg.position.set(x, 0.35, z);
    g.add(leg);
  }
  const body = mesh(new THREE.BoxGeometry(1.8, 1.2, 1.5), mat(wall), vid);
  body.position.y = 1.3;
  const roof = mesh(new THREE.ConeGeometry(1.55, 1, 4), mat(roofC, { flatShading: true }), vid);
  roof.position.y = 2.4;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.15, 1, 0.95);
  const deck = mesh(new THREE.BoxGeometry(1.8, 0.08, 0.6), mat(0x9a7350), vid);
  deck.position.set(0, 0.72, 1.05);
  const win = mesh(new THREE.BoxGeometry(0.42, 0.36, 0.04), night ? new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb347, emissiveIntensity: 1.6 }) : mat(0x5c7fa3, { roughness: 0.3 }), vid, false);
  win.position.set(-0.45, 1.4, 0.77);
  const win2 = win.clone();
  win2.position.x = 0.45;
  g.add(body, roof, deck, win, win2);
  return g;
}

function worker(vid: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z = 0, extra = {}) => {
    const o = mesh(geo, mat(color, extra), vid);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  add(new THREE.BoxGeometry(0.22, 0.7, 0.25), 0x2c4a7a, -0.15, 0.35);
  add(new THREE.BoxGeometry(0.22, 0.7, 0.25), 0x2c4a7a, 0.15, 0.35);
  add(new THREE.CylinderGeometry(0.33, 0.36, 0.85, 10), 0xf07d1a, 0, 1.12);
  add(new THREE.BoxGeometry(0.7, 0.08, 0.4), 0xd8ff3a, 0, 1.2, 0, { emissive: 0x2a3300 });
  add(new THREE.SphereGeometry(0.27, 14, 10), 0xe7b98f, 0, 1.78);
  const helmet = add(new THREE.SphereGeometry(0.31, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xffd21f, 0, 1.86);
  helmet.scale.y = 0.8;
  const arm = new THREE.Group();
  arm.position.set(0.42, 1.35, 0);
  const a = mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), mat(0xf07d1a), vid);
  a.position.y = -0.25;
  const wrench = mesh(new THREE.BoxGeometry(0.12, 0.6, 0.08), mat(0x9aa3ad, { metalness: 0.7, roughness: 0.3 }), vid);
  wrench.position.set(0, -0.7, 0.1);
  arm.add(a, wrench);
  g.add(arm);
  const cone = new THREE.Group();
  const c = mesh(new THREE.ConeGeometry(0.32, 0.8, 14), mat(0xff6a00), vid);
  c.position.y = 0.4;
  const stripe = mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.14, 14), mat(0xffffff), vid);
  stripe.position.y = 0.42;
  cone.add(c, stripe);
  cone.position.set(-1.1, 0, 0.6);
  g.add(cone);
  return { g, arm };
}

function fountain(at: THREE.Vector3, power: number, anims: ((t: number) => void)[], parent: THREE.Object3D) {
  const n = Math.round(22 + power * 26);
  const geo = new THREE.SphereGeometry(0.17, 6, 4);
  const m = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x2a6fb0, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 });
  const drops = Array.from({ length: n }, (_, i) => {
    const d = new THREE.Mesh(geo, m);
    parent.add(d);
    return { d, phase: i / n, ang: (i * 2.39996) % (Math.PI * 2) };
  });
  anims.push((t) => {
    for (const { d, phase, ang } of drops) {
      const f = (t * 0.9 + phase) % 1;
      const sp = 0.9 + power * 0.8;
      d.position.set(at.x + Math.cos(ang) * f * sp, at.y + (4 * f * (1 - f)) * (2.4 + power * 2.6), at.z + Math.sin(ang) * f * sp);
    }
  });
}

type Spot = { pos: THREE.Vector3; radius: number };

export default function World3D({ villages, selected, night, onSelect, etaText, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const tagBox = useRef<HTMLDivElement>(null);
  const S = useRef<{
    scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; world: THREE.Group;
    hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; anims: ((t: number) => void)[];
    tags: { el: HTMLElement; at: THREE.Vector3 }[]; spots: Map<number, Spot>; fly: { target: THREE.Vector3; pos: THREE.Vector3 } | null;
  } | null>(null);
  const sel = useRef(onSelect);
  sel.current = onSelect;

  useEffect(() => {
    const el = host.current!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 600);
    camera.position.set(55, 60, 70);
    const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x6b7f4a, 1.6);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(40, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, far: 250 });
    scene.add(hemi, sun);
    const world = new THREE.Group();
    scene.add(world);
    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, { enableDamping: true, enablePan: true, screenSpacePanning: false, minDistance: 14, maxDistance: 220, maxPolarAngle: 1.32, autoRotate: !still, autoRotateSpeed: 0.35 });
    const stopFly = () => {
      controls.autoRotate = false;
      if (S.current) S.current.fly = null;
    };
    controls.addEventListener("start", stopFly);
    S.current = { scene, camera, controls, world, hemi, sun, anims: [], tags: [], spots: new Map(), fly: null };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      for (const hit of ray.intersectObjects(world.children, true)) {
        let o: THREE.Object3D | null = hit.object;
        while (o && o.userData.vid == null) o = o.parent;
        if (o) return sel.current(o.userData.vid);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const v = new THREE.Vector3();
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      if (!visible || document.hidden) return;
      const st = S.current!;
      const t = still ? 0 : clock.getElapsedTime();
      st.anims.forEach((f) => f(t));
      if (st.fly) {
        controls.target.lerp(st.fly.target, 0.08);
        camera.position.lerp(st.fly.pos, 0.08);
        if (camera.position.distanceTo(st.fly.pos) < 0.2) st.fly = null;
      }
      controls.update();
      renderer.render(scene, camera);
      const w = el.clientWidth, h = el.clientHeight;
      for (const tag of st.tags) {
        v.copy(tag.at).project(camera);
        const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        tag.el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        tag.el.style.visibility = vis ? "visible" : "hidden";
      }
    });
    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      S.current = null;
    };
  }, []);

  useEffect(() => {
    const st = S.current;
    if (!st) return;
    const { world, hemi, sun } = st;
    world.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    world.clear();
    hemi.color.setHex(night ? 0x4a5d8c : 0xeaf4ff);
    hemi.groundColor.setHex(night ? 0x1a2230 : 0x6b7f4a);
    hemi.intensity = night ? 1.25 : 1.6;
    sun.color.setHex(night ? 0x9db4ff : 0xffffff);
    sun.intensity = night ? 1.1 : 2.2;

    const anims: ((t: number) => void)[] = [];
    const tags: { el: HTMLElement; at: THREE.Vector3 }[] = [];
    const box = tagBox.current!;
    box.replaceChildren();
    const tag = (html: string, at: THREE.Vector3, cls: string, vid?: number) => {
      const d = document.createElement(vid != null ? "button" : "div");
      d.className = `wtag ${cls}`;
      d.innerHTML = html;
      if (vid != null) d.addEventListener("click", () => sel.current(vid));
      box.append(d);
      tags.push({ el: d, at });
    };
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

    const pts = layout(villages);
    const far = Math.max(20, ...pts.map((p) => p.length())) + 18;
    const grass = night ? 0x2d4a2a : 0x8fc46a;
    const island = mesh(new THREE.CylinderGeometry(far, far - 2, 2.2, 72), [mat(night ? 0x3d2f22 : 0x9b7653), mat(grass), mat(0x5c4430)], undefined, false);
    island.position.y = -1.1;
    const sand = mesh(new THREE.CylinderGeometry(far + 3, far + 1, 1.2, 72), mat(night ? 0x5c5440 : 0xe6d29a), undefined, false);
    sand.position.y = -1.6;
    const sea = mesh(new THREE.CylinderGeometry(far + 14, far + 14, 0.4, 72), mat(night ? 0x16324f : 0x7cc4ef, { roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85 }), undefined, false);
    sea.position.y = -2.1;
    world.add(island, sand, sea);

    const river = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-far, 0.02, -far * 0.3), new THREE.Vector3(-far * 0.35, 0.02, -far * 0.55),
      new THREE.Vector3(far * 0.15, 0.02, -far * 0.75), new THREE.Vector3(far * 0.55, 0.02, -far * 0.6),
    ]);
    const rv = mesh(new THREE.TubeGeometry(river, 80, 1.6, 8, false), mat(night ? 0x2a5b8f : 0x5ea8e6, { roughness: 0.15, emissive: night ? 0x0d2747 : 0 }), undefined, false);
    rv.scale.y = 0.06;
    world.add(rv);

    const r = rnd(7);
    const clear = (x: number, z: number) => pts.every((p) => Math.hypot(p.x - x, p.y - z) > 11) && river.getPoints(30).every((q) => Math.hypot(q.x - x, q.z - z) > 3);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (far - 3);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!clear(x, z)) continue;
      const s = 0.7 + r() * 0.7;
      const g = new THREE.Group();
      const trunk = mesh(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 1.2 * s, 6), mat(0x7a5232));
      trunk.position.y = 0.6 * s;
      const palm = r() < 0.3;
      const top = palm ? mesh(new THREE.SphereGeometry(1.1 * s, 7, 5), mat(night ? 0x1f4a2a : 0x4c9a4a, { flatShading: true }))
        : mesh(new THREE.ConeGeometry(1.1 * s, 2.4 * s, 7), mat(night ? 0x1d3f25 : 0x3f8f45, { flatShading: true }));
      top.position.y = palm ? 1.9 * s : 2.2 * s;
      g.add(trunk, top);
      g.position.set(x, 0, z);
      world.add(g);
    }
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const b = mesh(new THREE.SphereGeometry(1.6 + r() * 1.4, 10, 8), new THREE.MeshStandardMaterial({ color: night ? 0x5a6688 : 0xffffff, transparent: true, opacity: 0.88, roughness: 1 }), undefined, false);
        b.position.set(k * 1.8 - 2.7, r() * 0.8, r() * 1.2);
        c.add(b);
      }
      const y = 22 + r() * 8, z0 = (r() - 0.5) * far * 1.6, off = r() * 100, sp = 1 + r();
      c.position.y = y;
      world.add(c);
      anims.push((t) => c.position.set(((t * sp + off) % (far * 2.6)) - far * 1.3, y, z0));
    }

    const spots = new Map<number, Spot>();
    villages.forEach((vg, idx) => {
      const p = pts[idx];
      const c = new THREE.Vector3(p.x, 0, p.y);
      const vid = vg.id;
      const rr = rnd(vid * 97 + 13);
      const g = new THREE.Group();
      g.position.copy(c);
      g.userData.vid = vid;
      world.add(g);
      const n = Math.max(4, Math.min(10, Math.round((vg.households || 20) / 5)));
      const radius = 4.6 + n * 0.22;
      spots.set(vid, { pos: c.clone(), radius });

      const plot = mesh(new THREE.CylinderGeometry(radius + 2.2, radius + 2.4, 0.12, 48), mat(night ? 0x34502d : 0xb5d98e), vid, false);
      plot.position.y = 0.06;
      const ring = mesh(new THREE.TorusGeometry(radius + 2.3, 0.18, 8, 64), new THREE.MeshStandardMaterial({ color: LEVEL[vg.level], emissive: LEVEL[vg.level], emissiveIntensity: night ? 1.4 : 0.4 }), vid, false);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.16;
      g.add(plot, ring);
      if (vg.level !== "green") anims.push((t) => ((ring.material as THREE.MeshStandardMaterial).emissiveIntensity = (night ? 1.2 : 0.3) + 0.5 * (1 + Math.sin(t * (vg.level === "red" ? 5 : 2.5)))));
      if (vid === selected) {
        const halo = mesh(new THREE.TorusGeometry(radius + 3.2, 0.1, 8, 64), new THREE.MeshBasicMaterial({ color: 0x3987e5, transparent: true }), vid, false);
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 0.2;
        g.add(halo);
        anims.push((t) => {
          const f = (t * 0.6) % 1;
          halo.scale.setScalar(1 + f * 0.25);
          (halo.material as THREE.MeshBasicMaterial).opacity = 1 - f;
        });
      }

      const tower = new THREE.Group();
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = mesh(new THREE.BoxGeometry(0.22, 4.4, 0.22), mat(0x5b6570), vid);
        leg.position.set(x * 1.1, 2.2, z * 1.1);
        tower.add(leg);
      }
      const drum = mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.4, 24), mat(0x6f9fd6, { metalness: 0.2, roughness: 0.5 }), vid);
      drum.position.y = 5.6;
      const lid = mesh(new THREE.ConeGeometry(1.9, 0.8, 24), mat(0x9cc0ea), vid);
      lid.position.y = 7.2;
      tower.add(drum, lid);
      const solar = mesh(new THREE.BoxGeometry(2.2, 0.08, 1.4), mat(0x1d3557, { metalness: 0.6, roughness: 0.3, emissive: 0x0a1630 }), vid);
      solar.position.set(2.6, 0.9, 0);
      solar.rotation.z = -0.5;
      const pole = mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), mat(0x5b6570), vid);
      pole.position.set(2.6, 0.45, 0);
      tower.add(solar, pole);
      tower.position.set(0, 0, 0);
      g.add(tower);

      const meterAt = new THREE.Vector3(1.4, 0, 1.8);
      const clip = mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), mat(0xeeeeea), vid);
      clip.position.copy(meterAt).setY(0.3);
      const offline = vg.alerts.includes("clip_silent") || !vg.has_main_meter;
      const led = mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: offline ? 0x777777 : LEVEL[vg.level], emissive: offline ? 0 : LEVEL[vg.level], emissiveIntensity: 1.5 }), vid, false);
      led.position.copy(meterAt).add(new THREE.Vector3(0, 0.68, 0));
      g.add(clip, led);
      if (!offline) anims.push((t) => (led.visible = Math.sin(t * 4 + vid) > -0.6));

      const pipeColor = PIPE_DAY[vg.level];
      const pipeMat = new THREE.MeshStandardMaterial({ color: pipeColor, metalness: 0.3, roughness: 0.5, emissive: night ? pipeColor : 0, emissiveIntensity: night ? 0.7 : 0 });
      const drops = new THREE.MeshStandardMaterial({ color: 0xdff0ff, emissive: 0x7fbfff, emissiveIntensity: night ? 1.4 : 0.6 });
      const dropGeo = new THREE.SphereGeometry(0.12, 8, 6);
      const homes: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.6;
        const hp = new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
        homes.push(hp);
        const h = house(vid, night, rr);
        h.position.copy(hp);
        h.rotation.y = Math.atan2(-hp.x, -hp.z);
        g.add(h);
        const a1 = meterAt.clone().setY(0.2), b1 = hp.clone().multiplyScalar(0.8).setY(0.2);
        const pipe = mesh(new THREE.CylinderGeometry(0.13, 0.13, a1.distanceTo(b1), 8), pipeMat, vid, false);
        between(pipe, a1, b1);
        g.add(pipe);
        if (i % 2 === 0) {
          const d = new THREE.Mesh(dropGeo, drops);
          g.add(d);
          anims.push((t) => d.position.copy(a1).lerp(b1, (t * 0.4 + i / n) % 1).setY(0.38));
        }
      }
      const feed = mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.4, 8), pipeMat, vid, false);
      between(feed, new THREE.Vector3(1.1, 4.4, 1.1), meterAt.clone().setY(0.2));
      g.add(feed);

      const leaky = vg.jobs.filter((j) => LEAKY.includes(j.kind) && j.status !== "checking");
      const leakOn = vg.alerts.includes("leak") || vg.alerts.includes("burst") || leaky.length > 0;
      const leakAt = homes[Math.floor(n / 2)].clone().multiplyScalar(0.55).setY(0.25);
      if (leakOn) {
        const power = vg.alerts.includes("burst") ? 1 : vg.level === "red" ? 0.6 : 0.3;
        fountain(leakAt, power, anims, g);
        const puddle = mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.04, 24), mat(0x4a9be0, { roughness: 0.1, emissive: night ? 0x1d4f80 : 0 }), vid, false);
        puddle.position.copy(leakAt).setY(0.14);
        const wave = mesh(new THREE.TorusGeometry(1, 0.06, 6, 32), new THREE.MeshBasicMaterial({ color: 0xe0412f, transparent: true }), vid, false);
        wave.rotation.x = Math.PI / 2;
        wave.position.copy(leakAt).setY(0.18);
        g.add(puddle, wave);
        anims.push((t) => {
          const f = (t * 0.7) % 1;
          wave.scale.setScalar(1 + f * 2);
          (wave.material as THREE.MeshBasicMaterial).opacity = 1 - f;
        });
      }

      const working = vg.jobs.filter((j) => ["assigned", "fixing"].includes(j.status));
      working.slice(0, 3).forEach((j, k) => {
        const { g: w, arm } = worker(vid);
        const spot = leakAt.clone().add(new THREE.Vector3(1.4 * Math.cos(k * 2.1), 0, 1.4 * Math.sin(k * 2.1))).setY(0.06);
        w.position.copy(spot);
        w.rotation.y = Math.atan2(leakAt.x - spot.x, leakAt.z - spot.z);
        g.add(w);
        const sparks = Array.from({ length: 5 }, () => {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 4, 3), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
          g.add(s);
          return s;
        });
        anims.push((t) => {
          w.position.y = 0.06 + Math.abs(Math.sin(t * 4 + k)) * 0.1;
          arm.rotation.x = -0.6 + Math.sin(t * 8 + k) * 0.6;
          sparks.forEach((s, i) => {
            const f = (t * 2 + i / 5) % 1;
            s.position.copy(spot).lerp(leakAt, 0.5).add(new THREE.Vector3(Math.cos(i * 1.3) * f * 0.6, 0.6 + f * 0.8, Math.sin(i * 1.3) * f * 0.6));
            s.visible = f < 0.7;
          });
        });
        const e = etaText(j);
        tag(`👷 ${esc(j.technician ?? "")}${e ? ` · ⏱ ${esc(e)}` : ""}`, c.clone().add(spot).setY(3.2), "eta");
      });
      if (vg.jobs.some((j) => j.status === "checking")) {
        const lens = new THREE.Group();
        lens.add(mesh(new THREE.TorusGeometry(0.7, 0.14, 10, 28), mat(0x1c5cab, { metalness: 0.4, emissive: night ? 0x1c5cab : 0 }), vid));
        const handle = mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8), mat(0x333333), vid);
        handle.position.set(0.85, -0.85, 0);
        handle.rotation.z = Math.PI / 4;
        lens.add(handle);
        lens.position.copy(meterAt).setY(2.4);
        g.add(lens);
        anims.push((t) => (lens.rotation.y = t * 1.2));
      }
      if (vg.jobs.some((j) => j.status === "open")) {
        const mark = new THREE.Group();
        const bar = mesh(new THREE.BoxGeometry(0.45, 1.4, 0.45), mat(0xe0412f, { emissive: 0x7a0000 }), vid);
        bar.position.y = 1.1;
        const dot = mesh(new THREE.SphereGeometry(0.26, 10, 8), mat(0xe0412f, { emissive: 0x7a0000 }), vid);
        mark.add(bar, dot);
        world.add(mark);
        mark.userData.vid = vid;
        anims.push((t) => {
          mark.position.set(c.x - 2.2, 9 + Math.sin(t * 3) * 0.4, c.z);
          mark.rotation.y = t;
        });
      }
      const chip = { red: "🔴", yellow: "🟡", green: "🟢" }[vg.level];
      tag(`<b>#${vg.rank}</b> ${chip} ${esc(vg.name)}`, c.clone().setY(9.4), `village ${vg.level}${vid === selected ? " on" : ""}`, vid);
    });
    st.anims = anims;
    st.tags = tags;
    st.spots = spots;
  }, [villages, night, selected, etaText]);

  useEffect(() => {
    const st = S.current;
    if (!st) return;
    const spot = selected != null ? st.spots.get(selected) : null;
    if (spot) {
      st.controls.autoRotate = false;
      const dir = st.camera.position.clone().sub(st.controls.target).setY(0).normalize();
      if (!dir.lengthSq()) dir.set(1, 0, 1).normalize();
      const d = 18 + spot.radius * 2;
      st.fly = { target: spot.pos.clone().setY(1.5), pos: spot.pos.clone().add(dir.multiplyScalar(d)).setY(d * 0.8) };
    } else if (selected == null && st.spots.size) {
      const far = Math.max(...[...st.spots.values()].map((s) => s.pos.length())) + 30;
      st.fly = { target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(far * 0.8, far * 0.95, far * 1.05) };
    }
  }, [selected, villages.length]);

  return (
    <div className="w3d" ref={host} role="img" aria-label={label}>
      <div className="w3d-tags" ref={tagBox} />
    </div>
  );
}
