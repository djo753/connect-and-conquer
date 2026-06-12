import * as THREE from 'three';

// ---------------- Renderer / Scene / Camera ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 250, 700);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2500);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------- Lights ----------------
const sun = new THREE.DirectionalLight(0xffffff, 1.15);
sun.position.set(120, 240, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -350; sc.right = 350; sc.top = 350; sc.bottom = -350; sc.near = 1; sc.far = 900;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// ---------------- Track curve ----------------
const UP = new THREE.Vector3(0, 1, 0);
const ctrl = [
  [0, 0], [140, -40], [230, -150], [200, -300], [60, -370],
  [-110, -350], [-230, -240], [-260, -80], [-150, 60], [-20, 70],
].map(([x, z]) => new THREE.Vector3(x, 0, z));
const curve = new THREE.CatmullRomCurve3(ctrl, true, 'catmullrom', 0.5);
const TRACK_LEN = curve.getLength();
const BASE_SPEED = TRACK_LEN / 45; // ~45s/lap unmodified

// Elevation is a separate function (never < 0) so the road can never sink
// below the ground plane; the spline only defines the horizontal path.
function elevation(u) {
  u = ((u % 1) + 1) % 1;
  return 7 * (1 - Math.cos(2 * Math.PI * u)) + 6 * (1 - Math.cos(4 * Math.PI * u));
}
function elevationGrade(u) {
  u = ((u % 1) + 1) % 1;
  return (7 * 2 * Math.PI * Math.sin(2 * Math.PI * u) + 6 * 4 * Math.PI * Math.sin(4 * Math.PI * u)) / TRACK_LEN;
}
const RAIL_MIN_H = 2.5; // guardrails appear where the road is this high above ground

const LANE_W = 5;
const MAX_LANES = 5;
const MAX_ROAD_HALF = LANE_W * MAX_LANES / 2; // widest section
// road width varies along the lap (3 / 4 / 5 lanes)
function lanesAt(u) {
  u = ((u % 1) + 1) % 1;
  if (u < 0.20) return 3;
  if (u < 0.40) return 4;
  if (u < 0.60) return 5;
  if (u < 0.80) return 4;
  return 3;
}
function roadHalfAt(u) { return lanesAt(u) * LANE_W / 2; }
const laneOffset = (i, n) => (i - (n - 1) / 2) * LANE_W;

// position + frame on the track for a given param u and lateral offset
function trackPoint(u, lateral) {
  u = ((u % 1) + 1) % 1;
  const pos = curve.getPointAt(u);
  pos.y = elevation(u);
  const tan = curve.getTangentAt(u).normalize();
  const right = new THREE.Vector3().crossVectors(UP, tan).normalize(); // +lateral = screen right
  return { pos: pos.clone().addScaledVector(right, lateral), tan, right };
}

// ---------------- Geometry helpers ----------------
function makeRibbon(offset, halfW, color, y, samples = 500) {
  const verts = [], idx = [];
  for (let i = 0; i < samples; i++) {
    const { pos: c, right } = trackPoint(i / samples, offset);
    const a = c.clone().addScaledVector(right, halfW);
    const b = c.clone().addScaledVector(right, -halfW);
    verts.push(a.x, a.y + y, a.z, b.x, b.y + y, b.z); // ride the track elevation
  }
  for (let i = 0; i < samples; i++) {
    const j = (i + 1) % samples;
    idx.push(i * 2, i * 2 + 1, j * 2 + 1, i * 2, j * 2 + 1, j * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function makeBox(w, h, d, color) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15 })
  );
  m.castShadow = true;
  return m;
}

// ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// dirt embankment: vertical walls from the road edges down to ground level
function makeEmbankment(samples = 500) {
  const verts = [], idx = [];
  for (let i = 0; i < samples; i++) {
    const u = i / samples;
    const { pos: c, right } = trackPoint(u, 0);
    const EDGE = roadHalfAt(u) + 1.2;
    const lt = c.clone().addScaledVector(right, -EDGE);
    const rt = c.clone().addScaledVector(right, EDGE);
    verts.push(lt.x, lt.y, lt.z, lt.x, -2, lt.z, rt.x, rt.y, rt.z, rt.x, -2, rt.z);
  }
  for (let i = 0; i < samples; i++) {
    const a = i * 4, b = ((i + 1) % samples) * 4;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
    idx.push(a + 2, b + 2, b + 3, a + 2, b + 3, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x5b4a32, roughness: 1, side: THREE.DoubleSide }));
  m.receiveShadow = true; scene.add(m);
}
makeEmbankment();

// guardrails along the WHOLE road, both edges
function makeGuardrails(samples = 800) {
  const RAIL_H = 1.0, verts = [], idx = []; let v = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < samples; i++) {
      const u0 = i / samples, u1 = (i + 1) / samples;
      const a = trackPoint(u0, side * (roadHalfAt(u0) + 0.3)).pos;
      const b = trackPoint(u1, side * (roadHalfAt(u1) + 0.3)).pos;
      verts.push(a.x, a.y + 0.4, a.z, a.x, a.y + 0.4 + RAIL_H, a.z,
                 b.x, b.y + 0.4 + RAIL_H, b.z, b.x, b.y + 0.4, b.z);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }));
  m.castShadow = true; scene.add(m);
}
makeGuardrails();

// variable-width road + shoulder ribbons
function makeVarRibbon(extraHalf, color, y, samples = 700) {
  const verts = [], idx = [];
  for (let i = 0; i < samples; i++) {
    const u = i / samples;
    const { pos: c, right } = trackPoint(u, 0);
    const hw = roadHalfAt(u) + extraHalf;
    const a = c.clone().addScaledVector(right, hw);
    const b = c.clone().addScaledVector(right, -hw);
    verts.push(a.x, a.y + y, a.z, b.x, b.y + y, b.z);
  }
  for (let i = 0; i < samples; i++) {
    const j = (i + 1) % samples;
    idx.push(i * 2, i * 2 + 1, j * 2 + 1, i * 2, j * 2 + 1, j * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  m.receiveShadow = true; scene.add(m);
}
makeVarRibbon(1.2, 0x1f2226, 0.03); // dark shoulder
makeVarRibbon(0, 0x33373d, 0.05);   // tarmac

// ---------------- Materials & objective tiles ----------------
const CONFIG = { laneMarks: true, offroad: true, mode: 'plow', laneSnap: false };
const CELLS = 130;
const MATERIALS = ['grass', 'wheat', 'berries'];
const MAT_COLORS = { grass: 0x57a64a, wheat: 0xe3c34e, berries: 0x9b4dca };
const TARMAC_GRAY = 0x33373d;
const matColorHex = (key) => (key === 'gray' ? TARMAC_GRAY : MAT_COLORS[key]);

// ordered objectives (precisely configurable). Tiles placed == totals, no extra.
const REQUIREMENTS = [
  { mat: 'grass',   amount: 50 },
  { mat: 'wheat',   amount: 80 },
  { mat: 'berries', amount: 60 },
  { mat: 'grass',   amount: 50 },
  { mat: 'wheat',   amount: 150 },
];

const laneCountPerCell = [];
for (let c = 0; c < CELLS; c++) laneCountPerCell.push(lanesAt((c + 0.5) / CELLS));

// place exactly the required number of each material tile, spread across the loop
const matTotals = {};
for (const r of REQUIREMENTS) matTotals[r.mat] = (matTotals[r.mat] || 0) + r.amount;
const laneColors = [], baseColors = [];
for (let c = 0; c < CELLS; c++) {
  laneColors.push(new Array(laneCountPerCell[c]).fill('gray'));
  baseColors.push(new Array(laneCountPerCell[c]).fill('gray'));
}
// lay down long contiguous runs of a single material along one lane,
// so the road reads as logical lanes of grass / wheat / berries
const RUN_MIN = 7, RUN_MAX = 16;
function fillMaterial(mat, amount) {
  let remaining = amount, guard = 0;
  while (remaining > 0 && guard++ < 20000) {
    const want = Math.min(remaining, RUN_MIN + ((Math.random() * (RUN_MAX - RUN_MIN + 1)) | 0));
    const lane = (Math.random() * MAX_LANES) | 0;
    const start = (Math.random() * CELLS) | 0;
    let len = 0;
    while (len < want) {
      const c = (start + len) % CELLS;
      if (lane >= laneCountPerCell[c] || laneColors[c][lane] !== 'gray') break;
      len++;
    }
    for (let k = 0; k < len; k++) {
      const c = (start + k) % CELLS;
      laneColors[c][lane] = mat; baseColors[c][lane] = mat;
    }
    remaining -= len;
  }
  // fallback: drop any leftover into the first available gray cells
  for (let c = 0; c < CELLS && remaining > 0; c++)
    for (let l = 0; l < laneCountPerCell[c] && remaining > 0; l++)
      if (laneColors[c][l] === 'gray') { laneColors[c][l] = mat; baseColors[c][l] = mat; remaining--; }
}
for (const mat of MATERIALS) fillMaterial(mat, matTotals[mat] || 0);

const colorLaneGroup = new THREE.Group();
scene.add(colorLaneGroup);
function makeLanePatch(u0, u1, offset, halfW) {
  const n = Math.max(4, Math.ceil((u1 - u0) * 500)), verts = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const { pos: c, right } = trackPoint(u0 + (u1 - u0) * (i / n), offset);
    const a = c.clone().addScaledVector(right, halfW);
    const b = c.clone().addScaledVector(right, -halfW);
    verts.push(a.x, a.y + 0.06, a.z, b.x, b.y + 0.06, b.z);
  }
  for (let i = 0; i < n; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.8 }));
  m.receiveShadow = true; colorLaneGroup.add(m);
  return m;
}
const laneMeshes = [];
for (let c = 0; c < CELLS; c++) {
  const N = laneCountPerCell[c];
  const meshRow = [];
  for (let l = 0; l < N; l++) {
    const m = makeLanePatch(c / CELLS, (c + 1) / CELLS, laneOffset(l, N), LANE_W / 2 - 0.3);
    m.material.color.setHex(matColorHex(laneColors[c][l]));
    meshRow.push(m);
  }
  laneMeshes.push(meshRow);
}
function setLaneColor(c, l, key) {
  laneColors[c][l] = key;
  laneMeshes[c][l].material.color.setHex(matColorHex(key));
}

// lane markings (small dashes), one merged mesh, toggleable
function makeLaneMarks(samples = 360) {
  const verts = [], idx = []; let v = 0;
  for (let i = 0; i < samples; i++) {
    const u = (i + 0.5) / samples;
    const N = lanesAt(u);
    const { pos: c, right, tan } = trackPoint(u, 0);
    const halfLen = (1 / samples) * TRACK_LEN * 0.32;
    const f = tan.clone().multiplyScalar(halfLen);
    const w = right.clone().multiplyScalar(0.16);
    for (let b = 1; b < N; b++) {
      const ctr = c.clone().addScaledVector(right, (b - N / 2) * LANE_W);
      const p1 = ctr.clone().sub(f).sub(w), p2 = ctr.clone().sub(f).add(w);
      const p3 = ctr.clone().add(f).add(w), p4 = ctr.clone().add(f).sub(w);
      verts.push(p1.x, p1.y + 0.08, p1.z, p2.x, p2.y + 0.08, p2.z, p3.x, p3.y + 0.08, p3.z, p4.x, p4.y + 0.08, p4.z);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.9 }));
  scene.add(m); return m;
}
const laneMarksMesh = makeLaneMarks();

// options menu wiring (start-screen checkboxes)
function bindOption(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  fn(el.checked);
  el.addEventListener('change', () => fn(el.checked));
}
bindOption('optLaneMarks', (v) => { CONFIG.laneMarks = v; laneMarksMesh.visible = v; });
bindOption('optOffroad', (v) => { CONFIG.offroad = v; });

// start/finish line
{
  const { pos: c, tan } = trackPoint(0, 0);
  const line = makeBox(roadHalfAt(0) * 2, 0.12, 2.6, 0xffffff);
  line.position.set(c.x, c.y + 0.12, c.z);
  line.rotation.y = Math.atan2(tan.x, tan.z);
  scene.add(line);
}

// ---------------- Scenery (trees & rocks) ----------------
function makeTree() {
  const g = new THREE.Group();
  const trunk = makeBox(0.8, 3, 0.8, 0x6b4a2b); trunk.position.y = 1.5; g.add(trunk);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f7d33, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4 - i * 0.5, 2.6, 8), foliageMat);
    cone.position.y = 3.2 + i * 1.4; cone.castShadow = true; g.add(cone);
  }
  return g;
}
function makeRock() {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x7a7a80, roughness: 1, flatShading: true })
  );
  rock.castShadow = true;
  return rock;
}
const SCENERY_MIN = MAX_ROAD_HALF + 24;  // sit just beyond the widest road
const SCENERY_MAX = MAX_ROAD_HALF + 75;
for (let i = 0; i < 120; i++) {
  const side = Math.random() < 0.5 ? 1 : -1;
  const off = side * (SCENERY_MIN + Math.random() * (SCENERY_MAX - SCENERY_MIN));
  const { pos } = trackPoint(Math.random(), off);
  let obj;
  if (Math.random() < 0.7) {
    obj = makeTree();
    obj.scale.setScalar(0.7 + Math.random() * 1.0);
  } else {
    obj = makeRock();
    obj.scale.set(1 + Math.random() * 2.5, 0.8 + Math.random() * 2, 1 + Math.random() * 2.5);
    obj.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
  }
  obj.position.set(pos.x, 0, pos.z);
  scene.add(obj);
}

// ---------------- Truck ----------------
const truck = new THREE.Group();
truck.rotation.order = 'YXZ'; // yaw, then pitch on slopes
const bed = makeBox(3, 0.6, 6.5, 0x6f6f78); bed.position.set(0, 1.2, -0.5); truck.add(bed);
const wheelGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.6, 16);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
[[1.65, -2.4], [-1.65, -2.4], [1.65, 2.2], [-1.65, 2.2]].forEach(([x, z]) => {
  const w = new THREE.Mesh(wheelGeo, wheelMat);
  w.rotation.z = Math.PI / 2; w.position.set(x, 0.75, z); w.castShadow = true;
  truck.add(w);
});
// literal front shovel blade, leading edge skimming the ground so boxes
// ride up the ramp and slide onto the flat bed
const blade = makeBox(3.6, 0.18, 3.0, 0xb6b6c0);
blade.position.set(0, 0.7, 4.0); blade.rotation.x = -0.5; truck.add(blade);
const lip = makeBox(3.6, 0.5, 0.22, 0x8a8a92);
lip.position.set(0, 1.1, 2.7); truck.add(lip);
[-1.8, 1.8].forEach((x) => {
  const wall = makeBox(0.18, 0.6, 3.0, 0x8a8a92);
  wall.position.set(x, 0.9, 4.0); wall.rotation.x = -0.5; truck.add(wall);
});
scene.add(truck);

// cargo slots: index 0 = front (newest) ... 2 = back (oldest)
const SLOT_Z = [1.0, -1.0, -3.0];
const slotMeshes = SLOT_Z.map((z) => {
  const m = makeBox(2, 2, 2, 0xffffff);
  m.position.set(0, 2.5, z); m.visible = false; truck.add(m);
  return m;
});

// ---------------- Dropped boxes (debris) ----------------
const debris = [];
const MAX_DEBRIS = 30;
function dropBox(colorKey) {
  truck.updateMatrixWorld();
  const mesh = makeBox(2, 2, 2, COLORS[colorKey]);
  mesh.position.copy(truck.localToWorld(new THREE.Vector3(0, 2.6, -4.5)));
  mesh.castShadow = true;
  scene.add(mesh);
  debris.push({
    mesh,
    vel: new THREE.Vector3((Math.random() - 0.5) * 3, 4 + Math.random() * 2, (Math.random() - 0.5) * 3),
    angVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
    landed: false,
  });
  while (debris.length > MAX_DEBRIS) {
    const old = debris.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
}
function updateDebris(dt) {
  for (const d of debris) {
    if (d.landed) continue;
    d.vel.y -= 22 * dt; // gravity
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.rotation.x += d.angVel.x * dt;
    d.mesh.rotation.y += d.angVel.y * dt;
    d.mesh.rotation.z += d.angVel.z * dt;
    if (d.mesh.position.y <= 1.0) {
      d.mesh.position.y = 1.0;
      d.mesh.rotation.set(0, d.mesh.rotation.y, 0); // settle flat
      d.landed = true;
    }
  }
}
function manualDrop() {
  if (carried.length === 0) return;
  dropBox(carried.shift()); // frontmost (newest) tossed out behind
  updateCargo();
}

// ---------------- Visual upgrades (one BIG mod per 3-match) ----------------
let upgradeLevel = 0;
const ACCENT = 0xff4d2e;
const chrome = () => new THREE.MeshStandardMaterial({ color: 0xdadde2, metalness: 0.9, roughness: 0.18 });
const UPGRADES = [
  () => { // 1. huge rear wing
    const p1 = makeBox(0.3, 1.7, 0.3, 0x202026); p1.position.set(1.25, 3.0, -3.7); truck.add(p1);
    const p2 = makeBox(0.3, 1.7, 0.3, 0x202026); p2.position.set(-1.25, 3.0, -3.7); truck.add(p2);
    const wing = makeBox(4.2, 0.3, 1.5, ACCENT); wing.position.set(0, 3.85, -3.8); truck.add(wing);
    const lip = makeBox(4.2, 0.2, 0.6, 0x202026); lip.position.set(0, 3.55, -3.35); lip.rotation.x = 0.35; truck.add(lip);
  },
  () => { // 2. wide body kit: side skirts + fat wheel arches
    [-1, 1].forEach((s) => {
      const skirt = makeBox(0.5, 0.6, 6.2, 0x202026); skirt.position.set(s * 1.75, 0.85, -0.5); truck.add(skirt);
    });
    [[1.7, -2.4], [-1.7, -2.4], [1.7, 2.2], [-1.7, 2.2]].forEach(([x, z]) => {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.3, 10, 18), new THREE.MeshStandardMaterial({ color: 0x111116 }));
      arch.position.set(x + Math.sign(x) * 0.25, 0.78, z); arch.rotation.y = Math.PI / 2; arch.castShadow = true; truck.add(arch);
    });
  },
  () => { // 3. twin vertical exhaust stacks
    [-1.35, 1.35].forEach((x) => {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 2.6, 14), chrome());
      stack.position.set(x, 2.4, -2.7); stack.castShadow = true; truck.add(stack);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.3, 14), chrome());
      tip.position.set(x, 3.7, -2.7); truck.add(tip);
    });
  },
  () => { // 4. front splitter + hood scoop + headlights
    const split = makeBox(3.8, 0.2, 1.1, ACCENT); split.position.set(0, 0.65, 3.3); truck.add(split);
    const scoop = makeBox(1.7, 0.9, 1.8, 0x202026); scoop.position.set(0, 2.15, 1.3); truck.add(scoop);
    [-0.95, 0.95].forEach((x) => {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 14),
        new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xffcc44, emissiveIntensity: 1.1 }));
      light.position.set(x, 1.65, 3.05); truck.add(light);
    });
  },
  () => { // 5. roof light bar + racing flags
    const bar = makeBox(2.8, 0.45, 0.6, 0x18181c); bar.position.set(0, 3.15, 0.4); truck.add(bar);
    for (let i = -2; i <= 2; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.2),
        new THREE.MeshStandardMaterial({ color: 0xcdeaff, emissive: 0x66ccff, emissiveIntensity: 1.2 }));
      l.position.set(i * 0.5, 3.3, 0.1); truck.add(l);
    }
    [-1, 1].forEach((s) => {
      const pole = makeBox(0.06, 1.2, 0.06, 0x111111); pole.position.set(s * 1.4, 3.4, -3.0); truck.add(pole);
      const flag = makeBox(0.04, 0.5, 0.8, s > 0 ? ACCENT : 0xffd23f); flag.position.set(s * 1.4, 3.7, -3.4); truck.add(flag);
    });
  },
  () => { // 6. neon underglow
    const glow = new THREE.PointLight(0x33ddff, 3.0, 16); glow.position.set(0, 0.1, -0.5); truck.add(glow);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.08, 6.6),
      new THREE.MeshStandardMaterial({ color: 0x33ddff, emissive: 0x33ddff, emissiveIntensity: 1.5 }));
    strip.position.set(0, 0.35, -0.5); truck.add(strip);
  },
];
function applyUpgrade() {
  if (upgradeLevel < UPGRADES.length) {
    UPGRADES[upgradeLevel]();
  } else {
    // beyond the set list: stack big golden victory fins
    const fin = makeBox(0.2, 0.9, 0.9, 0xffd23f);
    fin.position.set(((upgradeLevel - UPGRADES.length) % 2 ? 1 : -1) * 1.1, 3.3, -3.0);
    truck.add(fin);
  }
  upgradeLevel++;
  flashTime = 1.6; // trigger the on-screen banner
}

// ---------------- Boxes pool ----------------
const COLORS = { red: 0xdb3b3b, green: 0x3bdb5a, blue: 0x3b6cdb };
const COLOR_KEYS = Object.keys(COLORS);
const randColor = () => COLOR_KEYS[(Math.random() * 3) | 0];

const NUM_BOXES = 10;
const boxes = [];

function respawnBox(b, atU) {
  if (atU === undefined) {
    let nu, du;
    do { nu = Math.random(); du = Math.abs(nu - u); du = Math.min(du, 1 - du); } while (du < 0.06);
    b.u = nu;
  } else {
    b.u = atU;
  }
  b.lane = [-2, -1, 0, 1, 2][(Math.random() * 5) | 0];
  b.color = randColor();
  const { pos } = trackPoint(b.u, b.lane * LANE_W);
  b.mesh.position.set(pos.x, pos.y + 1.3, pos.z);
  b.mesh.material.color.setHex(COLORS[b.color]);
}

for (let i = 0; i < NUM_BOXES; i++) {
  const mesh = makeBox(2, 2, 2, 0xffffff);
  scene.add(mesh);
  const b = { mesh, u: 0, lane: 0, color: 'red' };
  boxes.push(b);
  respawnBox(b, (i + 0.5) / NUM_BOXES);
}

// ---------------- Game mode (boxes vs plow) ----------------
function applyMode() {
  const plow = CONFIG.mode === 'plow';
  for (const b of boxes) b.mesh.visible = !plow;
  const carryEl = document.getElementById('carried');
  const plowEl = document.getElementById('plowbar');
  if (carryEl) carryEl.style.display = plow ? 'none' : 'flex';
  if (plowEl) plowEl.style.display = plow ? 'block' : 'none';
  if (plow) { colorLaneGroup.visible = true; }
}
{
  const modeSel = document.getElementById('optMode');
  if (modeSel) {
    CONFIG.mode = modeSel.value;
    modeSel.addEventListener('change', () => { CONFIG.mode = modeSel.value; applyMode(); });
  }
  applyMode();
}

// ---------------- Grass dust / smoke VFX ----------------
function makeSmokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const SMOKE_TEX = makeSmokeTexture();
const SMOKE_POOL = 80;
const smokes = [];
for (let i = 0; i < SMOKE_POOL; i++) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: SMOKE_TEX, color: 0xcabfa6, transparent: true, opacity: 0, depthWrite: false,
  }));
  sprite.visible = false;
  scene.add(sprite);
  smokes.push({ sprite, life: 0, maxLife: 0, vel: new THREE.Vector3() });
}
let smokeIdx = 0;
function spawnSmoke(pos) {
  const p = smokes[smokeIdx];
  smokeIdx = (smokeIdx + 1) % SMOKE_POOL;
  p.life = 0;
  p.maxLife = 0.6 + Math.random() * 0.5;
  p.vel.set((Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5);
  p.sprite.position.copy(pos);
  p.sprite.scale.setScalar(1.5 + Math.random());
  p.sprite.visible = true;
}
function updateSmoke(dt) {
  for (const p of smokes) {
    if (!p.sprite.visible) continue;
    p.life += dt;
    if (p.life >= p.maxLife) { p.sprite.visible = false; continue; }
    const t = p.life / p.maxLife;
    p.sprite.position.addScaledVector(p.vel, dt);
    p.vel.multiplyScalar(0.95);
    p.sprite.scale.setScalar(1.5 + t * 5);
    p.sprite.material.opacity = 0.65 * (1 - t);
  }
}

// ---------------- State ----------------
let state = 'ready';            // ready | racing | finished
let u = 0, prevU = 0;           // position along track (0..1)
let lateral = 0;                // offset across road
let lateralVel = 0;             // sideways velocity (for steering inertia/sway)
let speed = 0;                  // units/sec
let raceTime = 0;
let permMult = 1;              // permanent passive speed bonus (level rewards)
let flashTime = 0;             // banner timer
let flashMsg = '';             // banner text
let level = 1;                 // current level (each completed task = +1)
let reqIndex = 0;              // which objective we're on
let reqProgress = 0;           // units farmed toward the current objective
let plowWidth = 1;             // how many lanes the plow clears at once
let boostUnlocked = false;     // active boost ability available?
let boostTimer = 0;            // seconds of active boost remaining (max 6)
const carried = [];             // color keys, [0] = newest/front

// ---------------- Handling / surface tuning ----------------
const STEER_ACCEL = 70;         // how hard input pushes sideways
const STEER_FRICTION = 7;       // how quickly sideways motion bleeds off (sway)
const MAX_LATERAL_VEL = 16;     // cap on sideways speed
const GRASS_HALF = MAX_ROAD_HALF + 20; // (legacy) how far you could wander off
const OFF_TRACK_MULT = 0.5;     // speed multiplier while off the tarmac
const DRIFT = 0.05;             // how much the body slides/yaws into a turn (horizontal only)

// farming / level tuning
const WRONG_MAT_MULT = 0.8;     // 20% slower over a material you're not collecting
const RAIL_MULT = 0.6;          // 40% slower while scraping a guardrail
const BOOST_MULT = 2.5;         // +150% during an active boost

function applyLevelReward(lv) {
  if (lv === 2) { permMult += 0.30; flashMsg = 'LEVEL 2 — +30% SPEED'; }
  else if (lv === 3) { plowWidth = 2; blade.scale.x = 2.6; lip.scale.x = 2.6; flashMsg = 'LEVEL 3 — PLOW 2 WIDE'; }
  else if (lv === 4) { boostUnlocked = true; flashMsg = 'LEVEL 4 — BOOST! (SPACE)'; }
  else if (lv === 5) { plowWidth = 3; blade.scale.x = 3.9; lip.scale.x = 3.9; flashMsg = 'LEVEL 5 — PLOW 3 WIDE'; }
  else flashMsg = `LEVEL ${lv}!`;
  flashTime = 2.0;
}
function completeRequirement() {
  level++;
  applyLevelReward(level);
  reqIndex++;
  if (reqIndex >= REQUIREMENTS.length) { finish(); return; }
  reqProgress = 0;
}
function activateBoost() {
  if (boostUnlocked && boostTimer <= 0) boostTimer = 6; // 3s full + 3s taper
}
function updateFarm(cell, laneIdx, N) {
  const req = REQUIREMENTS[reqIndex];
  if (!req) return;
  // which lanes does the plow cover?
  const covered = [laneIdx];
  if (plowWidth >= 3) {
    if (laneIdx - 1 >= 0) covered.push(laneIdx - 1);
    if (laneIdx + 1 <= N - 1) covered.push(laneIdx + 1);
  } else if (plowWidth === 2) {
    let nb = (lateral - laneOffset(laneIdx, N)) >= 0 ? laneIdx + 1 : laneIdx - 1;
    if (nb < 0 || nb > N - 1) nb = (nb < 0 ? laneIdx + 1 : laneIdx - 1);
    if (nb >= 0 && nb <= N - 1 && nb !== laneIdx) covered.push(nb);
  }
  // plow only the current material; stop exactly at the requirement (no over-farm)
  for (const ln of covered) {
    if (reqProgress >= req.amount) break;
    if (laneColors[cell][ln] === req.mat) {
      setLaneColor(cell, ln, 'gray');
      reqProgress++;
      if (reqProgress >= req.amount) { completeRequirement(); break; }
    }
  }
}

// ---------------- Input ----------------
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space') { e.preventDefault(); if (state === 'ready') startRace(); else if (state === 'racing') activateBoost(); }
  if (e.code === 'KeyR' && state === 'finished') location.reload();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---------------- Touch controls ----------------
function touchSteer(side, down) {
  keys[side === 'left' ? 'ArrowLeft' : 'ArrowRight'] = down;
}
function bindBtn(id, side) {
  const el = document.getElementById(id);
  if (!el) return;
  const dn = (e) => { e.preventDefault(); touchSteer(side, true); };
  const up = (e) => { e.preventDefault(); touchSteer(side, false); };
  el.addEventListener('pointerdown', dn);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
}
bindBtn('btnLeft', 'left');
bindBtn('btnRight', 'right');
{
  const bb = document.getElementById('btnBoost');
  if (bb) bb.addEventListener('pointerdown', (e) => { e.preventDefault(); activateBoost(); });
  const sb = document.getElementById('startBtn');
  if (sb) sb.addEventListener('pointerdown', (e) => { e.preventDefault(); if (state === 'ready') startRace(); });
  const fs = document.getElementById('finishScreen');
  if (fs) fs.addEventListener('pointerdown', () => { if (state === 'finished') location.reload(); });
}

function startRace() {
  state = 'racing';
  lateral = 0; lateralVel = 0;
  document.getElementById('startScreen').style.display = 'none';
}

// ---------------- Box pickup logic ----------------
function updateCargo() {
  for (let i = 0; i < 3; i++) {
    if (i < carried.length) {
      slotMeshes[i].visible = true;
      slotMeshes[i].material.color.setHex(COLORS[carried[i]]);
    } else {
      slotMeshes[i].visible = false;
    }
  }
}

function pickup(color) {
  carried.unshift(color);                 // newest pushed onto the front
  if (carried.length > 3) dropBox(carried.pop()); // oldest falls off the back and lands
  if (carried.length === 3 && carried[0] === carried[1] && carried[1] === carried[2]) {
    carried.length = 0;                   // 3 match -> clear
    permMult += 0.25;                     // +25% top speed, forever
    applyUpgrade();                       // big visible tune-up
    flashMsg = 'TUNED UP!  +25%';
  }
  updateCargo();
}

function checkPickups() {
  for (const b of boxes) {
    let du = Math.abs(b.u - u);
    du = Math.min(du, 1 - du);
    const ds = du * TRACK_LEN;
    const latDiff = Math.abs(lateral - b.lane * LANE_W);
    if (ds < 6 && latDiff < 3.2) {
      pickup(b.color);
      respawnBox(b); // instantly reappear elsewhere with a new color
    }
  }
}

// ---------------- Simulation ----------------
function update(dt) {
  raceTime += dt;
  if (flashTime > 0) flashTime = Math.max(0, flashTime - dt);
  if (boostTimer > 0) boostTimer = Math.max(0, boostTimer - dt);

  // current cell + how many lanes it has
  const cu = ((u % 1) + 1) % 1;
  const cell = Math.min(CELLS - 1, Math.floor(cu * CELLS));
  const N = laneCountPerCell[cell];
  const rh = N * LANE_W / 2;

  // free steering with inertia
  let steerInput = 0;
  if (keys['ArrowLeft'] || keys['KeyA']) steerInput += 1;
  if (keys['ArrowRight'] || keys['KeyD']) steerInput -= 1;
  lateralVel += steerInput * STEER_ACCEL * dt;
  lateralVel -= lateralVel * Math.min(1, STEER_FRICTION * dt);
  lateralVel = Math.max(-MAX_LATERAL_VEL, Math.min(MAX_LATERAL_VEL, lateralVel));
  lateral += lateralVel * dt;

  // guardrail along the whole road
  let hitRail = false, railSide = 0;
  const lim = rh - 1.2;
  if (lateral > lim) { lateral = lim; lateralVel = Math.min(0, lateralVel); hitRail = true; railSide = 1; }
  else if (lateral < -lim) { lateral = -lim; lateralVel = Math.max(0, lateralVel); hitRail = true; railSide = -1; }

  const laneIdx = Math.max(0, Math.min(N - 1, Math.round(lateral / LANE_W + (N - 1) / 2)));
  const req = REQUIREMENTS[reqIndex];
  const here = laneColors[cell][laneIdx];
  const onWrongMat = here !== 'gray' && (!req || here !== req.mat);

  // farm the current material (only it gets plowed)
  if (state === 'racing') updateFarm(cell, laneIdx, N);

  // active boost multiplier: +150% for 3s, taper to 0 over the next 3s
  let boostMult = 1;
  if (boostTimer > 3) boostMult = BOOST_MULT;
  else if (boostTimer > 0) boostMult = 1 + (BOOST_MULT - 1) * (boostTimer / 3);

  const wrongMult = onWrongMat ? WRONG_MAT_MULT : 1;     // slower over the wrong crop
  const railMult = hitRail ? RAIL_MULT : 1;             // slower while scraping a rail
  const targetMax = BASE_SPEED * permMult * boostMult * wrongMult * railMult;

  // auto-drive with a manual brake
  const accel = BASE_SPEED * 0.7, brake = BASE_SPEED * 1.4;
  if (keys['ArrowDown'] || keys['KeyS']) speed -= brake * dt;
  else speed += accel * dt;
  speed = Math.max(0, Math.min(speed, targetMax));

  // advance along the track (laps no longer matter)
  u = ((u + (speed * dt) / TRACK_LEN) % 1 + 1) % 1;

  // place the truck (no vertical roll; horizontal drift + slope pitch)
  const { pos, tan } = trackPoint(u, lateral);
  truck.position.set(pos.x, pos.y, pos.z);
  const speedFactor = Math.min(1, speed / BASE_SPEED);
  const drift = lateralVel * DRIFT * (0.35 + speedFactor);
  const pitch = -Math.atan(elevationGrade(u));
  truck.rotation.set(pitch, Math.atan2(tan.x, tan.z) + drift, 0);

  // VFX: smoke when scraping a guardrail
  if (hitRail && speed > BASE_SPEED * 0.05) {
    truck.updateMatrixWorld();
    spawnSmoke(truck.localToWorld(new THREE.Vector3(railSide * 1.6, 1.0, 0.4)));
  }
}

function finish() {
  state = 'finished';
  document.getElementById('finalTime').textContent = raceTime.toFixed(2) + 's';
  document.getElementById('finishScreen').style.display = 'flex';
}

// ---------------- Camera + HUD ----------------
const camLook = new THREE.Vector3();
function updateCamera() {
  const { pos, tan } = trackPoint(u, lateral);
  const desired = new THREE.Vector3(pos.x, pos.y, pos.z)
    .addScaledVector(tan, -24)
    .add(new THREE.Vector3(0, 11, 0));
  if (state === 'ready') camera.position.copy(desired);
  else camera.position.lerp(desired, 0.12);
  camLook.set(pos.x, pos.y + 2, pos.z).addScaledVector(tan, 10);
  camera.lookAt(camLook);
}

function updateHUD() {
  document.getElementById('lap').textContent = 'Level ' + level;
  document.getElementById('time').textContent = raceTime.toFixed(2) + 's';
  let sp = Math.round(speed) + ' u/s';
  if (boostTimer > 0) sp += '  ·  BOOST';
  else if (permMult > 1) sp += `  ·  +${Math.round((permMult - 1) * 100)}%`;
  document.getElementById('speed').textContent = sp;

  // objective panel
  const req = REQUIREMENTS[reqIndex];
  const cur = document.getElementById('objCur');
  const nxt = document.getElementById('objNext');
  const fill = document.getElementById('plowfill');
  if (req) {
    cur.textContent = `${req.mat.toUpperCase()}  ${reqProgress} / ${req.amount}`;
    cur.style.color = '#' + MAT_COLORS[req.mat].toString(16).padStart(6, '0');
    const next = REQUIREMENTS[reqIndex + 1];
    nxt.textContent = next ? `Next: ${next.mat} ${next.amount}` : 'Next: — (final)';
    fill.style.width = Math.round(100 * reqProgress / req.amount) + '%';
    fill.style.background = '#' + MAT_COLORS[req.mat].toString(16).padStart(6, '0');
  }

  const boostEl = document.getElementById('boost');
  if (flashTime > 0) {
    boostEl.style.display = 'block';
    boostEl.style.opacity = Math.min(1, flashTime / 0.5);
    boostEl.textContent = flashMsg;
  } else if (boostUnlocked && boostTimer <= 0) {
    boostEl.style.display = 'block';
    boostEl.style.opacity = 0.85;
    boostEl.textContent = 'BOOST READY — SPACE';
  } else {
    boostEl.style.display = 'none';
  }

  const bb = document.getElementById('btnBoost');
  if (bb) bb.style.display = boostUnlocked ? 'flex' : 'none';
}

// ---------------- Main loop ----------------
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state === 'racing') update(dt);
  updateSmoke(dt);
  updateDebris(dt);
  updateCamera();
  updateHUD();
  renderer.render(scene, camera);
}
tick();
