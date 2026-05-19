import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/OrbitControls.js';
import { subscribe, getFrames, getSelectedId, select } from '../state.js';
import { computeWorldMatrices } from '../math/transforms.js';
import { showMessage } from '../ui/util.js';

// World is ENU: Z is up. Camera up is set to +Z accordingly.

export function initViewport(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(3, -3, 2.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // Ground grid in the XY plane (z = 0).
  const grid = new THREE.GridHelper(20, 20, 0x335577, 0x223344);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  // ENU reference triad shown ONLY when the scene is empty — once the user
  // has frames, their root is the reference, so this would just overlap and
  // contradict a non-ENU root convention.
  const refTriad = makeTriad(1.0, 0.02);
  scene.add(refTriad);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(2, -3, 5);
  scene.add(dir);

  const framesGroup = new THREE.Group();
  scene.add(framesGroup);

  const fitBtn = document.createElement('button');
  fitBtn.textContent = 'Fit view';
  fitBtn.className = 'vp-btn';
  fitBtn.title = 'Frame all (double-click a frame to focus it)';
  container.appendChild(fitBtn);
  fitBtn.addEventListener('click', () => fitAll());

  // Move the camera so `box` fills the view, keeping the current view
  // direction; aims OrbitControls at the box centre.
  function frameBox(box, pad = 1.4) {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.25);
    const fov = (camera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * pad;
    const dirVec = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    if (dirVec.lengthSq() < 1e-9) dirVec.set(1, -1, 0.6).normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dirVec, dist);
    camera.near = Math.max(dist / 1000, 0.001);
    camera.far = dist * 1000;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function fitAll() {
    const box = new THREE.Box3().setFromObject(framesGroup);
    if (box.isEmpty()) {
      box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
    }
    frameBox(box);
  }

  function focusFrame(id) {
    const node = framesGroup.children.find((o) => o.userData.frameId === id);
    if (!node) return;
    const box = new THREE.Box3().setFromObject(node);
    frameBox(box, 2.2);
  }

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            m.map?.dispose?.();
            m.dispose?.();
          });
        }
      });
    }
  }

  let prevCount = 0;
  const labelSprites = [];
  // Invisible, frame-centred pick proxies. Selection ray-casts ONLY these,
  // not the thin triad arrows or the offset label sprites — those gave an
  // unreliable, position-ambiguous hit target.
  const pickTargets = [];

  function rebuild() {
    clearGroup(framesGroup);
    labelSprites.length = 0;
    pickTargets.length = 0;
    const frames = getFrames();
    refTriad.visible = frames.length === 0;
    if (!frames.length) {
      prevCount = 0;
      return;
    }

    let worlds;
    try {
      worlds = computeWorldMatrices(frames);
    } catch (e) {
      showMessage(`Visualization paused: ${e.message}`, 'error');
      return;
    }

    const selId = getSelectedId();
    const posOf = (id) => new THREE.Vector3().setFromMatrixPosition(worlds.get(id));

    for (const f of frames) {
      const m = worlds.get(f.id);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      m.decompose(pos, quat, scl);

      const selected = f.id === selId;
      const node = new THREE.Group();
      node.position.copy(pos);
      node.quaternion.copy(quat);

      const len = selected ? 0.7 : 0.45;
      node.add(makeTriad(len, selected ? 0.02 : 0.012));

      // Generous invisible sphere centred on the frame origin — the sole
      // click target, so clicking on/near a frame reliably selects THAT
      // frame (nearest one wins) instead of depending on hitting a thin
      // arrow or an offset label.
      // Unit sphere; scalePickTargets() sizes it to a constant on-screen
      // radius each frame so it stays clickable at any zoom without one
      // frame's proxy eclipsing its neighbours.
      const hitProxy = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 10),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hitProxy.userData.frameId = f.id;
      node.add(hitProxy);
      pickTargets.push(hitProxy);

      if (selected) {
        const ring = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 16, 12),
          new THREE.MeshBasicMaterial({ color: 0xffcc33, wireframe: true }),
        );
        node.add(ring);
      }

      const label = makeLabel(f.name, f.convention, selected ? 0xffcc33 : 0xcfe3ff);
      label.position.set(0, 0, len + 0.1);
      node.add(label);
      labelSprites.push(label);

      node.userData.frameId = f.id;
      framesGroup.add(node);

      if (f.parent_id != null && worlds.get(f.parent_id)) {
        const g = new THREE.BufferGeometry().setFromPoints([posOf(f.parent_id), pos]);
        const line = new THREE.Line(
          g,
          new THREE.LineBasicMaterial({ color: 0x66788c }),
        );
        framesGroup.add(line);
      }
    }

    // Auto-fit the first time frames appear (fresh create / load into empty).
    if (prevCount === 0) fitAll();
    prevCount = frames.length;

    // Size the pick proxies immediately so selection is correct on the very
    // first click — don't wait for the next render-loop tick.
    scalePickTargets();
  }

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    // Raycaster doesn't refresh world matrices; do it here so a click is
    // correct even if the render loop hasn't ticked (tab refocus, low power).
    framesGroup.updateMatrixWorld(true);
    for (const h of raycaster.intersectObjects(pickTargets, false)) {
      let o = h.object;
      while (o && o.userData.frameId == null) o = o.parent;
      if (o && o.userData.frameId != null) return o.userData.frameId;
    }
    return null;
  }

  // Single click selects; double click focuses the camera on the frame.
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    const id = pick(ev);
    if (id != null) select(id);
  });
  renderer.domElement.addEventListener('dblclick', (ev) => {
    const id = pick(ev);
    if (id != null) focusFrame(id);
  });

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // Keep labels at a roughly constant on-screen size: world height grows with
  // camera distance, clamped to [MIN, MAX] so they neither vanish up close nor
  // dominate the scene when far (the requested max cap).
  const LABEL_K = 0.05;
  const LABEL_MIN = 0.12;
  const LABEL_MAX = 0.6;
  const tmpV = new THREE.Vector3();
  function scaleLabels() {
    for (const s of labelSprites) {
      s.getWorldPosition(tmpV);
      const dist = camera.position.distanceTo(tmpV);
      const h = Math.min(LABEL_MAX, Math.max(LABEL_MIN, LABEL_K * dist));
      s.scale.set(h * s.userData.aspect, h, 1);
    }
  }

  // Keep each pick proxy at a roughly constant on-screen radius (~a small
  // click disc), clamped so neighbouring frames stay independently
  // selectable instead of one large sphere capturing every click.
  const PICK_K = 0.045;
  const PICK_MIN = 0.09;
  const PICK_MAX = 0.28;
  function scalePickTargets() {
    for (const p of pickTargets) {
      p.getWorldPosition(tmpV);
      const dist = camera.position.distanceTo(tmpV);
      const r = Math.min(PICK_MAX, Math.max(PICK_MIN, PICK_K * dist));
      p.scale.setScalar(r);
    }
  }

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    scaleLabels();
    scalePickTargets();
    renderer.render(scene, camera);
  })();

  subscribe(rebuild);
  rebuild();
}

function makeTriad(len, radius) {
  const g = new THREE.Group();
  const axis = (dir, color) => {
    const arrow = new THREE.ArrowHelper(
      dir.clone().normalize(), new THREE.Vector3(0, 0, 0), len, color, len * 0.25, radius * 12,
    );
    g.add(arrow);
  };
  axis(new THREE.Vector3(1, 0, 0), 0xff4444); // X
  axis(new THREE.Vector3(0, 1, 0), 0x44dd66); // Y
  axis(new THREE.Vector3(0, 0, 1), 0x5588ff); // Z
  return g;
}

// Canvas: frame name (bold) + a much smaller, dimmer convention suffix (no
// brackets). Rendered at a high supersampled resolution so the sprite stays
// crisp when magnified by the camera; `aspect` is consumed by the loop scaler.
function makeLabelTexture(name, conv, cssColor) {
  // Supersample relative to the display so close-up zoom doesn't pixelate.
  const SS = Math.min(8, Math.max(4, Math.ceil((window.devicePixelRatio || 1) * 4)));
  const NAME_PX = 40 * SS;
  const CONV_PX = 20 * SS;
  const padX = 10 * SS;
  const gap = 10 * SS;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `bold ${NAME_PX}px system-ui, sans-serif`;
  const nameW = ctx.measureText(name).width;
  ctx.font = `${CONV_PX}px system-ui, sans-serif`;
  const convW = ctx.measureText(conv).width;
  c.width = Math.ceil(nameW + gap + convW + padX * 2);
  c.height = 60 * SS;
  ctx.clearRect(0, 0, c.width, c.height);
  const mid = c.height / 2;
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${NAME_PX}px system-ui, sans-serif`;
  ctx.fillStyle = cssColor;
  ctx.fillText(name, padX, mid);
  ctx.font = `${CONV_PX}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(150,170,190,0.85)';
  ctx.fillText(conv, padX + nameW + gap, mid + 2 * SS);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 8; // three clamps to the GPU max
  return { tex, aspect: c.width / c.height };
}

function makeLabel(name, conv, colorHex) {
  const css = `#${colorHex.toString(16).padStart(6, '0')}`;
  const { tex, aspect } = makeLabelTexture(name, conv, css);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  sprite.userData.aspect = aspect;
  sprite.renderOrder = 999;
  return sprite;
}
