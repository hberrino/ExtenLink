let queue = Promise.resolve();
const blank = () => ({containers: [], revision: 0});
const marker = '\n--- DATOS PARA RESTAURAR ---\n';
function backupText(data, title) {
  const lines = ['MIS LINKS — ' + title, 'Copia sin cifrar · ' + new Date().toLocaleString('es-AR'), ''];
  for (const c of data.containers) {
    lines.push('CONTENEDOR: ' + c.name, '='.repeat(48));
    for (const e of c.entries) lines.push('Referencia: ' + e.reference, 'Nombre: ' + e.name, 'Link: ' + e.url, '');
    if (!c.entries.length) lines.push('(Sin registros)', '');
  }
  return lines.join('\n') + marker + JSON.stringify({format: 'mis-links-v1', containers: data.containers}, null, 2);
}
function validateImport(input) {
  if (input?.format !== 'mis-links-v1' || !Array.isArray(input.containers)) throw Error('Esta copia no tiene el formato de Mis Links.');
  return input.containers.map(c => {
    if (typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.entries)) throw Error('Contenedor inválido en la copia.');
    return {id: crypto.randomUUID(), name: c.name.trim(), entries: c.entries.map(e => {
      if (![e.name, e.url, e.reference].every(v => typeof v === 'string')) throw Error('Registro inválido en la copia.');
      return {id: crypto.randomUUID(), name: validName(e.name), url: normalizeUrl(e.url), reference: e.reference};
    })};
  });
}
async function download(data, title, filename) {
  const text = backupText(data, title);
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return chrome.downloads.download({url: 'data:text/plain;charset=utf-8;base64,' + btoa(binary), filename, conflictAction: 'uniquify', saveAs: false});
}
function validName(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('Escribí un nombre para el enlace.');
  return value.trim();
}
function normalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('Escribí el link.');
  let raw = value.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) raw = 'https://' + raw;
  let url; try { url = new URL(raw); } catch { throw Error('El link no es válido.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) throw Error('Usá un link http:// o https://.');
  return url.href;
}
async function handle(m) {
  const {vault = blank()} = await chrome.storage.local.get('vault');
  if (m.type === 'get') return {vault};
  if (m.type === 'entry-open') {
    const entry = vault.containers.find(c => c.id === m.containerId)?.entries.find(e => e.id === m.id);
    if (!entry) throw Error('El enlace ya no existe.');
    await chrome.tabs.create({url: normalizeUrl(entry.url)});
    return {};
  }
  if (m.type === 'export') {
    const c = m.id ? vault.containers.find(c => c.id === m.id) : null;
    if (m.id && !c) throw Error('No se encontró el contenedor.');
    const safe = c ? c.name.replace(/[^\p{L}\p{N} _-]/gu, '_').slice(0, 65) : 'Todos';
    await download(c ? {containers: [c]} : vault, c?.name || 'Todos los contenedores', 'MisLinks/' + safe + '-' + Date.now() + '.txt');
    return {message: 'Copia TXT enviada a Descargas.'};
  }
  if (m.type === 'container-add') {
    const name = String(m.name || '').trim();
    if (!name) throw Error('Escribí un nombre.');
    vault.containers.push({id: crypto.randomUUID(), name, entries: []});
  } else if (m.type === 'import') {
    const index = m.text.lastIndexOf(marker);
    const restored = validateImport(JSON.parse(index < 0 ? m.text : m.text.slice(index + marker.length)));
    vault.containers.push(...restored);
  } else {
    const c = vault.containers.find(c => c.id === m.containerId);
    if (!c) throw Error('El contenedor ya no existe. Actualizá la página.');
    if (m.type === 'container-rename') {
      if (!m.name?.trim()) throw Error('Escribí un nombre.');
      c.name = m.name.trim();
    } else if (m.type === 'container-delete') vault.containers = vault.containers.filter(v => v.id !== c.id);
    else if (m.type === 'entry-save') {
      if (![m.entry?.name, m.entry?.url, m.entry?.reference].every(v => typeof v === 'string')) throw Error('Datos inválidos.');
      if (!m.entry.reference.trim()) throw Error('Escribí una referencia.');
      const entry = {id: m.entry.id || crypto.randomUUID(), name: validName(m.entry.name), url: normalizeUrl(m.entry.url), reference: m.entry.reference};
      const index = c.entries.findIndex(e => e.id === entry.id);
      if (m.entry.id && index < 0) throw Error('El registro ya no existe.');
      if (index < 0) c.entries.push(entry); else c.entries[index] = entry;
    } else if (m.type === 'entry-delete') c.entries = c.entries.filter(e => e.id !== m.id);
    else throw Error('Acción desconocida.');
  }
  vault.revision++;
  await chrome.storage.local.set({vault});
  return {vault};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  queue = queue.then(() => handle(message)).then(result => respond({ok: true, ...result}), error => respond({ok: false, error: error.message}));
  return true;
});
