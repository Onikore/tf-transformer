import {
  subscribe, getFrames, getFrame, getRoot, getSelectedId,
  addFrame, updateFrame, select, isDescendant, validateName,
} from '../state.js';
import { CONVENTIONS } from '../math/conventions.js';
import {
  eulerToQuat, quatToEuler, normalizeQuat, deg2rad, rad2deg,
} from '../math/transforms.js';
import { showMessage, confirmAndDelete } from './util.js';

export function initLeftPanel(container) {
  container.innerHTML = `
    <h2>Frame</h2>
    <form id="frame-form" autocomplete="off">
      <label>Name<input type="text" id="f-name" required></label>

      <label>Parent<select id="f-parent"></select></label>

      <fieldset>
        <legend>Translation (m, relative to parent)</legend>
        <div class="row3">
          <label>X<input type="number" step="any" id="f-tx" value="0"></label>
          <label>Y<input type="number" step="any" id="f-ty" value="0"></label>
          <label>Z<input type="number" step="any" id="f-tz" value="0"></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Rotation (relative to parent)</legend>
        <label>Input as
          <select id="f-rotmode">
            <option value="rpy">RPY (Euler)</option>
            <option value="quat">Quaternion</option>
          </select>
        </label>

        <div id="rpy-block">
          <div class="row3">
            <label>Roll<input type="number" step="any" id="f-rr" value="0"></label>
            <label>Pitch<input type="number" step="any" id="f-rp" value="0"></label>
            <label>Yaw<input type="number" step="any" id="f-ry" value="0"></label>
          </div>
          <div class="units">
            <label><input type="radio" name="unit" value="deg" checked> degrees</label>
            <label><input type="radio" name="unit" value="rad"> radians</label>
          </div>
        </div>

        <div id="quat-block" hidden>
          <div class="row4">
            <label>x<input type="number" step="any" id="f-qx" value="0"></label>
            <label>y<input type="number" step="any" id="f-qy" value="0"></label>
            <label>z<input type="number" step="any" id="f-qz" value="0"></label>
            <label>w<input type="number" step="any" id="f-qw" value="1"></label>
          </div>
          <p class="hint">normalized on apply</p>
        </div>
      </fieldset>

      <label>Coordinate system
        <select id="f-conv">
          ${CONVENTIONS.map((c) => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </label>

      <div class="actions">
        <button type="submit" id="f-add">Add frame</button>
        <button type="button" id="f-new" class="secondary">New / clear</button>
        <button type="button" id="f-delete" class="danger" hidden>Delete</button>
      </div>
      <p class="hint" id="edit-hint" hidden>Editing live — changes apply as you type.</p>
    </form>
  `;

  const form = container.querySelector('#frame-form');
  const el = (id) => container.querySelector(id);
  const nameEl = el('#f-name');
  const parentEl = el('#f-parent');
  const convEl = el('#f-conv');
  const rotModeEl = el('#f-rotmode');
  const rpyBlock = el('#rpy-block');
  const quatBlock = el('#quat-block');
  const addBtn = el('#f-add');
  const deleteBtn = el('#f-delete');
  const editHint = el('#edit-hint');

  let mode = 'rpy';
  let unit = 'deg';
  let suppressFill = false;

  const getUnit = () => form.querySelector('input[name="unit"]:checked').value;
  const setUnit = (u) => {
    form.querySelector(`input[name="unit"][value="${u}"]`).checked = true;
    unit = u;
  };
  const r = (v) => (Math.abs(v) < 1e-12 ? 0 : Number(Number(v).toFixed(6)));
  const numv = (sel) => {
    const n = parseFloat(el(sel).value);
    return Number.isFinite(n) ? n : 0;
  };

  // Read the rotation editor and return a canonical quaternion.
  function gatherQuat() {
    if (mode === 'quat') {
      return normalizeQuat({
        x: numv('#f-qx'), y: numv('#f-qy'), z: numv('#f-qz'), w: numv('#f-qw'),
      });
    }
    let roll = numv('#f-rr');
    let pitch = numv('#f-rp');
    let yaw = numv('#f-ry');
    if (unit === 'deg') {
      roll = deg2rad(roll); pitch = deg2rad(pitch); yaw = deg2rad(yaw);
    }
    return eulerToQuat(roll, pitch, yaw);
  }

  // Fill the visible rotation editor from a quaternion.
  function fillRotation(q) {
    if (mode === 'quat') {
      const n = normalizeQuat(q);
      el('#f-qx').value = r(n.x);
      el('#f-qy').value = r(n.y);
      el('#f-qz').value = r(n.z);
      el('#f-qw').value = r(n.w);
    } else {
      const e = quatToEuler(q);
      const k = unit === 'deg' ? rad2deg : (x) => x;
      el('#f-rr').value = r(k(e.roll));
      el('#f-rp').value = r(k(e.pitch));
      el('#f-ry').value = r(k(e.yaw));
    }
  }

  function showMode() {
    rpyBlock.hidden = mode !== 'rpy';
    quatBlock.hidden = mode !== 'quat';
  }

  function rebuildParents(selId, currentParentId) {
    const frames = getFrames();
    const root = getRoot();
    const opts = [];
    if (!root || (selId && root && root.id === selId)) {
      opts.push('<option value="">(root — no parent)</option>');
    }
    for (const f of frames) {
      if (selId && isDescendant(selId, f.id)) continue;
      opts.push(`<option value="${f.id}">${escapeHtml(f.name)}</option>`);
    }
    parentEl.innerHTML = opts.join('');
    parentEl.value = currentParentId != null ? currentParentId : '';
  }

  function readForm() {
    return {
      name: nameEl.value.trim(),
      parent_id: parentEl.value || null,
      translation: { x: numv('#f-tx'), y: numv('#f-ty'), z: numv('#f-tz') },
      rotation: gatherQuat(),
      convention: convEl.value,
    };
  }

  // Live-apply edits to the selected frame. Non-name fields always apply;
  // the name applies only when valid (so mid-typing dups don't break things).
  function applyLive() {
    const selId = getSelectedId();
    if (!selId || !getFrame(selId)) return;
    const data = readForm();
    const nameErr = validateName(data.name, selId);
    const patch = {
      parent_id: data.parent_id,
      translation: data.translation,
      rotation: data.rotation,
      convention: data.convention,
    };
    if (!nameErr) patch.name = data.name;
    suppressFill = true;
    try {
      updateFrame(selId, patch);
      showMessage(nameErr ? `Name not applied: ${nameErr}` : '', nameErr ? 'error' : 'info');
    } catch (e) {
      showMessage(e.message, 'error');
    } finally {
      suppressFill = false;
    }
  }

  // ---- events ----
  form.addEventListener('input', (e) => {
    if (e.target.name === 'unit') return; // handled below
    if (getSelectedId()) applyLive();
  });
  form.addEventListener('change', (e) => {
    if (e.target === rotModeEl || e.target.name === 'unit') return;
    if (getSelectedId()) applyLive();
  });

  rotModeEl.addEventListener('change', () => {
    const q = gatherQuat(); // preserve current rotation across representations
    mode = rotModeEl.value;
    showMode();
    fillRotation(q);
  });

  form.querySelectorAll('input[name="unit"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const u = getUnit();
      if (u === unit) return;
      const conv = u === 'rad' ? deg2rad : rad2deg;
      for (const id of ['#f-rr', '#f-rp', '#f-ry']) {
        const v = parseFloat(el(id).value);
        if (Number.isFinite(v)) el(id).value = r(conv(v));
      }
      unit = u;
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (getSelectedId()) return; // edit mode is live; submit only creates
    try {
      const f = addFrame(readForm());
      showMessage(`Added "${f.name}"`, 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  el('#f-new').addEventListener('click', () => select(null));
  deleteBtn.addEventListener('click', () => {
    const selId = getSelectedId();
    if (selId) confirmAndDelete(selId);
  });

  function resetForm() {
    nameEl.value = '';
    for (const id of ['#f-tx', '#f-ty', '#f-tz', '#f-rr', '#f-rp', '#f-ry', '#f-qx', '#f-qy', '#f-qz']) {
      el(id).value = 0;
    }
    el('#f-qw').value = 1;
    setUnit('deg');
    mode = 'rpy';
    rotModeEl.value = 'rpy';
    showMode();
    convEl.value = 'ENU';
    rebuildParents(null, null);
  }

  function render() {
    const selId = getSelectedId();
    const f = selId ? getFrame(selId) : null;
    if (f) {
      if (!suppressFill) {
        nameEl.value = f.name;
        el('#f-tx').value = f.translation.x;
        el('#f-ty').value = f.translation.y;
        el('#f-tz').value = f.translation.z;
        fillRotation(f.rotation);
        convEl.value = f.convention;
        rebuildParents(f.id, f.parent_id);
      } else {
        rebuildParents(f.id, parentEl.value || f.parent_id);
      }
      addBtn.hidden = true;
      deleteBtn.hidden = false;
      editHint.hidden = false;
    } else {
      resetForm();
      addBtn.hidden = false;
      deleteBtn.hidden = true;
      editHint.hidden = true;
    }
  }

  subscribe(render);
  showMode();
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}
