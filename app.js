const $ = id => document.getElementById(id);
let vault = {containers: []}, selected = '', editing = null, renameMode = false, busy = false, pendingDelete = null;
let toastTimer;
const trash = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
const pencil = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/></svg>';
function toast(message) { $('toast').textContent = message; $('toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').style.display = 'none', 2500); }
function current() { return vault.containers.find(c => c.id === selected); }
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function button(text, fn, title, cls) { const b = el('button', text, cls); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); return b; }
function iconButton(svg, fn, title, cls) { const b = button('', fn, title, cls); const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml'); b.append(document.importNode(parsed.documentElement, true)); return b; }
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw Error(response?.error || 'No se pudo completar.');
  if (response.vault) { vault = response.vault; render(); }
  return response;
}
async function act(fn) {
  if (busy) return;
  busy = true; setDisabled();
  try { await fn(); } catch(e) { toast(e.message); }
  finally { busy = false; render(); }
}
function setDisabled() {
  document.querySelectorAll('button, select').forEach(b => b.disabled = busy);
  for (const id of ['rename','delete-container','export-container','add-entry']) $(id).disabled = busy || !current();
}
async function remember() { try { await chrome.storage.local.set({uiSelected: selected}); } catch {} }
function askDelete(title, detail, action) { pendingDelete = action; $('confirm-title').textContent = title; $('confirm-detail').textContent = detail; $('confirm-dialog').showModal(); }
function render() {
  if (!current()) selected = '';
  const c = current();
  $('containers').replaceChildren(el('option', 'Elegir contenedor'));
  $('containers').firstChild.value = '';
  for (const item of vault.containers) { const o = el('option', item.name); o.value = item.id; $('containers').append(o); }
  $('containers').value = selected;
  $('title').textContent = 'Enlaces';
  $('count').textContent = c ? String(c.entries.length).padStart(2, '0') : '00';
  $('title').title = c?.name || '';
  $('entries').replaceChildren();
  if (!c || !c.entries.length) $('entries').append(el('div', c ? 'Sin enlaces' : 'Sin selección', 'empty'));
  for (const entry of c?.entries || []) {
    const row = el('article', undefined, 'entry');
    const credentials = el('div', undefined, 'credentials');
    const open = () => act(() => send({type:'entry-open',containerId:c.id,id:entry.id}));
    const name = button(entry.name, open, 'Abrir enlace', 'link-name');
    credentials.append(name);
    const actions = el('div', undefined, 'entry-actions');
    actions.append(button('Ir ↗', open, 'Abrir enlace', 'go'), iconButton(pencil, () => openEntry(entry), 'Editar enlace'), iconButton(trash, () => askDelete('¿Eliminar enlace?', entry.reference, async () => { await send({type:'entry-delete',containerId:c.id,id:entry.id}); toast('Eliminada'); }), 'Eliminar enlace', 'danger'));
    row.append(credentials, el('div', 'Ref.: ' + entry.reference, 'reference'), actions);
    $('entries').append(row);
  }
  setDisabled();
}
function openEntry(entry) { editing = entry?.id || null; $('entry-title').textContent = entry ? 'Editar enlace' : 'Agregar enlace'; for (const field of ['reference','link-name','url']) $(field).value = entry?.[field === 'link-name' ? 'name' : field] || ''; $('entry-dialog').showModal(); }
$('containers').onchange = () => { selected = $('containers').value; render(); remember(); };
$('add-container').onclick = () => { renameMode = false; $('name-title').textContent = 'Nuevo contenedor'; $('name').value = ''; $('name-dialog').showModal(); };
$('more').onclick = () => $('options-dialog').showModal();
$('rename').onclick = () => { $('options-dialog').close(); renameMode = true; $('name-title').textContent = 'Renombrar'; $('name').value = current().name; $('name-dialog').showModal(); };
$('name-form').onsubmit = e => { e.preventDefault(); act(async () => { const before = new Set(vault.containers.map(c => c.id)); await send({type:renameMode ? 'container-rename' : 'container-add',containerId:selected,name:$('name').value}); if (!renameMode) selected = vault.containers.find(c => !before.has(c.id))?.id || ''; await remember(); $('name-dialog').close(); toast('Guardado'); }); };
$('add-entry').onclick = () => openEntry();
$('entry-form').onsubmit = e => { e.preventDefault(); act(async () => { await send({type:'entry-save',containerId:selected,entry:{id:editing,reference:$('reference').value,name:$('link-name').value,url:$('url').value}}); $('entry-dialog').close(); $('entry-form').reset(); toast('Guardado'); }); };
$('delete-container').onclick = () => { const c = current(); $('options-dialog').close(); askDelete('¿Eliminar contenedor?', c.name + ' · ' + c.entries.length + ' enlaces', async () => { await send({type:'container-delete',containerId:c.id}); await remember(); }); };
$('confirm-delete').onclick = () => act(async () => { if (!pendingDelete) return; await pendingDelete(); pendingDelete = null; $('confirm-dialog').close(); });
$('confirm-dialog').addEventListener('close', () => pendingDelete = null);
for (const [id, one] of [['export-all',false],['export-container',true]]) $(id).onclick = () => act(async () => { await send({type:'export',id:one ? selected : null}); toast('Descargando TXT'); });
$('import').onclick = () => $('file').click();
$('file').onchange = () => act(async () => { const f = $('file').files[0]; if (!f) return; if (f.size > 15 * 1024 * 1024) throw Error('El archivo supera 15 MB.'); await send({type:'import',text:await f.text()}); $('file').value = ''; $('options-dialog').close(); toast('Importado'); });
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { b.closest('dialog').close(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area !== 'local') return; if (changes.vault) { vault = changes.vault.newValue || {containers:[]}; render(); } });
act(async () => { await send({type:'get'}); const prefs = await chrome.storage.local.get('uiSelected'); selected = prefs.uiSelected || ''; });
