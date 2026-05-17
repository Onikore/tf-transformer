import { initLeftPanel } from '/js/ui/leftPanel.js';
import { initTreePanel } from '/js/ui/treePanel.js';
import { initViewport } from '/js/scene/viewport.js';
import {
  subscribe, getConfigName, setConfigName, toJSON, loadSession, newSession,
} from '/js/state.js';
import * as api from '/js/api.js';
import { migrateConfig } from '/js/migrate.js';
import { showMessage } from '/js/ui/util.js';

// Surface uncaught errors instead of failing silently.
window.addEventListener('error', (e) => showMessage(`Error: ${e.message}`, 'error'));
window.addEventListener('unhandledrejection', (e) =>
  showMessage(`Error: ${e.reason?.message || e.reason || 'unhandled rejection'}`, 'error'));

initLeftPanel(document.getElementById('left-panel'));
initTreePanel(document.getElementById('right-panel'));
initViewport(document.getElementById('viewport'));

const nameInput = document.getElementById('cfg-name');
nameInput.addEventListener('change', () => setConfigName(nameInput.value.trim() || 'untitled'));
subscribe(() => {
  if (document.activeElement !== nameInput) nameInput.value = getConfigName();
});
nameInput.value = getConfigName();

document.getElementById('btn-new').addEventListener('click', () => {
  if (confirm('Discard the current session and start a new one?')) {
    newSession();
    showMessage('New session', 'info');
  }
});

document.getElementById('btn-save').addEventListener('click', async () => {
  const name = (prompt('Save as (letters, digits, _ . - and spaces):', getConfigName()) || '').trim();
  if (!name) return;
  setConfigName(name);
  try {
    await api.saveConfig(name, toJSON());
    showMessage(`Saved "${name}"`, 'success');
  } catch (e) {
    showMessage(e.message, 'error');
  }
});

const dialog = document.getElementById('load-dialog');
const loadList = document.getElementById('load-list');
document.getElementById('load-close').addEventListener('click', () => dialog.close());

document.getElementById('btn-load').addEventListener('click', async () => {
  try {
    const configs = await api.listConfigs();
    renderLoadList(configs);
    dialog.showModal();
  } catch (e) {
    showMessage(e.message, 'error');
  }
});

function renderLoadList(configs) {
  if (!configs.length) {
    loadList.innerHTML = '<p class="hint">No saved configurations yet.</p>';
    return;
  }
  loadList.innerHTML = '';
  for (const c of configs) {
    const row = document.createElement('div');
    row.className = 'load-row';
    row.innerHTML = `
      <span class="lr-name"></span>
      <span class="lr-meta">${c.frame_count} frame(s) · ${c.modified || ''}</span>
      <button class="lr-load">Load</button>
      <button class="lr-del">Delete</button>`;
    row.querySelector('.lr-name').textContent = c.name;
    row.querySelector('.lr-load').addEventListener('click', async () => {
      try {
        const { config, migrated } = await api.loadConfig(c.name);
        const m = migrateConfig(config);
        loadSession(m.config);
        dialog.close();
        showMessage(
          migrated || m.migrated
            ? `Loaded "${c.name}" (migrated from legacy rotation format)`
            : `Loaded "${c.name}"`,
          migrated || m.migrated ? 'info' : 'success',
        );
      } catch (e) {
        showMessage(e.message, 'error');
      }
    });
    row.querySelector('.lr-del').addEventListener('click', async () => {
      if (!confirm(`Delete saved config "${c.name}"?`)) return;
      try {
        await api.deleteConfig(c.name);
        renderLoadList(await api.listConfigs());
        showMessage(`Deleted "${c.name}"`, 'info');
      } catch (e) {
        showMessage(e.message, 'error');
      }
    });
    loadList.appendChild(row);
  }
}

document.getElementById('btn-export').addEventListener('click', () => {
  api.exportToFile(toJSON());
  showMessage('Exported JSON', 'info');
});

document.getElementById('btn-import').addEventListener('click', async () => {
  try {
    const obj = await api.importFromFile();
    const { config, migrated } = migrateConfig(obj);
    loadSession(config);
    showMessage(
      migrated ? 'Imported JSON (migrated from legacy rotation format)' : 'Imported JSON',
      migrated ? 'info' : 'success',
    );
  } catch (e) {
    showMessage(e.message, 'error');
  }
});
