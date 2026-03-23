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
 * Tile source: https://ob-sat.github.io/360-vr-meta-quest/tiles/{sceneId}/{level}/{face}/{row}/{col}.jpg
 * Level 2 = 1024px per face, 2×2 tiles per face (24 total requests per scene).
 */

import * as THREE from 'three';

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE_BASE   = 'https://ob-sat.github.io/360-vr-meta-quest/tiles/';
const TILE_LEVEL  = 2;
const TILE_COLS   = 2;
const SKYBOX_SIZE = 900;
const HOTSPOT_RADIUS = 10;

/**
 * BoxGeometry face slot order: [+X, -X, +Y, -Y, +Z, -Z]
 * flipU  — horizontal mirror for BackSide rendering
 * rotate — CW rotation in degrees applied to assembled tile canvas (0, 90, 180, 270)
 */
const BOX_FACES = [
  { name: 'l', flipU: true,  rotate:   0 },  // +X
  { name: 'r', flipU: true,  rotate:   0 },  // -X
  { name: 'u', flipU: false, rotate: 180 },  // +Y  ← rotated to fix alignment
  { name: 'd', flipU: true,  rotate:   0 },  // -Y
  { name: 'f', flipU: true,  rotate:   0 },  // +Z
  { name: 'b', flipU: true,  rotate:   0 },  // -Z
];

// ─── Scene list (with Marzipano hotspot positions) ────────────────────────────

export const SCENES = [
  {
    id: '0-reception-1', label: 'Reception 1',
    hotspots: [
      { targetId: '1-recruitment-zone-1', yawRad:  0.8554, pitchRad: 0.0366 },
      { targetId: '3-reception-2',        yawRad:  2.4088, pitchRad: 0.0355 },
    ],
  },
  {
    id: '1-recruitment-zone-1', label: 'Recruitment Zone 1',
    hotspots: [
      { targetId: '0-reception-1',        yawRad:  1.6875, pitchRad: 0.0256 },
      { targetId: '2-recruitment-zone-2', yawRad:  0.1857, pitchRad: 0.0454 },
    ],
  },
  {
    id: '2-recruitment-zone-2', label: 'Recruitment Zone 2',
    hotspots: [
      { targetId: '1-recruitment-zone-1', yawRad:  0.0394, pitchRad: 0.0621 },
      { targetId: '3-reception-2',        yawRad: -1.7472, pitchRad: 0.0915 },
    ],
  },
  {
    id: '3-reception-2', label: 'Reception 2',
    hotspots: [
      { targetId: '2-recruitment-zone-2', yawRad:  0.6345, pitchRad: 0.0673 },
      { targetId: '0-reception-1',        yawRad: -0.9778, pitchRad: 0.0554 },
      { targetId: '4-visitor-lounge-1',   yawRad:  2.1644, pitchRad: 0.1048 },
    ],
  },
  {
    id: '4-visitor-lounge-1', label: 'Visitor Lounge 1',
    hotspots: [
      { targetId: '5-visitor-lounge-2',   yawRad:  0.9352, pitchRad: 0.0574 },
      { targetId: '3-reception-2',        yawRad: -2.2298, pitchRad: 0.0763 },
    ],
  },
  {
    id: '5-visitor-lounge-2', label: 'Visitor Lounge 2',
    hotspots: [
      { targetId: '4-visitor-lounge-1',   yawRad: -0.2248, pitchRad: 0.0609 },
    ],
  },
];

// ─── Internal state ───────────────────────────────────────────────────────────

let renderer, threeScene, camera;
let xrSession    = null;
let skyboxMesh   = null;
let hotspotGroup = null;
let currentSceneIndex = 0;

// Drag state
let dragging     = null;
let lastGripX    = null;
let snapCooldown = false;

// Per-source hover map — keyed by XRInputSource, value is hovered hotspot Group
const hoveredBySource = new Map();

// World-space ray lines (one per input source slot, updated via XRFrame pose)
let rayLines = [];

const raycaster = new THREE.Raycaster();

// ─── Tile helpers ─────────────────────────────────────────────────────────────

function tileUrl(sceneId, face, row, col) {
  return `${TILE_BASE}${sceneId}/${TILE_LEVEL}/${face}/${row}/${col}.jpg`;
}

/**
 * Stitch TILE_COLS×TILE_COLS tiles into a canvas, apply optional CW rotation,
 * then return a THREE.CanvasTexture.
 */
function loadFace(sceneId, faceName, flipU, rotateDeg) {
  return new Promise((resolve, reject) => {
    const n    = TILE_COLS;
    const size = 512 * n;

    // Assemble tiles into a temp canvas first
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width  = size;
    tileCanvas.height = size;
    const tileCtx = tileCanvas.getContext('2d');

    let loaded = 0;
    const total = n * n;

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          tileCtx.drawImage(img, col * 512, row * 512, 512, 512);
          loaded++;
          if (loaded === total) {
            // Build final canvas with optional rotation
            const canvas = document.createElement('canvas');
            canvas.width  = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            if (rotateDeg) {
              ctx.translate(size / 2, size / 2);
              ctx.rotate(rotateDeg * Math.PI / 180);
              ctx.drawImage(tileCanvas, -size / 2, -size / 2);
            } else {
              ctx.drawImage(tileCanvas, 0, 0);
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace      = THREE.SRGBColorSpace;
            tex.minFilter       = THREE.LinearFilter;
            tex.generateMipmaps = false;
            tex.wrapS           = THREE.ClampToEdgeWrapping;
            tex.wrapT           = THREE.ClampToEdgeWrapping;
            if (flipU) {
              tex.wrapS    = THREE.RepeatWrapping;
              tex.repeat.x = -1;
              tex.offset.x =  1;
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

async function buildSkybox(sceneId) {
  const textures = await Promise.all(
    BOX_FACES.map(({ name, flipU, rotate }) => loadFace(sceneId, name, flipU, rotate))
  );
  const geometry  = new THREE.BoxGeometry(SKYBOX_SIZE, SKYBOX_SIZE, SKYBOX_SIZE);
  const materials = textures.map(tex =>
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false })
  );
  return new THREE.Mesh(geometry, materials);
}

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

function angleToPosition(yawRad, elevRad, radius) {
  return new THREE.Vector3(
    Math.sin(yawRad) * Math.cos(elevRad) * radius,
    Math.sin(elevRad) * radius,
    Math.cos(yawRad) * Math.cos(elevRad) * radius
  );
}

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
  const tex    = new THREE.CanvasTexture(canvas);
  const mat    = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.8, 0.45, 1);
  return sprite;
}

/**
 * Build hotspots for sceneIndex using the spatial positions from Marzipano data.
 */
function buildHotspots(sceneIndex) {
  if (hotspotGroup) {
    hotspotGroup.children.forEach(g => {
      g.children.forEach(c => {
        if (c.material) { c.material.map?.dispose(); c.material.dispose(); }
        if (c.geometry) c.geometry.dispose();
      });
    });
    threeScene.remove(hotspotGroup);
  }

  hotspotGroup = new THREE.Group();

  const scene = SCENES[sceneIndex];
  scene.hotspots.forEach(({ targetId, yawRad, pitchRad }) => {
    const targetIndex = SCENES.findIndex(s => s.id === targetId);
    if (targetIndex < 0) return;

    // Marzipano yaw is CCW from above; our system is CW → negate yaw
    // Marzipano pitch > 0 = looking down; our elevation: positive = up → negate pitch
    const pos = angleToPosition(-yawRad, -pitchRad, HOTSPOT_RADIUS);

    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.50, 48),
      new THREE.MeshBasicMaterial({ color: 0x5e9eff, side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false })
    );
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.34, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false })
    );
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.18, 32),
      new THREE.MeshBasicMaterial({ color: 0x5e9eff, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false })
    );

    const group = new THREE.Group();
    group.add(outerRing, innerRing, disc);
    group.position.copy(pos);
    group.lookAt(0, 0, 0);
    group.userData.sceneIndex = targetIndex;
    group.userData.isHotspot  = true;

    const sprite = makeLabel(SCENES[targetIndex].label);
    sprite.position.set(0, 0.75, 0);
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
    buildHotspots(index);
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
    xrSession = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local'],
      optionalFeatures: ['hand-tracking'],
    });
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(xrSession);

    setLoading(true);
    const mesh = await buildSkybox(SCENES[currentSceneIndex].id);
    skyboxMesh = mesh;
    threeScene.add(skyboxMesh);
    buildHotspots(currentSceneIndex);
    setLoading(false);

    // ── World-space ray lines (updated each frame via XRFrame pose) ──────────
    // Using 2 slots; one per potential input source. Not parented to Three.js
    // controller groups — avoids index-mapping issues entirely.
    rayLines = [0, 1].map(() => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -15),
        ]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
      );
      threeScene.add(line);
      return line;
    });

    // ── Session-level selectstart ────────────────────────────────────────────
    // hoveredBySource is keyed by XRInputSource — exact same object as e.inputSource
    xrSession.addEventListener('selectstart', e => {
      const hovered = hoveredBySource.get(e.inputSource);
      if (hovered) {
        switchToScene(hovered.userData.sceneIndex);
      } else {
        dragging  = e.inputSource;
        lastGripX = null;
      }
    });
    xrSession.addEventListener('selectend', e => {
      if (dragging === e.inputSource) { dragging = null; lastGripX = null; }
    });

    xrSession.addEventListener('end', () => {
      xrSession  = null;
      dragging   = null;
      lastGripX  = null;
      hoveredBySource.clear();
      rayLines.forEach(l => threeScene.remove(l));
      rayLines   = [];
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
        if (Math.abs(dx) > 0.001) snapTurn(dx * 140);
      }
      lastGripX = x;
    }
  }

  // ── 3. Hotspot raycasting + ray line update ────────────────────────────────
  if (!hotspotGroup) return;

  hotspotGroup.children.forEach(g => g.scale.setScalar(1));
  hoveredBySource.clear();

  const targets = hotspotGroup.children.flatMap(g => g.children.filter(c => c.isMesh));
  let srcIdx = 0;

  for (const src of xrSession.inputSources) {
    const rayLine = rayLines[srcIdx];
    srcIdx++;

    if (!src.targetRaySpace) continue;
    const rayPose = frame.getPose(src.targetRaySpace, refSpace);
    if (!rayPose) continue;

    const m = rayPose.transform.matrix;
    const origin = new THREE.Vector3(m[12], m[13], m[14]);
    const dir    = new THREE.Vector3(-m[8], -m[9], -m[10]).normalize();

    // Position and orient the ray line in world space
    if (rayLine) {
      rayLine.position.copy(origin);
      rayLine.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, -1), dir
      );
    }

    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(targets, false);

    if (hits.length && hits[0].distance < 20) {
      const hotspot = hits[0].object.parent;
      hotspot.scale.setScalar(1.25);
      hoveredBySource.set(src, hotspot);
      // Shorten ray to hit point
      rayLine?.geometry.setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -hits[0].distance),
      ]);
    } else {
      rayLine?.geometry.setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -15),
      ]);
    }
  }
}

export function attachHotspotFire() { /* no-op */ }
