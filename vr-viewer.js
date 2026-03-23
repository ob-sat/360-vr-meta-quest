/**
 * vr-viewer.js — Meta Quest Edition
 * Three.js + WebXR immersive 360° panorama viewer.
 *
 * Controls:
 *   Look around      → move your head (XR pose tracking)
 *   Rotate scene     → hold trigger + drag controller left/right
 *   Snap turn        → thumbstick horizontal (left/right, 22.5° per step)
 *   Switch space     → point controller at a glowing ring hotspot → pull trigger
 *
 * Tile source: https://saishashang.github.io/tiles/{sceneId}/{level}/{face}/{row}/{col}.jpg
 * Level 2 = 1024px per face, 2×2 tiles per face (24 total requests per scene).
 */

import * as THREE from 'three';

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE_BASE  = 'https://saishashang.github.io/tiles/';
const TILE_LEVEL = 2;       // 1024px faces (2×2 tiles each)
const TILE_COLS  = 2;       // tiles per face row/col at level 2
const SKYBOX_SIZE = 900;
const HOTSPOT_RADIUS = 10; // units from camera

/**
 * BoxGeometry face order: [+X, -X, +Y, -Y, +Z, -Z]
 * Mapping to Marzipano face names (viewed from inside the box):
 *   +X = right  → 'r'
 *   -X = left   → 'l'
 *   +Y = up     → 'u'
 *   -Y = down   → 'd'
 *   +Z = front  → 'f'  (camera looks toward +Z from inside)
 *   -Z = back   → 'b'
 *
 * Faces that need horizontal UV flip when viewed BackSide: +X, -Y, +Z
 */
const BOX_FACES = [
  { name: 'r', flipU: true  },  // +X
  { name: 'l', flipU: false },  // -X
  { name: 'u', flipU: false },  // +Y
  { name: 'd', flipU: true  },  // -Y
  { name: 'f', flipU: true  },  // +Z
  { name: 'b', flipU: false },  // -Z
];

// ─── Scene list ───────────────────────────────────────────────────────────────

export const SCENES = [
  { id: '0-reception01',  label: 'Reception 01' },
  { id: '1-reception02',  label: 'Reception 02' },
  { id: '2-side01',       label: 'Side 01' },
  { id: '3-side02',       label: 'Side 02' },
  { id: '4-dh02',         label: 'Dining Hall 02' },
  { id: '5-dh03',         label: 'Dining Hall 03' },
  { id: '6-mf',           label: 'Medical Facility' },
  { id: '7-mr01',         label: 'Meeting Room 01' },
  { id: '8-mr02',         label: 'Meeting Room 02' },
  { id: '9-mr03',         label: 'Meeting Room 03' },
  { id: '10-mr04',        label: 'Meeting Room 04' },
  { id: '11-panm40002',   label: 'PANM 40002' },
  { id: '12-phonebooth',  label: 'Phone Booth' },
  { id: '13-ca01',        label: 'CA 01' },
  { id: '14-dh01',        label: 'Dining Hall 01' },
];

// ─── Internal state ───────────────────────────────────────────────────────────

let renderer, threeScene, camera;
let xrSession   = null;
let skyboxMesh  = null;       // current skybox THREE.Mesh
let hotspotGroup = null;      // THREE.Group holding the two ring hotspots
let currentSceneIndex = 0;

// Controller drag state
let dragging    = null;       // XRInputSource currently held
let lastGripX   = null;
let snapCooldown = false;

// Raycaster for hotspot selection
const raycaster = new THREE.Raycaster();

// ─── Tile helpers ─────────────────────────────────────────────────────────────

function tileUrl(sceneId, face, row, col) {
  return `${TILE_BASE}${sceneId}/${TILE_LEVEL}/${face}/${row}/${col}.jpg`;
}

/**
 * Load a single cube face by stitching TILE_COLS × TILE_COLS tiles onto a canvas.
 * Returns a Promise<THREE.CanvasTexture>.
 */
function loadFace(sceneId, faceName, flipU) {
  return new Promise((resolve, reject) => {
    const n    = TILE_COLS;
    const size = 512 * n; // 1024 at level 2
    const canvas = document.createElement('canvas');
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    let loaded = 0;
    const total = n * n;

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, col * 512, row * 512, 512, 512);
          loaded++;
          if (loaded === total) {
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter  = THREE.LinearFilter;
            tex.generateMipmaps = false;
            if (flipU) {
              tex.wrapS    = THREE.RepeatWrapping;
              tex.repeat.x = -1;
              tex.offset.x = 1;
            }
            resolve(tex);
          }
        };
        img.onerror = () => reject(new Error(`Failed: ${tileUrl(sceneId, faceName, row, col)}`));
        img.src = tileUrl(sceneId, faceName, row, col);
      }
    }
  });
}

/**
 * Load all 6 faces in parallel and build a BoxGeometry skybox mesh.
 * Returns Promise<THREE.Mesh>.
 */
async function buildSkybox(sceneId) {
  const textures = await Promise.all(
    BOX_FACES.map(({ name, flipU }) => loadFace(sceneId, name, flipU))
  );
  const geometry  = new THREE.BoxGeometry(SKYBOX_SIZE, SKYBOX_SIZE, SKYBOX_SIZE);
  const materials = textures.map(tex =>
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false })
  );
  return new THREE.Mesh(geometry, materials);
}

/**
 * Dispose an old skybox mesh and all its textures.
 */
function disposeSkybox(mesh) {
  if (!mesh) return;
  mesh.material.forEach(m => { m.map?.dispose(); m.dispose(); });
  mesh.geometry.dispose();
  threeScene.remove(mesh);
}

// ─── Loading overlay ──────────────────────────────────────────────────────────

function setLoading(visible) {
  const el = document.getElementById('vr-loading');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

// ─── Snap turn ────────────────────────────────────────────────────────────────

function snapTurn(angleDeg) {
  const space = renderer.xr.getReferenceSpace();
  if (!space) return;
  const half = THREE.MathUtils.degToRad(angleDeg / 2);
  renderer.xr.setReferenceSpace(
    space.getOffsetReferenceSpace(new XRRigidTransform(
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }
    ))
  );
}

// ─── Hotspots ─────────────────────────────────────────────────────────────────

/**
 * Convert yaw (degrees from forward) + elevation to a world-space Vector3.
 */
function angleToPosition(yawDeg, elevDeg, radius) {
  const y = THREE.MathUtils.degToRad(yawDeg);
  const e = THREE.MathUtils.degToRad(elevDeg);
  return new THREE.Vector3(
    Math.sin(y) * Math.cos(e) * radius,
    Math.sin(e) * radius,
    Math.cos(y) * Math.cos(e) * radius
  );
}

/**
 * Create a sprite label with the scene name.
 */
function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width  = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex     = new THREE.CanvasTexture(canvas);
  const mat     = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite  = new THREE.Sprite(mat);
  sprite.scale.set(1.8, 0.45, 1);
  return sprite;
}

/**
 * Build (or rebuild) the two navigation hotspot rings.
 * prevIndex / nextIndex are indices into SCENES.
 */
function buildHotspots(prevIndex, nextIndex) {
  if (hotspotGroup) {
    hotspotGroup.children.forEach(c => {
      if (c.material) { c.material.map?.dispose(); c.material.dispose(); }
      if (c.geometry) c.geometry.dispose();
    });
    threeScene.remove(hotspotGroup);
  }

  hotspotGroup = new THREE.Group();

  const defs = [
    { sceneIdx: prevIndex, yaw: -70, label: SCENES[prevIndex].label, dir: 'prev' },
    { sceneIdx: nextIndex, yaw:  70, label: SCENES[nextIndex].label, dir: 'next' },
  ];

  defs.forEach(({ sceneIdx, yaw, label }) => {
    const pos = angleToPosition(yaw, 0, HOTSPOT_RADIUS);

    // Outer glow ring
    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.36, 48),
      new THREE.MeshBasicMaterial({
        color: 0x5e9eff, side: THREE.DoubleSide,
        transparent: true, opacity: 0.5, depthWrite: false,
      })
    );

    // Inner white ring
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.26, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, side: THREE.DoubleSide,
        transparent: true, opacity: 0.9, depthWrite: false,
      })
    );

    // Arrow disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 32),
      new THREE.MeshBasicMaterial({
        color: 0x5e9eff, side: THREE.DoubleSide,
        transparent: true, opacity: 0.7, depthWrite: false,
      })
    );

    const group = new THREE.Group();
    group.add(outerRing, innerRing, disc);
    group.position.copy(pos);
    group.lookAt(0, 0, 0);          // face the centre (camera)
    group.userData.sceneIndex = sceneIdx;
    group.userData.isHotspot  = true;

    // Label above the ring
    const sprite = makeLabel(label);
    sprite.position.set(0, 0.55, 0);
    group.add(sprite);

    hotspotGroup.add(group);
  });

  threeScene.add(hotspotGroup);
}

// ─── Scene switching ──────────────────────────────────────────────────────────

async function switchToScene(index) {
  if (index < 0 || index >= SCENES.length) return;
  currentSceneIndex = index;
  setLoading(true);
  try {
    const newMesh = await buildSkybox(SCENES[index].id);
    disposeSkybox(skyboxMesh);
    skyboxMesh = newMesh;
    threeScene.add(skyboxMesh);
    // Rebuild hotspots for new scene
    const prev = (index - 1 + SCENES.length) % SCENES.length;
    const next = (index + 1) % SCENES.length;
    buildHotspots(prev, next);
  } catch (err) {
    console.error('[VRViewer] switchToScene failed:', err);
  } finally {
    setLoading(false);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function checkVRSupport() {
  if (!navigator.xr) return false;
  try { return await navigator.xr.isSessionSupported('immersive-vr'); }
  catch { return false; }
}

export function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  threeScene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop((time, frame) => {
    if (frame) handleXRFrame(frame);
    renderer.render(threeScene, camera);
  });
}

export async function enterVR(initialSceneId, _onSceneChange) {
  const idx = SCENES.findIndex(s => s.id === initialSceneId);
  currentSceneIndex = idx >= 0 ? idx : 0;

  try {
    // Must call requestSession before any other await (user gesture window)
    xrSession = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local'],
      optionalFeatures: ['hand-tracking'],
    });
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(xrSession);

    // Session live — load initial panorama
    setLoading(true);
    const mesh = await buildSkybox(SCENES[currentSceneIndex].id);
    skyboxMesh = mesh;
    threeScene.add(skyboxMesh);

    const prev = (currentSceneIndex - 1 + SCENES.length) % SCENES.length;
    const next = (currentSceneIndex + 1) % SCENES.length;
    buildHotspots(prev, next);
    setLoading(false);

    // ── Controller drag rotation ─────────────────────────────────────────────
    xrSession.addEventListener('selectstart', e => {
      dragging  = e.inputSource;
      lastGripX = null;
    });
    xrSession.addEventListener('selectend', e => {
      if (dragging === e.inputSource) { dragging = null; lastGripX = null; }
    });

    xrSession.addEventListener('end', () => {
      xrSession    = null;
      dragging     = null;
      lastGripX    = null;
      disposeSkybox(skyboxMesh); skyboxMesh = null;
      if (hotspotGroup) { threeScene.remove(hotspotGroup); hotspotGroup = null; }
      setLoading(false);
    });

  } catch (err) {
    console.error('[VRViewer] enterVR failed:', err);
    setLoading(false);
    throw err;
  }
}

export function exitVR() { xrSession?.end(); }

// ─── XR frame loop ────────────────────────────────────────────────────────────

function handleXRFrame(frame) {
  const refSpace = renderer.xr.getReferenceSpace();
  if (!refSpace) return;

  // ── 1. Thumbstick snap-turn ────────────────────────────────────────────────
  if (!snapCooldown) {
    for (const src of xrSession.inputSources) {
      const h = src.gamepad?.axes[2] ?? 0;
      if (Math.abs(h) > 0.6) {
        snapTurn(h > 0 ? -22.5 : 22.5);
        snapCooldown = true;
        setTimeout(() => { snapCooldown = false; }, 300);
        break;
      }
    }
  }

  // ── 2. Trigger-drag rotation ───────────────────────────────────────────────
  if (dragging?.gripSpace) {
    const pose = frame.getPose(dragging.gripSpace, refSpace);
    if (pose) {
      const x = pose.transform.position.x;
      if (lastGripX !== null) {
        const dx = x - lastGripX;
        if (Math.abs(dx) > 0.001) snapTurn(-dx * 140);
      }
      lastGripX = x;
    }
  }

  // ── 3. Hotspot raycasting ─────────────────────────────────────────────────
  if (!hotspotGroup) return;

  // Reset all hotspot highlights
  hotspotGroup.children.forEach(g => {
    g.children.forEach(c => {
      if (c.material && !c.isSprite) {
        c.material.opacity = c.geometry.type === 'RingGeometry'
          ? (c.material.color.getHex() === 0x5e9eff ? 0.5 : 0.9)
          : 0.7;
        c.scale.setScalar(1);
      }
    });
    g.scale.setScalar(1);
  });

  let hitHotspot = null;

  for (const src of xrSession.inputSources) {
    if (!src.targetRaySpace) continue;
    const rayPose = frame.getPose(src.targetRaySpace, refSpace);
    if (!rayPose) continue;

    const m = rayPose.transform.matrix;
    const origin = new THREE.Vector3(m[12], m[13], m[14]);
    // Forward direction from the ray transform (-Z in local space → col 2 of matrix)
    const dir = new THREE.Vector3(-m[8], -m[9], -m[10]).normalize();

    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(
      hotspotGroup.children.flatMap(g => g.children.filter(c => !c.isSprite)),
      false
    );

    if (hits.length) {
      const hotspotGroup_ = hits[0].object.parent;
      hotspotGroup_.scale.setScalar(1.2);
      hitHotspot = { inputSource: src, group: hotspotGroup_ };
    }
  }

  // Fire on selectstart if pointing at hotspot
  // (handled via separate event below — stored reference)
  window.__xrHitHotspot = hitHotspot;
}

// Attach hotspot fire handler after session starts (fires once per click)
function attachHotspotFire() {
  xrSession?.addEventListener('selectstart', () => {
    const hit = window.__xrHitHotspot;
    if (hit) {
      const idx = hit.group.userData.sceneIndex;
      switchToScene(idx);
    }
  });
}

// Re-export so index.html can call after enterVR
export { attachHotspotFire };
