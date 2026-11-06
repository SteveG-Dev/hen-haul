// Hen Haul 3D: draws the world (road, countryside, truck, chickens, pickups) with three.js.
// The game's physics stay 2D; the playfield is the z = 0 plane. The camera looks straight down
// -z with a lens shift, so that plane maps to the screen with exactly the 2D game's transform:
// the 2D canvas on top keeps drawing text, particles and the HUD in the same coordinates.
import * as THREE from './three.module.min.js';

const H = window.HH3D;
const TAU = Math.PI * 2;
const FOV = 30, ELEV = 230;                 // camera field of view, and how far above the action it sits
const ROAD_BACK = -110, ROAD_FRONT = 100;    // the road's depth (z)
const CW = 1600;                             // terrain chunk width (world px)

const glCanvas = document.getElementById('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) { renderer = null; }

if (!renderer || !H) dispatchEvent(new Event('world3dfail'));
if (renderer && H){
const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 && matchMedia('(pointer: coarse)').matches;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 5, 12000);
scene.fog = new THREE.Fog(0xf3d6a6, 3200, 14000);

// ---------- light ----------
const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x8a6a40, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 700, bottom: -700, near: 10, far: 4000 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 1.2;
scene.add(sun, sun.target);
{ // a simple sky-to-ground gradient as the reflection environment (paint, chrome and coins need it)
  const es = new THREE.Scene(), g = new THREE.SphereGeometry(100, 16, 8), cols = [];
  const top = new THREE.Color(0x8fc1ec), mid = new THREE.Color(0xffe2b0), bot = new THREE.Color(0x6b5a3a);
  for (let i = 0; i < g.attributes.position.count; i++){ const y = g.attributes.position.getY(i) / 100; const c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(bot, -y * 1.5); cols.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0.04).texture; pm.dispose();
  scene.environmentIntensity = .3;
}

// ---------- helpers: build merged, vertex-coloured, flat-shaded geometry ----------
const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color();
class Batch {
  constructor(){ this.p = []; this.n = []; this.c = []; }
  add(geo, m, color, jitter = 0){
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m); g.computeVertexNormals();
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    tmpC.set(color);
    for (let i = 0; i < P.length; i += 9){
      const j = jitter ? 1 + (Math.sin(P[i] * .37 + P[i + 2] * .21) * jitter) : 1;
      for (let v = 0; v < 9; v++){ this.p.push(P[i + v]); this.n.push(N[i + v]); }
      for (let v = 0; v < 3; v++) this.c.push(tmpC.r * j, tmpC.g * j, tmpC.b * j);
    }
    g.dispose();
  }
  tri(a, b, c, color){                   // one triangle, flat normal
    const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a), n = ab.cross(ac).normalize();
    for (const v of [a, b, c]){ this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z); }
    for (const col of color) this.c.push(col.r, col.g, col.b);
  }
  mesh(mat){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return new THREE.Mesh(g, mat);
  }
}
const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone5: new THREE.ConeGeometry(1, 1, 5),
  cone7: new THREE.ConeGeometry(1, 1, 7),
  ico: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodec: new THREE.DodecahedronGeometry(1, 0),
  dome: new THREE.SphereGeometry(1, 9, 3, 0, Math.PI * 2, 0, Math.PI / 2),
  prism: new THREE.CylinderGeometry(1, 1, 1, 3).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2),   // axis along x, ridge up
};
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  return m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
};
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const rgbOf = a => (Math.round(a[0]) << 16) | (Math.round(a[1]) << 8) | Math.round(a[2]);
const lerpHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// ground height in 3D (y up); smoothed versions for land far behind the road
const gy = x => -H.groundY(x);
function smoothY(x, w){ let s = 0; for (let k = -4; k <= 4; k++) s += gy(x + k * w / 4); return s / 9; }
const zoneOf = x => H.ZONES[H.zoneIdx(x)].id;

// ---------- terrain chunks ----------
const ROWS = [ -1700, -1150, -760, -470, -300, -190, ROAD_BACK, -62, -34, -14, 14, 34, 62, ROAD_FRONT ];
function rowY(x, z){
  if (z >= ROAD_BACK) return gy(x);
  // behind the road the land drops a little and smooths out into the distance
  const t = (ROAD_BACK - z) / (ROAD_BACK - ROWS[0]);
  const near = gy(x) - (z <= -190 ? 14 : 4), far = smoothY(x, 900) - 120;
  return near + (far - near) * Math.min(1, t * 1.25) + (z < -400 ? Math.sin(x * .004 + z * .01) * 26 : 0);
}
function rowColor(P, z, x){
  const grass = new THREE.Color(rgbOf(P.eMid)), dark = new THREE.Color(rgbOf(P.eDark)), light = new THREE.Color(rgbOf(P.eLight));
  const dirt = new THREE.Color(rgbOf(P.dirtTop));
  if (z >= -34 && z <= -14 || z >= 14 && z <= 34) return dirt.clone().lerp(grass, .25);          // tyre tracks
  if (z > ROAD_BACK) return grass.clone().lerp(light, .18 + hash(x * .01 + z) * .12);
  const far = new THREE.Color(rgbOf(P.mid)).lerp(new THREE.Color(rgbOf(P.far)), Math.min(1, (ROAD_BACK - z) / 900));
  return dark.clone().lerp(far, Math.min(1, (ROAD_BACK - z) / 300) * .85 + .1);
}
function buildTerrain(i){
  const x0 = i * CW, x1 = x0 + CW, STEP = 20;
  const top = new Batch(), front = new Batch();
  const xs = []; for (let x = x0; x <= x1 + .1; x += STEP) xs.push(x);
  const P0 = xs.map(x => H.palAt(x));
  const V = (x, z) => new THREE.Vector3(x, rowY(x, z), z);
  for (let a = 0; a < xs.length - 1; a++){
    const xa = xs[a], xb = xs[a + 1], Pa = P0[a];
    for (let r = 0; r < ROWS.length - 1; r++){
      const za = ROWS[r], zb = ROWS[r + 1];
      const ca = rowColor(Pa, (za + zb) / 2, xa);
      const v1 = V(xa, za), v2 = V(xb, za), v3 = V(xb, zb), v4 = V(xa, zb);
      top.tri(v1, v4, v2, [ca, ca, ca]);
      const cb = ca.clone().multiplyScalar(.96 + hash(xa + za) * .06);
      top.tri(v2, v4, v3, [cb, cb, cb]);
    }
    // the cut face at the front: a grass lip, then layered dirt
    const ya = gy(xa), yb = gy(xb), z = ROAD_FRONT;
    const lip = new THREE.Color(rgbOf(Pa.eDark)), d1 = new THREE.Color(rgbOf(Pa.dirtTop)), d2 = new THREE.Color(rgbOf(Pa.dirtBot));
    const band = (o0, o1, c0, c1) => {
      const p1 = new THREE.Vector3(xa, ya - o0, z), p2 = new THREE.Vector3(xb, yb - o0, z), p3 = new THREE.Vector3(xb, yb - o1, z), p4 = new THREE.Vector3(xa, ya - o1, z);
      front.tri(p1, p4, p2, [c0, c1, c0]); front.tri(p2, p4, p3, [c0, c1, c1]);
    };
    band(0, 12, lip, lip);
    band(12, 90, d1, d1.clone().lerp(d2, .4));
    band(90, 260, d1.clone().lerp(d2, .4), d2);
    band(260, 900, d2, d2.clone().multiplyScalar(.7));
  }
  // stones set into the cut face
  for (let x = x0; x < x1; x += 46){
    const h = hash(x * 1.7), P = H.palAt(x);
    if (h < .35) continue;
    const c = new THREE.Color(rgbOf(P.dirtBot)).lerp(new THREE.Color(0x9a8a7a), .45).getHex();
    front.add(GEO.dodec, M(x + h * 30, gy(x) - 30 - h * 120, ROAD_FRONT, 6 + h * 8, 4.5 + h * 5, 5, 0, 0, h * 2), c, .08);
  }
  const g = new THREE.Group();
  const t = top.mesh(vcMat); t.receiveShadow = true; g.add(t);
  const f = front.mesh(vcMat); f.receiveShadow = true; g.add(f);
  const props = buildProps(x0, x1);
  if (props){ props.castShadow = true; props.receiveShadow = true; g.add(props); }
  return g;
}

// ---------- roadside and countryside props, merged per chunk ----------
function tree(b, x, z, s, dark){
  const y = rowY(x, z);
  b.add(GEO.cyl6, M(x, y + 9 * s, z, 2.4 * s, 18 * s, 2.4 * s), 0x6b4a2c);
  const leaf = dark ? 0x4f7a2a : 0x6f9c34;
  b.add(GEO.ico, M(x, y + 30 * s, z, 15 * s, 14 * s, 15 * s, hash(x) * 3, hash(x + 1) * 3, 0), leaf, .05);
  b.add(GEO.ico, M(x - 9 * s, y + 22 * s, z + 4 * s, 10 * s, 9 * s, 10 * s, hash(x + 2), hash(x + 3), 0), lerpHex(leaf, 0x000000, .1), .05);
  b.add(GEO.ico, M(x + 8 * s, y + 24 * s, z - 3 * s, 10 * s, 9 * s, 10 * s, hash(x + 4), 0, hash(x + 5)), lerpHex(leaf, 0xffffff, .08), .05);
}
function pine(b, x, z, s, snowy){
  const y = rowY(x, z);
  b.add(GEO.cyl6, M(x, y + 5 * s, z, 2.5 * s, 10 * s, 2.5 * s), 0x6b4a2c);
  for (let k = 0; k < 3; k++){
    const w = (15 - k * 3.6) * s, yy = y + 12 * s + k * 11 * s;
    b.add(GEO.cone7, M(x, yy + 7 * s, z, w, 18 * s, w, 0, hash(x + k), 0), 0x2f6b4a);
    if (snowy) b.add(GEO.cone7, M(x, yy + 12.5 * s, z, w * .5, 8 * s, w * .5, 0, hash(x + k), 0), 0xffffff);
  }
}
function cactus(b, x, z, s){
  const y = rowY(x, z), c = 0x4d9a4a;
  b.add(GEO.cyl8, M(x, y + 20 * s, z, 4.5 * s, 40 * s, 4.5 * s), c);
  b.add(GEO.cyl8, M(x - 9 * s, y + 24 * s, z, 3 * s, 14 * s, 3 * s), c);
  b.add(GEO.cyl8, M(x - 5 * s, y + 18 * s, z, 6 * s, 3 * s, 3 * s, 0, 0, Math.PI / 2), c);
  b.add(GEO.cyl8, M(x + 9 * s, y + 28 * s, z, 3 * s, 14 * s, 3 * s), c);
  b.add(GEO.cyl8, M(x + 5 * s, y + 22 * s, z, 6 * s, 3 * s, 3 * s, 0, 0, Math.PI / 2), c);
}
function rock(b, x, z, s, col){ const y = rowY(x, z); b.add(GEO.dodec, M(x, y + 3 * s, z, 9 * s, 6 * s, 8 * s, hash(x), hash(x + 1), hash(x + 2)), col, .06); }
function barn(b, x, z, s){
  const y = rowY(x, z) - 4;
  b.add(GEO.box, M(x, y + 22 * s, z, 70 * s, 44 * s, 52 * s), 0xb8322a);
  // gable roof: a triangular prism along x
  b.add(GEO.prism, M(x, y + 52.5 * s, z, 78 * s, 17 * s, 31 * s), 0x7d1e18);
  b.add(GEO.box, M(x, y + 16 * s, z + 26.5 * s, 26 * s, 32 * s, 1.5 * s), 0xf5ead6);
  b.add(GEO.box, M(x, y + 16 * s, z + 27.5 * s, 34 * s, 3 * s, 1 * s, 0, 0, .85), 0xb8322a);
  b.add(GEO.box, M(x, y + 16 * s, z + 27.5 * s, 34 * s, 3 * s, 1 * s, 0, 0, -.85), 0xb8322a);
  b.add(GEO.box, M(x, y + 42 * s, z + 26.5 * s, 12 * s, 10 * s, 1.5 * s), 0xf5ead6);
}
function silo(b, x, z, s){ const y = rowY(x, z) - 2; b.add(GEO.cyl8, M(x, y + 34 * s, z, 13 * s, 68 * s, 13 * s), 0xd7d2c4); b.add(GEO.cone7, M(x, y + 74 * s, z, 14 * s, 12 * s, 14 * s), 0x9a3a2a); }
function cabin(b, x, z, s){
  const y = rowY(x, z) - 3;
  b.add(GEO.box, M(x, y + 14 * s, z, 50 * s, 28 * s, 36 * s), 0x8a5a34);
  b.add(GEO.box, M(x, y + 34 * s, z + 10 * s, 56 * s, 4 * s, 24 * s, -.6, 0, 0), 0xffffff);
  b.add(GEO.box, M(x, y + 34 * s, z - 10 * s, 56 * s, 4 * s, 24 * s, .6, 0, 0), 0xffffff);
  b.add(GEO.box, M(x - 10 * s, y + 16 * s, z + 18.5 * s, 9 * s, 9 * s, 1 * s), 0xffd66b);
  b.add(GEO.box, M(x + 10 * s, y + 16 * s, z + 18.5 * s, 9 * s, 9 * s, 1 * s), 0xffd66b);
}
function mesa(b, x, z, s){ const y = rowY(x, z) - 6; b.add(GEO.cyl6, M(x, y + 40 * s, z, 70 * s, 80 * s, 46 * s, 0, hash(x), 0), 0xc9845a, .05); b.add(GEO.cyl6, M(x, y + 82 * s, z, 58 * s, 6 * s, 38 * s, 0, hash(x), 0), 0xb06e46); }

function buildProps(x0, x1){
  const b = new Batch();
  for (let x = Math.floor(x0 / 72) * 72; x < x1; x += 72){
    const zone = zoneOf(x), P = H.palAt(x);
    // fence along the back of the road (not in the desert), rails following the ground
    if (zone !== 'desert'){
      const z = ROAD_BACK - 14, y = rowY(x, z), nx = x + 72, ny = rowY(nx, z);
      b.add(GEO.box, M(x, y + 19, z, 6, 40, 6), 0x7a4a22);
      if (zone === 'snow') b.add(GEO.ico, M(x, y + 40, z, 5.5, 3, 5.5), 0xffffff);
      const ang = Math.atan2(ny - y, 72), len = Math.hypot(72, ny - y);
      for (const h of [30, 15]) b.add(GEO.box, M(x + 36, (y + ny) / 2 + h, z + 3.5, len, 4.5, 3, 0, 0, ang), 0x8f5a2c);
    }
    // grass tufts and stones on the verges (front and back of the road)
    for (let k = 0; k < 4; k++){
      const xx = x + hash(x + k * 7) * 72, front = k % 2 === 0, zz = front ? 66 + hash(xx) * 30 : ROAD_BACK + 8 + hash(xx) * 34;
      if (zone === 'desert'){ if (hash(xx * 3) < .35) rock(b, xx, zz, .5 + hash(xx) * .6, 0xb07a4a); continue; }
      const col = new THREE.Color(rgbOf(P.blade[3] > .05 ? P.blade : P.eDark)).getHex();
      const y = rowY(xx, zz);
      b.add(GEO.cone5, M(xx, y + 4, zz, 3, 9 + hash(xx) * 6, 3, 0, hash(xx) * 3, (hash(xx + 1) - .5) * .5), col);
      b.add(GEO.cone5, M(xx + 3, y + 3, zz + 2, 2.5, 7, 2.5, 0, 0, .3), col);
      if (hash(xx * 5) < .12) rock(b, xx + 8, zz, .45, zone === 'snow' ? 0xdfe7f2 : 0x9a9088);
    }
  }
  // the countryside behind the fence
  for (let x = Math.floor(x0 / 95) * 95; x < x1; x += 95){
    const h = hash(x * .013), zone = zoneOf(x), idx = Math.round(x / 95);
    if (H.T && H.T.stations.some(st => Math.abs(st.x + 40 - x) < 190)) continue;   // keep the farm stand clear
    const z = -200 - hash(x + 9) * 200, z2 = -560 - hash(x + 5) * 380;
    if (zone === 'desert'){
      if (h < .45) cactus(b, x, z, .7 + h);
      else if (h < .6) rock(b, x, z, 1.4 + h, 0xc08a5a);
      if (idx % 9 === 0) mesa(b, x, z2, 1.2 + h);
    } else if (zone === 'snow'){
      if (h < .7) pine(b, x, z, .9 + h * .8, true);
      if (idx % 13 === 0) cabin(b, x, z2 + 200, 1.1);
      if (hash(x + 3) < .5) pine(b, x + 40, z2, 1.5 + h, true);
    } else {
      const night = zone === 'night';
      if (idx % 23 === 0) barn(b, x, z2 + 150, 1.3);
      else if (idx % 23 === 3) silo(b, x, z2 + 160, 1.2);
      else if (h < .55) tree(b, x, z, .9 + h * .9, h < .2 || night);
      if (hash(x + 7) < .45) tree(b, x + 47, z2, 1.6 + hash(x) * .8, night || hash(x + 2) < .3);
    }
  }
  return b.p.length ? b.mesh(vcMat) : null;
}

// far hills and mountains: separate low-poly peaks, hazier the further away
const FARW = 6000;
function buildFar(i){
  const b = new Batch(), x0 = i * FARW, x1 = x0 + FARW;
  const haze = new THREE.Color(0xb9c6e0);
  // rolling hills between the farmland and the mountains
  for (let x = x0; x < x1; x += 420){
    const h = hash(x * .7 + 3), P = H.palAt(Math.max(0, x)), z = -1350 - h * 500, base = smoothY(x, 1800) - 160;
    const col = new THREE.Color(rgbOf(P.mid)).lerp(haze, .18).getHex();
    b.add(GEO.dome, M(x + h * 160, base, z, 480 + h * 240, 90 + h * 80, 300, 0, h * .4, 0), col, .04);
  }
  // mountains: tall peaks far back, a snow cap on the tall ones
  for (let x = x0; x < x1; x += 430){
    const h = hash(x * .31 + 11), h2 = hash(x * .17 + 5), P = H.palAt(Math.max(0, x)), zone = zoneOf(Math.max(0, x));
    if (h2 < .3) continue;
    const z = -3600 - h * 1400, base = smoothY(x, 2400) - 160, ht = 300 + h2 * 330 + (zone === 'snow' ? 140 : 0), r = 240 + h * 220;
    const rock = zone === 'desert' ? 0xc98a5e : zone === 'night' ? 0x2b3160 : 0x8d93b8;
    const col = new THREE.Color(rock).lerp(haze, zone === 'night' ? .1 : .35 + h * .2).getHex();
    const rot = h * 3;
    b.add(GEO.cone5, M(x, base + ht / 2, z, r, ht, r * .8, 0, rot, 0), col, .08);
    if (ht > 470 || zone === 'snow'){ const k = .3; b.add(GEO.cone5, M(x, base + ht * (1 - k / 2) + 1, z, r * k * 1.04, ht * k, r * .8 * k * 1.04, 0, rot, 0), zone === 'night' ? 0x8f96c8 : 0xf6f8fc); }
  }
  return b.mesh(vcMat);
}

// clouds: a few soft low-poly clusters drifting in the sky
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xfff6ea, transparent: true, opacity: .92 });
const clouds = [];
for (let i = 0; i < 9; i++){
  const g = new THREE.Group();
  for (let k = 0; k < 5; k++){ const m = new THREE.Mesh(GEO.ico1, cloudMat); m.position.set((k - 2) * 46 + hash(i * 9 + k) * 20, hash(i + k) * 20, hash(k * 3 + i) * 30); m.scale.setScalar(36 + hash(i * 5 + k) * 26); g.add(m); }
  g.userData = { off: hash(i * 13) * 9000, h: 380 + hash(i * 7) * 520, z: -2600 - hash(i * 3) * 1600 };
  scene.add(g); clouds.push(g);
}

// ---------- the truck ----------
const paint = (c, rough = .45, metal = .1) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, flatShading: false });
const MAT = {
  red: paint(0xe0352b, .4), redDark: paint(0x8c150f, .55), purple: paint(0x7b3fe0, .38), purpleDark: paint(0x3a1580, .5), green: paint(0x3f9b3a, .45), greenDark: paint(0x1f5a22, .55),
  glass: new THREE.MeshStandardMaterial({ color: 0x9cc8ec, roughness: .08, metalness: .35, transparent: true, opacity: .78 }),
  chrome: paint(0xe9edf1, .2, .9), black: paint(0x222020, .85), tyre: paint(0x262321, .92), rimSilver: paint(0xd8dde2, .3, .7), rimRed: paint(0xd6302a, .4),
  rimYellow: paint(0xffc327, .45), rimLime: paint(0xb6ff3d, .45), wood: paint(0xc8823f, .8), woodDark: paint(0x93541f, .85), yellow: paint(0xffc327, .45),
  light: new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffe9a0, emissiveIntensity: 1.6 }), tail: new THREE.MeshStandardMaterial({ color: 0xff7a2c, emissive: 0xff5a10, emissiveIntensity: .8 }),
  flame: paint(0xffb02e, .5), flame2: paint(0xff6a2e, .5),
};
const flip = pts => pts.map(([x, y]) => new THREE.Vector2(x, -y));
function shape(pts){ const s = new THREE.Shape(flip(pts)); return s; }
function rrShape(x, y, w, h, r){
  const s = new THREE.Shape(); const Y = v => -v;
  s.moveTo(x + r, Y(y)); s.lineTo(x + w - r, Y(y)); s.quadraticCurveTo(x + w, Y(y), x + w, Y(y + r)); s.lineTo(x + w, Y(y + h - r));
  s.quadraticCurveTo(x + w, Y(y + h), x + w - r, Y(y + h)); s.lineTo(x + r, Y(y + h)); s.quadraticCurveTo(x, Y(y + h), x, Y(y + h - r)); s.lineTo(x, Y(y + r)); s.quadraticCurveTo(x, Y(y), x + r, Y(y));
  return s;
}
function ext(sh, depth, bevel = 2.2){
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2); return g;
}
const mesh = (g, m, cast = true) => { const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; return o; };
function chickenModel(){
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xfbf7ee, roughness: .9 }), cream = new THREE.MeshStandardMaterial({ color: 0xeee2cc, roughness: .9 });
  const red = new THREE.MeshStandardMaterial({ color: 0xe8382c, roughness: .6 }), orange = new THREE.MeshStandardMaterial({ color: 0xf5a10f, roughness: .6 }), eye = new THREE.MeshStandardMaterial({ color: 0x1b120a, roughness: .3 });
  const body = mesh(GEO.ico1, white); body.scale.set(7, 6, 5.6); g.add(body);
  const head = mesh(GEO.ico1, white); head.scale.setScalar(3.8); head.position.set(5, 5, 0); g.add(head);
  for (const [dx, dy, s] of [[3.6, 9, 1.7], [5.4, 9.6, 1.9], [7.1, 8.8, 1.5]]){ const c = mesh(GEO.ico, red); c.scale.setScalar(s); c.position.set(dx, dy, 0); g.add(c); }
  const beak = mesh(GEO.cone5, orange); beak.scale.set(1.6, 4, 1.6); beak.rotation.z = -Math.PI / 2; beak.position.set(9.6, 4.8, 0); g.add(beak);
  const wat = mesh(GEO.ico, red); wat.scale.set(1, 1.6, 1); wat.position.set(8.2, 2.4, 0); g.add(wat);
  for (const s of [-1, 1]){ const e = mesh(GEO.ico, eye, false); e.scale.setScalar(.9); e.position.set(6.6, 6, s * 2.9); g.add(e); }
  const tail = mesh(GEO.cone5, cream); tail.scale.set(3.4, 7, 3); tail.rotation.z = .9; tail.position.set(-7, 3, 0); g.add(tail);
  const wings = [];
  for (const s of [-1, 1]){ const w = mesh(GEO.ico, cream); w.scale.set(5, 3.2, 1.4); w.position.set(-1, .6, s * 5.2); g.add(w); wings.push(w); }
  const legs = [];
  for (const s of [-1, 1]){ const l = mesh(GEO.cyl6, orange); l.scale.set(.6, 4, .6); l.position.set(0, -7, s * 1.8); g.add(l); legs.push(l); }
  g.userData = { wings, legs };
  return g;
}
function wheelModel(R, kind){
  const g = new THREE.Group();
  // a tyre with tread blocks: an extruded gear outline
  const teeth = kind === 'tractor' ? 12 : 16, s = new THREE.Shape();
  for (let k = 0; k <= teeth * 2; k++){
    const a = k / (teeth * 2) * TAU, r = k % 2 ? R : R - (kind === 'pickup' ? 1.6 : 3);
    const a2 = a + TAU / (teeth * 4);
    if (k === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    s.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
  }
  const w = kind === 'monster' ? 20 : kind === 'tractor' ? 16 : 13;
  const tyre = mesh(new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.2, bevelSegments: 2 }).translate(0, 0, -w / 2), MAT.tyre);
  g.add(tyre);
  const rimMat = kind === 'tractor' ? MAT.rimYellow : kind === 'monster' ? MAT.rimLime : MAT.rimSilver;
  for (const side of [-1, 1]){
    const rim = mesh(new THREE.CylinderGeometry(R * .56, R * .56, 2, 18), rimMat); rim.rotation.x = Math.PI / 2; rim.position.z = side * (w / 2 + .6); g.add(rim);
    if (kind === 'pickup'){ const hub = mesh(new THREE.CylinderGeometry(R * .38, R * .38, 2.4, 14), MAT.rimRed); hub.rotation.x = Math.PI / 2; hub.position.z = side * (w / 2 + 1.2); g.add(hub); }
    const cap = mesh(new THREE.CylinderGeometry(R * .14, R * .14, 3.4, 10), MAT.chrome); cap.rotation.x = Math.PI / 2; cap.position.z = side * (w / 2 + 1.4); g.add(cap);
    for (let k = 0; k < 5; k++){ const a = k / 5 * TAU, b = mesh(GEO.ico, MAT.chrome, false); b.scale.setScalar(1.1); b.position.set(Math.cos(a) * R * .27, Math.sin(a) * R * .27, side * (w / 2 + 1.6)); g.add(b); }
  }
  return g;
}
function truckModel(V, parent = scene){
  const kind = V.id, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const BED = H.BED;
  if (kind === 'tractor'){
    body.add(mesh(ext(rrShape(-62, -14, 122, 25, 6), 40), MAT.green));
    body.add(mesh(ext(rrShape(34, -30, 28, 26, 6), 34), MAT.green));
    const guard = mesh(new THREE.CylinderGeometry(28, 28, 44, 16, 1, true, -Math.PI * .5, Math.PI), MAT.greenDark); guard.rotation.x = Math.PI / 2; guard.rotation.z = Math.PI / 2; guard.position.set(-36, -12, 0); body.add(guard);
    for (const x of [5.5, 32.5]) for (const z of [-17, 17]) { const p = mesh(GEO.box, MAT.black); p.scale.set(3, 36, 3); p.position.set(x, 28, z); body.add(p); }
    const roof = mesh(ext(rrShape(0, -51, 38, 6, 3), 40, 1.2), MAT.yellow); body.add(roof);
    const ex = mesh(GEO.cyl8, MAT.black); ex.scale.set(2.4, 22, 2.4); ex.position.set(47, 40, 10); body.add(ex);
    const hl = mesh(GEO.ico1, MAT.light, false); hl.scale.set(2, 3, 3); hl.position.set(62, 22, 9); body.add(hl);
  } else {
    const mon = kind === 'monster', main = mon ? MAT.purple : MAT.red, dark = mon ? MAT.purpleDark : MAT.redDark;
    body.add(mesh(ext(rrShape(-62, -14, 122, 25, 6), 44), main));
    body.add(mesh(ext(shape([[-2, -12], [2, -39], [4, -45], [10, -46], [30, -46], [35, -45], [36.5, -41], [43, -16], [43, -12]]), 40), main));
    body.add(mesh(ext(rrShape(36, -18, 24, 14, 5), 42), main));
    const sk = mesh(GEO.box, dark); sk.scale.set(118, 6, 46); sk.position.set(-1, -8, 0); body.add(sk);
    // windows: side glass on both sides and a windscreen
    const winPts = [[6, -18], [8.5, -38], [13, -41.5], [29, -41.5], [33, -38.5], [38.5, -18]];
    for (const z of [-23.4, 23.4]){ const w = mesh(new THREE.ShapeGeometry(shape(winPts)), MAT.glass, false); w.position.z = z; if (z < 0) w.rotation.y = Math.PI, w.position.x = 0, w.scale.x = -1; body.add(w); }
    const ws = mesh(GEO.box, MAT.glass, false); ws.scale.set(1, 24, 34); ws.position.set(41.2, 29, 0); ws.rotation.z = -.27; body.add(ws);
    // driver: a chicken behind the wheel
    const drv = chickenModel(); drv.scale.setScalar(1.05); drv.position.set(18, 22, 0); body.add(drv);
    for (const z of [-15, 15]){ const l = mesh(GEO.ico1, MAT.light, false); l.scale.set(1.6, 3.2, 3.6); l.position.set(60.5, 10, z); body.add(l); }
    for (const z of [-17, 17]){ const l = mesh(GEO.box, MAT.tail, false); l.scale.set(2, 6, 5); l.position.set(-63, 9, z); body.add(l); }
    const fb = mesh(GEO.box, MAT.chrome); fb.scale.set(7, 11, 48); fb.position.set(61, -2.5, 0); body.add(fb);
    const rb = mesh(GEO.box, MAT.chrome); rb.scale.set(7, 10, 48); rb.position.set(-64, -2, 0); body.add(rb);
    if (mon){
      for (let k = 0; k < 3; k++){ const l = mesh(GEO.box, MAT.light, false); l.scale.set(5, 4, 6); l.position.set(13 + k * 7, 48, (k - 1) * 10); body.add(l); }
      for (const z of [-23.4, 23.4]) for (let k = 0; k < 6; k++){ const f = mesh(GEO.cone5, k % 2 ? MAT.flame2 : MAT.flame, false); f.scale.set(4, 13, 1); f.rotation.z = -1.25; f.position.set(-52 + k * 14, -2, z); body.add(f); }
    } else {
      for (const mx of V.mounts.map(m => m[0])) for (const z of [-22.4, 22.4]){ const a = mesh(new THREE.TorusGeometry(19.5, 2.2, 6, 16, Math.PI), MAT.black, false); a.position.set(mx, -11, z); body.add(a); }
    }
  }
  // the bed: floor, tailgate (height follows the Crate upgrade), front board and low side rails
  const floor = mesh(GEO.box, MAT.woodDark); floor.scale.set(BED.x1 - BED.x0 + 4, 5, 40); floor.position.set((BED.x0 + BED.x1) / 2, -BED.floor - 2.5, 0); body.add(floor);
  const tail = mesh(GEO.box, MAT.wood); tail.scale.set(6, 1, 42); body.add(tail);
  const front = mesh(GEO.box, MAT.wood); front.scale.set(6, 28, 42); front.position.set(BED.x1 + 2, 26, 0); body.add(front);
  const rails = [];
  for (const z of [-19.5, 19.5]){ const r = mesh(GEO.box, MAT.wood); r.scale.set(BED.x1 - BED.x0 + 4, 1, 3); r.position.z = z; body.add(r); rails.push(r); }
  // headlight beam for the night
  const spot = new THREE.SpotLight(0xffe2a0, 0, 1100, .42, .6, 0);
  spot.position.set(62, 10, 0); spot.target.position.set(400, -40, 0); body.add(spot, spot.target);
  const wheels = V.mounts.map((_, i) => [-1, 1].map(() => { const w = wheelModel(V.wheelR[i], kind); parent.add(w); return w; }));
  const struts = V.mounts.map(() => [-1, 1].map(() => { const s = mesh(GEO.box, kind === 'monster' ? MAT.yellow : MAT.black); parent.add(s); return s; }));
  g.userData = { tail, rails, wheels, struts, spot, kind };
  parent.add(g);
  return g;
}
const trucks = {};
function truckFor(V){ if (!trucks[V.id]) trucks[V.id] = truckModel(V); return trucks[V.id]; }
function hideTruck(t){ t.visible = false; for (const p of t.userData.wheels) for (const w of p) w.visible = false; for (const p of t.userData.struts) for (const s of p) s.visible = false; }

// ---------- chickens, coins, cans, stands, posts (pooled) ----------
const henPool = [];
function hen(i){ while (henPool.length <= i){ const h = chickenModel(); scene.add(h); henPool.push(h); } return henPool[i]; }
const coinGeo = new THREE.CylinderGeometry(8.5, 8.5, 2.6, 18), coinMat = new THREE.MeshStandardMaterial({ color: 0xffc62e, roughness: .3, metalness: .55, emissive: 0xb87400, emissiveIntensity: .55 });
const coinPool = [];
function coin(i){ while (coinPool.length <= i){ const c = mesh(coinGeo, coinMat); c.rotation.x = Math.PI / 2; const w = new THREE.Group(); w.add(c); scene.add(w); coinPool.push(w); } return coinPool[i]; }
const canPool = [];
function can(i){
  while (canPool.length <= i){
    const g = new THREE.Group(), red = paint(0xd8261c, .35, .2);
    const b = mesh(ext(rrShape(-12, -13, 24, 29, 3), 14, 1.5), red); g.add(b);
    const cap = mesh(GEO.cyl8, MAT.black); cap.scale.set(3.4, 6, 3.4); cap.position.set(5, 16, 0); g.add(cap);
    scene.add(g); canPool.push(g);
  }
  return canPool[i];
}
function textTex(text, w = 256, h = 64, bg = '#8f5a2c', fg = '#fff3dc', size = 34){
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = fg; g.font = `900 ${size}px ui-rounded,"Nunito",system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const signTex = { open: textTex('FARM STAND'), done: textTex('✓ THANKS!', 256, 64, '#2f8a3e') };
const standPool = [];
function stand(i){
  while (standPool.length <= i){
    const g = new THREE.Group();
    for (const x of [-38, 38]) for (const z of [-22, 22]){ const p = mesh(GEO.box, MAT.woodDark); p.scale.set(5, 104, 5); p.position.set(x, 52, z); g.add(p); }
    const counter = mesh(GEO.box, MAT.wood); counter.scale.set(92, 46, 50); counter.position.set(0, 23, 0); g.add(counter);
    const eggMat = new THREE.MeshStandardMaterial({ color: 0xfff4e2, roughness: .6 });
    for (let k = 0; k < 7; k++){ const e = mesh(GEO.ico1, eggMat); e.scale.set(3.6, 4.6, 3.6); e.position.set(-33 + k * 11, 50, 12 - (k % 2) * 8); g.add(e); }
    for (let k = 0; k < 6; k++){ const a = mesh(GEO.box, k % 2 ? paint(0xffffff, .7) : paint(0xe0352b, .6)); a.scale.set(17, 3, 62); a.position.set(-42.5 + k * 17, 106, 6); a.rotation.x = -.12; g.add(a); }
    const roof = mesh(GEO.box, MAT.redDark); roof.scale.set(108, 4, 70); roof.position.set(0, 110, 0); g.add(roof);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(84, 21), new THREE.MeshStandardMaterial({ map: signTex.open, roughness: .8 })); sign.position.set(0, 132, 4); g.add(sign);
    const pole = mesh(GEO.cyl6, MAT.chrome); pole.scale.set(1.6, 200, 1.6); pole.position.set(-52, 100, 0); g.add(pole);
    const flag = mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(40, -12), new THREE.Vector2(0, -24)])), paint(0xe0352b, .6)); flag.position.set(-52, 200, 1); g.add(flag);
    g.userData = { sign, flag };
    scene.add(g); standPool.push(g);
  }
  return standPool[i];
}
const postTex = {};
const postPool = [];
function post(i){ while (postPool.length <= i){ const g = new THREE.Group(); const p = mesh(GEO.box, paint(0xfff3dc, .7)); p.scale.set(4, 40, 4); p.position.y = 20; g.add(p); const s = new THREE.Mesh(new THREE.PlaneGeometry(44, 18), new THREE.MeshStandardMaterial({ roughness: .8 })); s.position.set(0, 50, 2.5); g.add(s); g.userData.s = s; scene.add(g); postPool.push(g); } return postPool[i]; }

// ---------- sky: the game's own painted sky, blended between zones ----------
const skyCanvas = document.createElement('canvas'); let skyTex = null, skyKey = '';
function updateSky(P){
  const a = H.ZONES[P.z.a].id, b = H.ZONES[P.z.b].id, t = Math.round(P.z.t * 40) / 40;
  const imA = H.skyImage(a); if (!imA) return;
  const key = a + b + t + imA.width + 'x' + imA.height; if (key === skyKey) return; skyKey = key;
  skyCanvas.width = imA.width; skyCanvas.height = imA.height;
  const g = skyCanvas.getContext('2d'); g.globalAlpha = 1; g.drawImage(imA, 0, 0);
  if (t > 0){ const imB = H.skyImage(b); if (imB){ g.globalAlpha = t; g.drawImage(imB, 0, 0); } }
  if (!skyTex){ skyTex = new THREE.CanvasTexture(skyCanvas); skyTex.colorSpace = THREE.SRGBColorSpace; scene.background = skyTex; }
  else skyTex.needsUpdate = true;
}

// ---------- per frame ----------
const terrain = new Map(), far = new Map(); let lastT = null;
function syncChunks(map, w, build, lo, hi){
  const a = Math.floor(lo / w), b = Math.floor(hi / w);
  for (let i = a; i <= b; i++) if (!map.has(i)){ const m = build(i); scene.add(m); map.set(i, m); }
  for (const [i, m] of map) if (i < a - 1 || i > b + 1){ scene.remove(m); m.traverse(o => { if (o.geometry) o.geometry.dispose(); }); map.delete(i); }
}
function clearChunks(){ for (const map of [terrain, far]){ for (const [, m] of map){ scene.remove(m); m.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } map.clear(); } }

// ---------- 3D dust and smoke: low-poly puffs that grow and shrink away ----------
const FX_MAX = lowEnd ? 90 : 200;
const fxMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x302820 }), FX_MAX);
fxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fxMesh.frustumCulled = false; fxMesh.castShadow = false;
fxMesh.setColorAt(0, new THREE.Color()); scene.add(fxMesh);
const fx = []; let fxLast = 0, smokeT = 0;
const BITS_MAX = 120, bitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: .5 }), BITS_MAX);
bitMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bitMesh.frustumCulled = false; bitMesh.castShadow = true; bitMesh.setColorAt(0, new THREE.Color()); scene.add(bitMesh);
function puff(x, y, z, vx, vy, vz, r, life, color, rise = 0){ if (fx.length >= FX_MAX) fx.shift(); fx.push({ x, y, z, vx, vy, vz, r, life, max: life, color: new THREE.Color(color), rise, spin: Math.random() * 6 }); }
const fxObj = new THREE.Object3D();
function stepFx(G, now, P){
  const dt = Math.min(.05, Math.max(0, now - fxLast)); fxLast = now;
  const dust = new THREE.Color(rgbOf(P.dirtTop)).lerp(new THREE.Color(0xfff6e8), .6).getHex();
  if (G && !G.waiting){
    // wheels kick up dust while driving fast on the ground
    const sp = Math.abs(G.c.vx);
    G.wheels.forEach((w, i) => {
      w._dust = (w._dust || 0) + dt * 9 * Math.min(1, sp / 600);
      if (!w.ground || sp < 140){ w._dust = 0; return; }
      while (w._dust >= 1){
        w._dust -= 1; const back = -Math.sign(G.c.vx || 1), s = Math.random() < .6 ? 1 : -1;
        puff(w.x + back * w.R * .7, -(w.y + w.R * .75), s * 26, back * (30 + Math.random() * 50), 30 + Math.random() * 30, s * (8 + Math.random() * 14), 3.5 + Math.random() * 2.5 + sp / 260, .4 + Math.random() * .2, dust, 60);
      }
    });
    // landing dust from the game: turn each new puff into a few 3D ones
    for (const p of G.puffs){ if (p._3d) continue; p._3d = 1; for (const s of [-1, 0, 1]) puff(p.x, -p.y, s * 22 + (Math.random() - .5) * 10, p.vx * .8, -p.vy * .8, s * 30, p.r * 1.3, p.life + .2, dust, 10); }
    // after a crash: smoke from the engine
    if (G.crashed){ smokeT -= dt; if (smokeT <= 0){ smokeT = .07; const e = local(G.c, 48, -6); puff(e.x + (Math.random() - .5) * 10, -e.y, (Math.random() - .5) * 20, (Math.random() - .5) * 20, 50 + Math.random() * 30, 0, 7 + Math.random() * 5, 1.6, Math.random() < .5 ? 0x4a4644 : 0x6e6a66, 40); } }
  }
  let n = 0;
  for (let i = fx.length - 1; i >= 0; i--){
    const f = fx[i]; f.life -= dt; if (f.life <= 0){ fx.splice(i, 1); continue; }
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.vx *= .96; f.vz *= .96; f.vy = f.vy * .95 + f.rise * dt;
    const k = f.life / f.max, sc = f.r * (k > .7 ? (1 - k) / .3 * .7 + .3 : 1) * (.4 + k * .9);
    fxObj.position.set(f.x, f.y, f.z); fxObj.rotation.set(f.spin, f.spin * .7, now + f.spin); fxObj.scale.setScalar(Math.max(.01, sc)); fxObj.updateMatrix();
    fxMesh.setMatrixAt(n, fxObj.matrix); fxMesh.setColorAt(n, f.color); n++;
  }
  fxMesh.count = n; fxMesh.instanceMatrix.needsUpdate = true; if (fxMesh.instanceColor) fxMesh.instanceColor.needsUpdate = true;
  // crash debris and pickup bits from the game, as small tumbling 3D pieces
  let m = 0;
  if (G) for (const p of G.parts){
    if (p.spark || m >= BITS_MAX) continue;
    if (p._z === undefined){ p._z = (Math.random() - .5) * 60; p._r = Math.random() * 6; }
    const sc = p.s * Math.min(1, p.life * 2) * 1.1;
    fxObj.position.set(p.x, -p.y, p._z); fxObj.rotation.set(p._r + now * 7, p._r * 2 + now * 5, p._r); fxObj.scale.set(sc, sc, sc * .6); fxObj.updateMatrix();
    bitMesh.setMatrixAt(m, fxObj.matrix); bitMesh.setColorAt(m, tmpC.set(p.c)); m++;
  }
  bitMesh.count = m; bitMesh.instanceMatrix.needsUpdate = true; if (bitMesh.instanceColor) bitMesh.instanceColor.needsUpdate = true;
}

// truck pose helpers (the game's local frame: x forward, y down)
const local = (c, lx, ly) => { const cs = Math.cos(c.a), sn = Math.sin(c.a); return { x: c.x + lx * cs - ly * sn, y: c.y + lx * sn + ly * cs }; };
function placeTruck(V, c, wheels, wall, night){
  const t = truckFor(V), ud = t.userData, BED = H.BED;
  t.visible = true; t.position.set(c.x, -c.y, 0); t.rotation.set(0, 0, -c.a);
  ud.tail.scale.y = wall + 12; ud.tail.position.set(BED.x0 - 2, -(BED.floor - wall + (wall + 12) / 2), 0);
  for (const r of ud.rails){ r.scale.y = Math.max(5, wall * .55); r.position.set((BED.x0 + BED.x1) / 2, -(BED.floor - r.scale.y / 2), r.position.z); }
  ud.spot.intensity = night * 9;
  const halfW = V.id === 'monster' ? 30 : 26;
  wheels.forEach((w, i) => {
    ud.wheels[i].forEach((m, s) => { m.visible = true; m.position.set(w.x, -w.y, (s ? 1 : -1) * halfW); m.rotation.set(0, 0, -w.rot); });
    // struts from the body mount down to each wheel
    const mt = local(c, V.mounts[i][0], V.mounts[i][1] - 4);
    ud.struts[i].forEach((st, s) => {
      const ax = mt.x, ay = -mt.y, bx = w.x, by = -w.y, len = Math.hypot(bx - ax, by - ay);
      st.visible = true; st.scale.set(V.id === 'monster' ? 5 : 3.5, len, 3.5); st.position.set((ax + bx) / 2, (ay + by) / 2, (s ? 1 : -1) * (halfW - 9)); st.rotation.set(0, 0, Math.atan2(by - ay, bx - ax) - Math.PI / 2);
    });
  });
}
// the menu truck: wheels on the road, body resting on them, a little bounce
function menuPose(V, x, now){
  const wheels = V.mounts.map(([mx], i) => { const wx = x + mx, R = V.wheelR[i]; return { x: wx, y: H.groundY(wx) - R, rot: wx / R }; });
  const [r, f] = wheels, a = Math.atan2(f.y - r.y, f.x - r.x), dx = f.x - r.x;
  const lift = V.mounts[0][1] + V.rest - 2 + Math.sin(now * 9) * 1.2;
  const mid = { x: (r.x + f.x) / 2 - (V.mounts[0][0] + V.mounts[1][0]) / 2 * Math.cos(a), y: (r.y + f.y) / 2 - (V.mounts[0][0] + V.mounts[1][0]) / 2 * Math.sin(a) };
  const c = { x: mid.x + lift * Math.sin(a), y: mid.y - lift * Math.cos(a), a };
  return { c, wheels };
}

// ---------- quality: step down automatically when frames run slow (weak phones) ----------
// level 0: full; 1: lower resolution; 2: no shadows; 3: resolution 1x, fewer effects
const Q = { level: 0, maxRes: 2, ema: 16.7, last: 0, slowFor: 0 };
function setQuality(l){
  Q.level = l; Q.maxRes = [2, 1.5, 1.5, 1][l]; sun.castShadow = l < 2;
  for (const c of clouds) c.visible = l < 3;
}
if (/[?&]lowgfx(&|=|$)/.test(location.search)) setQuality(3); else if (lowEnd) setQuality(1);
function governor(now){
  const dt = (now - Q.last) * 1000; Q.last = now;
  if (dt <= 0 || dt > 200 || document.hidden) return;          // skip tab switches and stalls
  Q.ema += (dt - Q.ema) * .05;
  Q.slowFor = Q.ema > 22 ? Q.slowFor + dt : 0;
  if (Q.slowFor > 2000 && Q.level < 3){ setQuality(Q.level + 1); Q.slowFor = 0; Q.ema = 16.7; }
}

function render(camX, camY, sx = 0, sy = 0, now = performance.now() / 1000){
  const VW = H.VW, VH = H.VH, dpr = H.dpr, k = H.scale, G = H.G;
  if (!VW || !VH) return;
  H.ensureTerrain();
  const T = H.T; if (T !== lastT){ clearChunks(); lastT = T; }
  if (!G){ let a = 0; for (let q = -4; q <= 4; q++) a += H.groundY(camX + q * 120); camY = a / 9 - 40; }
  // size and camera: identical framing to the 2D game (the z = 0 plane maps 1:1 to its transform)
  governor(now);
  const pr = Math.min(dpr, Q.maxRes), pw = Math.round(VW * pr), ph = Math.round(VH * pr);
  if (glCanvas.width !== pw || glCanvas.height !== ph){ renderer.setPixelRatio(pr); renderer.setSize(VW, VH, false); }
  const D = (VH / 2) / (k * Math.tan(FOV * Math.PI / 360));
  camera.aspect = VW / VH; camera.position.set(camX - sx / k, -camY + ELEV + sy / k, D);
  const shift = VH / 2 + ELEV * k - VH * H.horizon();
  camera.setViewOffset(VW, VH, 0, shift, VW, VH); camera.updateProjectionMatrix();

  // zone look
  const P = H.palAt(camX);
  updateSky(P);
  const night = P.night;
  scene.fog.color.setRGB(...P.far.slice(0, 3).map(v => v / 255)).lerp(new THREE.Color(night > .5 ? 0x141a40 : 0xffe4bc), .35);
  hemi.intensity = 1.25 - night * .45; hemi.color.set(lerpHex(0xe8f0ff, 0x7d8fe0, night)); hemi.groundColor.set(lerpHex(0x8a6a40, 0x2a2850, night));
  sun.intensity = 2.6 - night * 1.7; sun.color.set(lerpHex(0xfff0d6, 0xa8b8ff, night));
  sun.position.set(camX + 700, -camY + 1300, 900); sun.target.position.set(camX, -camY, 0);
  renderer.toneMappingExposure = 1.08 + night * .1;

  // world chunks around the camera (wider for things far behind)
  const half = VW / 2 / k;
  syncChunks(terrain, CW, buildTerrain, camX - half * 2.2 - 400, camX + half * 2.2 + 600);
  syncChunks(far, FARW, buildFar, camX - half * 6 - 3000, camX + half * 6 + 3000);
  for (const c of clouds){ const u = c.userData, span = 12000; c.position.set(camX * .7 + (((u.off - now * 8 - camX * .3) % span) + span) % span - span / 2, -camY + u.h, u.z); }

  // the truck
  // the truck: the run's, or on the menu the player's own truck rolling along behind the card
  const V = G ? G.V : H.vehicle();
  for (const id in trucks) if (id !== V.id) hideTruck(trucks[id]);
  let henI = 0;
  if (!G){
    const m = menuPose(V, camX - (VW / k) * .31, now);
    placeTruck(V, m.c, m.wheels, 15, night);
    for (let i = 0; i < 4; i++){
      const h = hen(henI++), lx = H.BED.x0 + 9 + i * 13, hop = Math.max(0, Math.sin(now * 7 + i * 1.9)) * 7;
      const p = local(m.c, lx, H.BED.floor - 7 - hop);
      h.visible = true; h.position.set(p.x, -p.y, (hash(i) - .5) * 22); h.rotation.set(0, 0, -m.c.a);
      h.userData.wings.forEach((w, s) => w.rotation.x = (s ? 1 : -1) * (hop > 3 ? Math.sin(now * 40) * 1.1 : 0));
      h.userData.legs.forEach(l => l.visible = false);
    }
  }
  if (G){
    const c = G.c;
    placeTruck(V, c, G.wheels, G.S.wall, night);
    // chickens: in the crate, flying, or wandering on the road
    for (const e of G.hens){
      const h = hen(henI++); h.visible = true;
      const zOff = (hash(e.id * 7.31) - .5) * 22;
      h.position.set(e.x, -e.y, e.aboard ? zOff : zOff * 1.6);
      const tilt = e.aboard ? -c.a : Math.sin(now * 9 + e.id * 10) * .5;
      h.rotation.set(0, e.loose ? Math.sin(e.id * 31) * 1.2 : 0, tilt);
      const fl = e.flap ? Math.sin(e.flap) * .9 : 0;
      h.userData.wings.forEach((w, s) => w.rotation.x = (s ? 1 : -1) * (fl * 1.2));
      h.userData.legs.forEach(l => l.visible = !e.aboard || !!e.loose);
    }
    // delivered chickens hopping onto the counter
    for (const hp of G.hoppers){
      if (hp.t < 0) continue;
      const kk = Math.min(1, hp.t / hp.dur), x = hp.x0 + (hp.x1 - hp.x0) * kk, y = hp.y0 + (hp.y1 - hp.y0) * kk - Math.sin(kk * Math.PI) * 46;
      const h = hen(henI++); h.visible = hp.dur + 1.6 - hp.t > 0; h.position.set(x, -y, -40 * kk); h.rotation.set(0, 0, 0);
      h.userData.wings.forEach((w, s) => w.rotation.x = (s ? 1 : -1) * (kk < 1 ? Math.sin(hp.t * 30) : 0));
    }
  }
  for (let i = henI; i < henPool.length; i++) henPool[i].visible = false;

  // pickups and stands in view
  const L = camX - half * 1.4 - 120, R = camX + half * 1.4 + 120;
  let ci = 0, ki = 0, si = 0, pi = 0;
  if (T){
    for (const kc of T.coins){ if (kc.got || kc.x < L || kc.x > R) continue; const m = coin(ci++); m.visible = true; m.position.set(kc.x, -(H.groundY(kc.x) - kc.lift), 0); m.rotation.y = now * 3 + kc.x * .01; }
    for (const f of T.cans){ if (f.got || f.x < L || f.x > R) continue; const m = can(ki++); m.visible = true; m.position.set(f.x, -(H.groundY(f.x) - 24), 0); m.rotation.y = Math.sin(now * 2) * .4; }
    for (const s of T.stations){
      if (s.x < L - 200 || s.x > R + 200) continue;
      const m = stand(si++); m.visible = true; m.position.set(s.x + 40, gy(s.x), -170);
      m.userData.sign.material.map = s.done ? signTex.done : signTex.open; m.userData.flag.material.color.set(s.done ? 0x2fae4e : 0xe0352b);
      m.userData.flag.rotation.y = Math.sin(now * 3 + s.x) * .25;
    }
    const PXM = H.PX_PER_M;
    for (let mm = Math.ceil(L / PXM / 50) * 50; mm * PXM < R; mm += 50){
      if (mm <= 0) continue;
      const x = mm * PXM, m = post(pi++); m.visible = true; m.position.set(x, gy(x), ROAD_BACK - 4);
      if (!postTex[mm]) postTex[mm] = textTex(mm + ' m', 128, 52, '#fff3dc', '#5e3a1a', 30);
      if (m.userData.s.material.map !== postTex[mm]){ m.userData.s.material.map = postTex[mm]; m.userData.s.material.needsUpdate = true; }
      m.userData.s.visible = !H.COVER;
    }
  }
  for (let i = ci; i < coinPool.length; i++) coinPool[i].visible = false;
  for (let i = ki; i < canPool.length; i++) canPool[i].visible = false;
  for (let i = si; i < standPool.length; i++) standPool[i].visible = false;
  for (let i = pi; i < postPool.length; i++) postPool[i].visible = false;

  stepFx(G, now, P);
  renderer.render(scene, camera);
}

// ---------- garage pictures: each truck rendered once, three-quarter view, transparent background ----------
let pv = null;
function preview(V){
  if (!pv){
    const canvas = document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(2); r.setSize(300, 186, false); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const sc = new THREE.Scene(); sc.environment = scene.environment; sc.environmentIntensity = .4;
    sc.add(new THREE.HemisphereLight(0xeef4ff, 0x8a6a40, 1.4));
    const d = new THREE.DirectionalLight(0xfff0d6, 2.6); d.position.set(120, 260, 200); d.castShadow = true; d.shadow.mapSize.set(1024, 1024);
    Object.assign(d.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 10, far: 800 }); sc.add(d);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 40), new THREE.ShadowMaterial({ opacity: .28 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);
    const cam = new THREE.PerspectiveCamera(23, 300 / 186, 10, 2000);
    pv = { r, sc, cam, ground, canvas };
  }
  const { r, sc, cam, ground, canvas } = pv;
  const g = new THREE.Group(); sc.add(g);
  const t = truckModel(V, g), ud = t.userData, BED = H.BED, wall = 15;
  ud.tail.scale.y = wall + 12; ud.tail.position.set(BED.x0 - 2, -(BED.floor - wall + (wall + 12) / 2), 0);
  for (const rl of ud.rails){ rl.scale.y = wall * .55; rl.position.set((BED.x0 + BED.x1) / 2, -(BED.floor - rl.scale.y / 2), rl.position.z); }
  const halfW = V.id === 'monster' ? 30 : 26;
  let low = 0;
  V.mounts.forEach(([mx, my], i) => {
    const wy = -(my + V.rest); low = Math.min(low, wy - V.wheelR[i]);
    ud.wheels[i].forEach((w, s2) => { w.position.set(mx, wy, (s2 ? 1 : -1) * halfW); w.rotation.z = -.4 - i; });
    ud.struts[i].forEach((st, s2) => { st.scale.set(V.id === 'monster' ? 5 : 3.5, V.rest + 4, 3.5); st.position.set(mx, -(my - 4 + (V.rest + 4) / 2), (s2 ? 1 : -1) * (halfW - 9)); });
  });
  for (let k = 0; k < 3; k++){ const h = chickenModel(); h.position.set(BED.x0 + 10 + k * 15, -(BED.floor - 7), (k - 1) * 9); h.rotation.y = (k - 1) * .3; h.userData.legs.forEach(l => l.visible = false); g.add(h); }
  ground.position.y = low;
  cam.position.set(115, 100, 330); cam.lookAt(0, low + 40, 0);
  r.render(sc, cam);
  const url = canvas.toDataURL();
  sc.remove(g); g.traverse(o => { if (o.geometry && !Object.values(GEO).includes(o.geometry) && o.geometry !== coinGeo) o.geometry.dispose(); });
  return url;
}
glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); window.World3D = null; glCanvas.style.display = 'none'; dispatchEvent(new Event('world3dfail')); });   // the 2D game takes over
window.World3D = { preview, ok: true, render, scene, camera, far, terrain, THREE, Q, setQuality };
dispatchEvent(new Event('world3d'));
}
