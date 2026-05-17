import * as THREE from 'three';

// Canonical internal basis = ENU (right-handed, Z up; REP-103 world).
//
// conventionMatrix(conv) is a pure rotation (det = +1) that reorients a
// frame's stated convention axes into the canonical drawing. ENU and FLU map
// to identity (both: right-handed, Z up); NED and FRD are the Z-down variants.
//
//   ENU/FLU : I
//   NED     : [[0,1,0],[1,0,0],[0,0,-1]]  (180 deg about (1,1,0)/sqrt2)
//   FRD     : [[1,0,0],[0,-1,0],[0,0,-1]] (180 deg about X)

export const CONVENTIONS = ['ENU', 'NED', 'FRD', 'FLU'];

const MATRIX3 = {
  ENU: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  FLU: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  NED: [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  FRD: [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
};

// Per-convention axis labels for the 3D triad and tree UI.
export const AXIS_LABELS = {
  ENU: { x: 'E', y: 'N', z: 'U' },
  NED: { x: 'N', y: 'E', z: 'D' },
  FRD: { x: 'F', y: 'R', z: 'D' },
  FLU: { x: 'F', y: 'L', z: 'U' },
};

export function conventionMatrix3(conv) {
  const m = MATRIX3[conv];
  if (!m) throw new Error(`unknown convention: ${conv}`);
  return m;
}

export function conventionMatrix4(conv) {
  const m = conventionMatrix3(conv);
  // THREE.Matrix4.set is row-major.
  return new THREE.Matrix4().set(
    m[0][0], m[0][1], m[0][2], 0,
    m[1][0], m[1][1], m[1][2], 0,
    m[2][0], m[2][1], m[2][2], 0,
    0, 0, 0, 1,
  );
}

// Determinant of the 3x3 part — used by tests to assert proper rotations.
export function conventionDet(conv) {
  const m = conventionMatrix3(conv);
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}
