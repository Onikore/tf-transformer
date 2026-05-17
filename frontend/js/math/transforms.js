import * as THREE from 'three';
import { conventionMatrix4 } from './conventions.js';

export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

const IDENTITY_Q = { x: 0, y: 0, z: 0, w: 1 };

export function normalizeQuat(q) {
  const x = q.x || 0, y = q.y || 0, z = q.z || 0;
  const w = q.w === undefined ? 1 : q.w;
  const n = Math.hypot(x, y, z, w);
  if (n < 1e-12) return { ...IDENTITY_Q };
  return { x: x / n, y: y / n, z: z / n, w: w / n };
}

function toThreeQuat(q) {
  const n = normalizeQuat(q);
  return new THREE.Quaternion(n.x, n.y, n.z, n.w);
}

// REP-103 / tf2: R = Rz(yaw) * Ry(pitch) * Rx(roll). Angles in radians.
// THREE.Quaternion.multiply is post-multiply (a.multiply(b) => a*b).
export function eulerToQuat(roll, pitch, yaw) {
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pitch);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
  const q = qz.clone().multiply(qy).multiply(qx);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

// Inverse of eulerToQuat for the same REP-103 convention. Radians out.
export function quatToEuler(q) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(toThreeQuat(q));
  const e = m.elements; // column-major
  const r00 = e[0], r10 = e[1], r20 = e[2], r21 = e[6], r22 = e[10];
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return {
    roll: Math.atan2(r21, r22),
    pitch: Math.asin(clamp(-r20)),
    yaw: Math.atan2(r10, r00),
  };
}

// Row-major 3x3 rotation matrix (array of 3 arrays) for display.
export function quatToMatrix3(q) {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(toThreeQuat(q)).elements;
  return [
    [e[0], e[4], e[8]],
    [e[1], e[5], e[9]],
    [e[2], e[6], e[10]],
  ];
}

// Parent->child matrix in the canonical basis, including the frame's own
// convention reorientation:  M = Translate(t) * R(quat) * C(conv).
export function localMatrix(translation, quat, convention) {
  const trs = new THREE.Matrix4().compose(
    new THREE.Vector3(translation.x, translation.y, translation.z),
    toThreeQuat(quat),
    new THREE.Vector3(1, 1, 1),
  );
  return trs.multiply(conventionMatrix4(convention));
}

// frames: [{id, parent_id, translation:{x,y,z}, rotation:{x,y,z,w}, convention}]
// Returns Map<id, THREE.Matrix4> world transforms (canonical ENU).
export function computeWorldMatrices(frames) {
  const byId = new Map(frames.map((f) => [f.id, f]));
  const cache = new Map();
  const visiting = new Set();

  function worldOf(id) {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) throw new Error('cycle detected in frame hierarchy');
    const f = byId.get(id);
    if (!f) throw new Error(`unknown frame id: ${id}`);
    visiting.add(id);

    const local = localMatrix(
      f.translation,
      f.rotation || IDENTITY_Q,
      f.convention || 'ENU',
    );
    const world =
      f.parent_id == null
        ? local
        : worldOf(f.parent_id).clone().multiply(local);

    visiting.delete(id);
    cache.set(id, world);
    return world;
  }

  for (const f of frames) worldOf(f.id);
  return cache;
}

// Pose of `toId` expressed in `fromId`'s frame: inv(W_from) · W_to.
// worlds is the Map from computeWorldMatrices.
export function relativeMatrix(worlds, fromId, toId) {
  const wf = worlds.get(fromId);
  const wt = worlds.get(toId);
  if (!wf || !wt) throw new Error('unknown frame id');
  return new THREE.Matrix4().copy(wf).invert().multiply(wt);
}

// Decompose a world Matrix4 into position + quaternion (for resolved-world
// display; convert to RPY/matrix with quatToEuler / quatToMatrix3).
export function decompose(matrix) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  matrix.decompose(pos, quat, scl);
  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
  };
}
