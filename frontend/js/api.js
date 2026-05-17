// Backend REST client + client-side JSON file export/import (the latter works
// even with no server, satisfying "Export/Import without network").

const BASE = '/api/configs';

async function detail(res) {
  try {
    const d = await res.json();
    return d && d.detail ? d.detail : '';
  } catch {
    return '';
  }
}

export async function listConfigs() {
  const r = await fetch(BASE);
  if (!r.ok) throw new Error('Failed to list configs');
  return r.json();
}

// Returns { config, migrated }. The backend up-converts legacy files on read
// and flags it via the X-TF-Migrated header.
export async function loadConfig(name) {
  const r = await fetch(`${BASE}/${encodeURIComponent(name)}`);
  if (r.status === 404) throw new Error(`Config "${name}" not found`);
  if (!r.ok) throw new Error('Failed to load config');
  const config = await r.json();
  return { config, migrated: r.headers.get('X-TF-Migrated') === '1' };
}

export async function saveConfig(name, config) {
  const r = await fetch(`${BASE}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (r.ok) return r.json();
  if (r.status === 409) throw new Error(`Invalid hierarchy: ${await detail(r)}`);
  if (r.status === 422) throw new Error('Config data failed validation');
  if (r.status === 400) throw new Error('Invalid config name (use letters, digits, _ . -)');
  throw new Error('Failed to save config');
}

export async function deleteConfig(name) {
  const r = await fetch(`${BASE}/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error('Failed to delete config');
  return r.json().catch(() => ({}));
}

export function exportToFile(config) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(config && config.name) || 'tf-config'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importFromFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch {
          reject(new Error('Selected file is not valid JSON'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };
    input.click();
  });
}
