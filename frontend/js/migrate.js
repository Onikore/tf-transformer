import { eulerToQuat, deg2rad } from './math/transforms.js';

// Up-convert a legacy config object (rotation {roll,pitch,yaw} + optional
// angle_unit, default deg) to the canonical quaternion schema. Returns
// { config, migrated }. Idempotent on new-schema configs (migrated=false).
// Does not mutate the input.
export function migrateConfig(obj) {
  if (!obj || typeof obj !== 'object') return { config: obj, migrated: false };
  const config = JSON.parse(JSON.stringify(obj));
  let migrated = false;
  for (const frame of config.frames || []) {
    const hadUnit = 'angle_unit' in frame;
    const unit = frame.angle_unit;
    delete frame.angle_unit;
    const rot = frame.rotation;
    const isLegacyRot =
      rot && typeof rot === 'object' &&
      ('roll' in rot || 'pitch' in rot || 'yaw' in rot);
    if (isLegacyRot) {
      let r = Number(rot.roll) || 0;
      let p = Number(rot.pitch) || 0;
      let y = Number(rot.yaw) || 0;
      if (unit !== 'rad') {
        r = deg2rad(r); p = deg2rad(p); y = deg2rad(y);
      }
      frame.rotation = eulerToQuat(r, p, y);
      migrated = true;
    } else if (hadUnit) {
      migrated = true;
    }
  }
  return { config, migrated };
}
