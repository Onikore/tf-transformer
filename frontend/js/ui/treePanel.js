import {
  subscribe, getRoot, getChildren, getSelectedId, select, getFrames, getFrame,
} from '../state.js';
import {
  computeWorldMatrices, decompose, relativeMatrix,
  quatToEuler, quatToMatrix3, rad2deg,
} from '../math/transforms.js';
import { confirmAndDelete } from './util.js';

const collapsed = new Set();
let displayMode = 'rpy_deg'; // rpy_deg | rpy_rad | quat | matrix
let relFrom = '';
let relTo = '';

function fmt(n) {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-4) return '0';
  return n.toFixed(3).replace(/\.?0+$/, '');
}

// Rotation quaternion -> HTML string in the chosen display mode.
function rotHtml(q) {
  if (displayMode === 'quat') {
    return `q (${fmt(q.x)}, ${fmt(q.y)}, ${fmt(q.z)}, ${fmt(q.w)})`;
  }
  if (displayMode === 'matrix') {
    const m = quatToMatrix3(q);
    const row = (a) => `[${a.map(fmt).join(' ')}]`;
    return `<span class="mat">${row(m[0])}\n${row(m[1])}\n${row(m[2])}</span>`;
  }
  const e = quatToEuler(q);
  if (displayMode === 'rpy_rad') {
    return `rpy (${fmt(e.roll)}, ${fmt(e.pitch)}, ${fmt(e.yaw)}) rad`;
  }
  return `rpy° (${fmt(rad2deg(e.roll))}, ${fmt(rad2deg(e.pitch))}, ${fmt(rad2deg(e.yaw))})`;
}

export function initTreePanel(container) {
  container.innerHTML = `
    <section id="rel-xform">
      <h2>Relative transform</h2>
      <div class="rel-row">
        <label>from<select id="rel-from"></select></label>
        <span class="rel-arrow">→</span>
        <label>to<select id="rel-to"></select></label>
      </div>
      <div id="rel-result" class="rel-result"></div>
    </section>
    <div class="tree-head">
      <h2>Hierarchy &amp; transforms</h2>
      <label class="disp">show rotation as
        <select id="rot-display">
          <option value="rpy_deg">RPY (deg)</option>
          <option value="rpy_rad">RPY (rad)</option>
          <option value="quat">Quaternion</option>
          <option value="matrix">Matrix 3×3</option>
        </select>
      </label>
    </div>
    <div id="tree-body"></div>
  `;
  const body = container.querySelector('#tree-body');
  const dispSel = container.querySelector('#rot-display');
  const relFromSel = container.querySelector('#rel-from');
  const relToSel = container.querySelector('#rel-to');
  const relResult = container.querySelector('#rel-result');

  dispSel.value = displayMode;
  dispSel.addEventListener('change', () => {
    displayMode = dispSel.value;
    render();
  });
  relFromSel.addEventListener('change', () => {
    relFrom = relFromSel.value;
    renderRel();
  });
  relToSel.addEventListener('change', () => {
    relTo = relToSel.value;
    renderRel();
  });

  function fillSelect(sel, frames, current) {
    sel.innerHTML =
      '<option value="">—</option>' +
      frames.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    sel.value = frames.some((f) => f.id === current) ? current : '';
  }

  function renderRel() {
    const frames = getFrames();
    fillSelect(relFromSel, frames, relFrom);
    fillSelect(relToSel, frames, relTo);
    relFrom = relFromSel.value;
    relTo = relToSel.value;
    if (!relFrom || !relTo) {
      relResult.innerHTML = '<span class="hint">pick two frames</span>';
      return;
    }
    if (relFrom === relTo) {
      relResult.innerHTML = '<span class="hint">same frame — identity</span>';
      return;
    }
    let worlds;
    try {
      worlds = computeWorldMatrices(frames);
    } catch {
      relResult.innerHTML = '<span class="hint">hierarchy invalid</span>';
      return;
    }
    const d = decompose(relativeMatrix(worlds, relFrom, relTo));
    const p = d.position;
    const dist = Math.hypot(p.x, p.y, p.z);
    const a = getFrame(relFrom)?.name || '?';
    const b = getFrame(relTo)?.name || '?';
    relResult.innerHTML =
      `<div class="rel-title">${escapeHtml(a)} → ${escapeHtml(b)}</div>` +
      `<div>t (${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}) m</div>` +
      `<div>${rotHtml(d.quaternion)}</div>` +
      `<div>distance ${fmt(dist)} m</div>`;
  }

  function nodeHtml(frame, worlds, depth) {
    const sel = getSelectedId() === frame.id;
    const kids = getChildren(frame.id);
    const t = frame.translation;

    let world = '';
    if (sel) {
      const wm = worlds.get(frame.id);
      if (wm) {
        const dd = decompose(wm);
        world = `<div class="world">world&nbsp; t (${fmt(dd.position.x)}, ${fmt(dd.position.y)}, ${fmt(dd.position.z)})<br>${rotHtml(dd.quaternion)}</div>`;
      }
    }

    const caret = kids.length
      ? `<span class="caret" data-toggle="${frame.id}">${collapsed.has(frame.id) ? '▶' : '▼'}</span>`
      : '<span class="caret-empty"></span>';

    const head = `
      <div class="node-row ${sel ? 'selected' : ''}" data-id="${frame.id}" style="padding-left:${depth * 14}px">
        ${caret}
        <span class="node-name">${escapeHtml(frame.name)}</span>
        <span class="badge">${frame.convention}</span>
        <button class="node-del" data-del="${frame.id}" title="Delete">✕</button>
        <div class="node-detail">
          <span>t (${fmt(t.x)}, ${fmt(t.y)}, ${fmt(t.z)}) m</span>
          <span>${rotHtml(frame.rotation)}</span>
          ${world}
        </div>
      </div>`;

    let childHtml = '';
    if (kids.length && !collapsed.has(frame.id)) {
      childHtml = kids.map((c) => nodeHtml(c, worlds, depth + 1)).join('');
    }
    return head + childHtml;
  }

  function render() {
    renderRel();
    const root = getRoot();
    if (!root) {
      body.innerHTML = '<p class="hint">No frames yet. Create one on the left — the first frame becomes the root.</p>';
      return;
    }
    let worlds = new Map();
    try {
      worlds = computeWorldMatrices(getFrames());
    } catch {
      /* transient invalid graph — skip resolved world poses */
    }
    body.innerHTML = nodeHtml(root, worlds, 0);

    body.querySelectorAll('.node-row').forEach((elm) => {
      elm.addEventListener('click', (e) => {
        if (e.target.dataset.del || e.target.dataset.toggle) return;
        select(elm.dataset.id);
      });
    });
    body.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmAndDelete(b.dataset.del);
      });
    });
    body.querySelectorAll('[data-toggle]').forEach((c) => {
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = c.dataset.toggle;
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
        render();
      });
    });
  }

  subscribe(render);
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}
