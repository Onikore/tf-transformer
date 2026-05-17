// In-memory session model + change pub/sub. Panels subscribe and re-render
// on any mutation. The first frame added becomes the (single) root.

const listeners = new Set();
let session = blankSession();
let selectedId = null;

function nowISO() {
  return new Date().toISOString();
}
function blankSession() {
  const t = nowISO();
  return {
    name: 'untitled',
    version: '1.0',
    frames: [],
    metadata: { created: t, modified: t, root_name: '' },
  };
}
const zeroVec = () => ({ x: 0, y: 0, z: 0 });
const identityQuat = () => ({ x: 0, y: 0, z: 0, w: 1 });

function normalizeFrame(f) {
  return {
    id: f.id || crypto.randomUUID(),
    name: String(f.name || 'frame'),
    parent_id: f.parent_id ?? null,
    translation: { ...zeroVec(), ...(f.translation || {}) },
    rotation: { ...identityQuat(), ...(f.rotation || {}) },
    convention: f.convention || 'ENU',
  };
}

function emit() {
  session.metadata.modified = nowISO();
  const root = getRoot();
  session.metadata.root_name = root ? root.name : '';
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getSession = () => session;
export const getFrames = () => session.frames;
export const getFrame = (id) => session.frames.find((f) => f.id === id) || null;
export const getRoot = () => session.frames.find((f) => f.parent_id == null) || null;
export const getChildren = (id) => session.frames.filter((f) => f.parent_id === id);
export const getSelectedId = () => selectedId;
export const getConfigName = () => session.name;

export function select(id) {
  selectedId = id;
  emit();
}
export function setConfigName(name) {
  session.name = String(name || 'untitled');
  emit();
}

function nameTaken(name, exceptId) {
  return session.frames.some((f) => f.name === name && f.id !== exceptId);
}
export function validateName(name, exceptId = null) {
  if (!name || !String(name).trim()) return 'Name is required';
  if (/\s/.test(name)) return 'Name must not contain spaces (ROS frame_id)';
  if (nameTaken(name, exceptId)) return 'A frame with this name already exists';
  return null;
}

// True if maybeId is inside the subtree rooted at nodeId (or equals it).
export function isDescendant(nodeId, maybeId) {
  if (nodeId === maybeId) return true;
  const stack = getChildren(nodeId).map((f) => f.id);
  while (stack.length) {
    const cur = stack.pop();
    if (cur === maybeId) return true;
    for (const c of getChildren(cur)) stack.push(c.id);
  }
  return false;
}

export function addFrame(data) {
  const err = validateName(data.name);
  if (err) throw new Error(err);
  const hasRoot = !!getRoot();
  let parent_id = hasRoot ? (data.parent_id ?? null) : null;
  if (hasRoot && parent_id == null) {
    throw new Error('A root frame already exists — choose a parent');
  }
  if (parent_id != null && !getFrame(parent_id)) {
    throw new Error('Parent frame not found');
  }
  const frame = normalizeFrame({ ...data, id: crypto.randomUUID(), parent_id });
  session.frames.push(frame);
  selectedId = frame.id;
  emit();
  return frame;
}

export function updateFrame(id, patch) {
  const f = getFrame(id);
  if (!f) throw new Error('Frame not found');
  if (patch.name != null) {
    const err = validateName(patch.name, id);
    if (err) throw new Error(err);
  }
  if (patch.parent_id !== undefined) {
    const pid = patch.parent_id;
    if (pid == null) {
      const root = getRoot();
      if (root && root.id !== id) throw new Error('A root frame already exists');
    } else {
      if (!getFrame(pid)) throw new Error('Parent frame not found');
      if (isDescendant(id, pid)) throw new Error('Cannot set a descendant as parent (cycle)');
    }
  }
  if (patch.name != null) f.name = String(patch.name).trim();
  if (patch.parent_id !== undefined) f.parent_id = patch.parent_id;
  if (patch.translation) f.translation = { ...f.translation, ...patch.translation };
  if (patch.rotation) f.rotation = { ...patch.rotation };
  if (patch.convention) f.convention = patch.convention;
  emit();
  return f;
}

// mode: 'subtree' deletes the frame and all descendants; 'reparent' attaches
// children to the deleted frame's parent (not allowed for the root).
export function deleteFrame(id, mode = 'reparent') {
  const f = getFrame(id);
  if (!f) return;
  const children = getChildren(id);
  if (mode === 'subtree') {
    const toDelete = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const c of getChildren(cur)) {
        toDelete.add(c.id);
        stack.push(c.id);
      }
    }
    session.frames = session.frames.filter((fr) => !toDelete.has(fr.id));
  } else {
    if (f.parent_id == null && children.length) {
      throw new Error('Cannot reparent children of the root — delete the subtree instead');
    }
    for (const c of children) c.parent_id = f.parent_id;
    session.frames = session.frames.filter((fr) => fr.id !== id);
  }
  if (selectedId && !getFrame(selectedId)) selectedId = null;
  emit();
}

export function loadSession(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Invalid config object');
  const base = blankSession();
  session = {
    name: obj.name || 'untitled',
    version: obj.version || '1.0',
    frames: Array.isArray(obj.frames) ? obj.frames.map(normalizeFrame) : [],
    metadata: { ...base.metadata, ...(obj.metadata || {}) },
  };
  selectedId = null;
  emit();
}

export function newSession() {
  session = blankSession();
  selectedId = null;
  emit();
}

export function toJSON() {
  return JSON.parse(JSON.stringify(session));
}
