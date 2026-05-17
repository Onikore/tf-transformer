import { getFrame, getChildren, deleteFrame } from '../state.js';

let msgTimer = null;

export function showMessage(text, kind = 'info') {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.className = `message ${kind}`;
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => {
    el.textContent = '';
    el.className = 'message';
  }, 5000);
}

// Shared delete flow: prompts subtree-vs-reparent when the frame has children.
export function confirmAndDelete(id) {
  const f = getFrame(id);
  if (!f) return;
  const kids = getChildren(id);
  if (kids.length === 0) {
    if (confirm(`Delete frame "${f.name}"?`)) deleteFrame(id, 'subtree');
    return;
  }
  const isRoot = f.parent_id == null;
  if (isRoot) {
    if (confirm(`"${f.name}" is the root with ${kids.length} child frame(s).\nDelete the ENTIRE tree?`)) {
      deleteFrame(id, 'subtree');
    }
    return;
  }
  const parent = getFrame(f.parent_id);
  const subtree = confirm(
    `"${f.name}" has ${kids.length} child frame(s).\n\n` +
    `OK  = delete the whole subtree\n` +
    `Cancel = keep children, reparent them to "${parent ? parent.name : 'parent'}"`,
  );
  try {
    deleteFrame(id, subtree ? 'subtree' : 'reparent');
  } catch (e) {
    showMessage(e.message, 'error');
  }
}
