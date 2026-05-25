const STORAGE_KEY = 'satset_playzone_v1_state';
const WIB_TZ = 'Asia/Jakarta';
const SYNC_INTERVAL_MS = 15000;
let syncBusy = false;
let syncTimer = null;
const DEFAULT_PACKAGES = [
  { id: 'try', name: 'Coba Dulu', minutes: 5, price: 5000, badge: 'Entry' },
  { id: 'seru', name: 'Paket Seru', minutes: 15, price: 10000, badge: 'Rekomendasi' },
  { id: 'puas', name: 'Paket Puas', minutes: 25, price: 15000, badge: 'Upsell' },
  { id: 'lama', name: 'Main Lama', minutes: 35, price: 20000, badge: 'Hemat' }
];
const DEFAULT_UNITS = [
  { id: 'excavator-1', name: 'Excavator 1', type: 'Excavator', status: 'available', note: '' },
  { id: 'excavator-2', name: 'Excavator 2', type: 'Excavator', status: 'available', note: '' },
  { id: 'dump-truck-1', name: 'Dump Truck 1', type: 'Dump Truck', status: 'available', note: '' },
  { id: 'loader-1', name: 'Loader 1', type: 'Loader', status: 'available', note: '' }
];

const state = migrateState(loadState());
let currentTab = 'dashboard';
let reportMode = 'today';
let customStart = todayKey();
let customEnd = todayKey();

function todayKey(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: WIB_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(date); }
function rupiah(n) { return new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(n || 0)); }
function timeOnly(ts) { return ts ? new Date(ts).toLocaleTimeString('id-ID', { timeZone: WIB_TZ, hour:'2-digit', minute:'2-digit' }) : '-'; }
function dateTime(ts) { return ts ? new Date(ts).toLocaleString('id-ID', { timeZone: WIB_TZ, dateStyle:'medium', timeStyle:'short' }) : '-'; }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toMinutes(str){ const [h,m] = String(str || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function addDays(date, days){ const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function dateRangeLabel(start, end){ return start === end ? start : `${start} s/d ${end}`; }

function loadState(){
  const fallback = {
    day: null,
    packages: DEFAULT_PACKAGES,
    units: DEFAULT_UNITS,
    sessions: [],
    activeSessions: [],
    activeSession: null,
    settings: { ownerName: 'Owner', sound: true, openTime: '09:00', closeTime: '21:00', enforceHours: false, operationMode: 'auto', businessName: 'SATSET PLAYZONE', profileText: 'Owner control · Multi unit RC · Cash only', logoText: 'SP', logoImage: '', syncEnabled: false, syncUrl: '', syncDeviceName: 'Owner 1', lastSyncAt: '', syncStatus: 'Belum aktif' }, updatedAt: Date.now()
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed };
  } catch { return fallback; }
}
function migrateState(s){
  s.packages = s.packages?.length ? s.packages : DEFAULT_PACKAGES;
  s.units = s.units?.length ? s.units : DEFAULT_UNITS;
  s.sessions = Array.isArray(s.sessions) ? s.sessions : [];
  s.activeSessions = Array.isArray(s.activeSessions) ? s.activeSessions : [];
  if (s.activeSession) {
    s.activeSessions.unshift(s.activeSession);
    s.activeSession = null;
  }
  s.settings = { ownerName: 'Owner', sound: true, openTime: '09:00', closeTime: '21:00', enforceHours: false, operationMode: 'auto', businessName: 'SATSET PLAYZONE', profileText: 'Owner control · Multi unit RC · Cash only', logoText: 'SP', logoImage: '', syncEnabled: false, syncUrl: '', syncDeviceName: 'Owner 1', lastSyncAt: '', syncStatus: 'Belum aktif', ...(s.settings || {}) };
  delete s.settings.pin;
  s.updatedAt = Number(s.updatedAt || Date.now());
  syncUnitStatuses(s, false);
  return s;
}
function saveState(options = {}){
  const shouldPush = options.push !== false;
  state.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (shouldPush) scheduleSyncPush();
}
function persistWithoutTouch(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function ensureDay(){
  if (!state.day || state.day.date !== todayKey()) {
    state.day = { date: todayKey(), openedAt: null, closedAt: null };
    saveState();
  }
}
function isWithinOperatingHours(){
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const open = toMinutes(state.settings.openTime);
  const close = toMinutes(state.settings.closeTime);
  if (open === close) return true;
  if (open < close) return current >= open && current < close;
  return current >= open || current < close;
}
function isOperatingNow(){
  if (state.settings.operationMode === 'manual_open') return true;
  if (state.settings.operationMode === 'manual_closed') return false;
  return isWithinOperatingHours();
}
function operatingLabel(){
  if (state.settings.operationMode === 'manual_open') return 'BUKA';
  if (state.settings.operationMode === 'manual_closed') return 'TUTUP';
  return isOperatingNow() ? 'BUKA' : 'TUTUP';
}
function operationModeLabel(){
  if (state.settings.operationMode === 'manual_open') return 'Manual buka';
  if (state.settings.operationMode === 'manual_closed') return 'Manual tutup/cuti';
  return `Otomatis ${state.settings.openTime} - ${state.settings.closeTime}`;
}
function brandLogoHtml(){
  if (state.settings.logoImage) return `<img src="${esc(state.settings.logoImage)}" alt="Logo" />`;
  return esc(state.settings.logoText || 'SP');
}
function activeForUnit(unitId){ return state.activeSessions.find(s => s.unitId === unitId); }
function syncUnitStatuses(target = state, persist = true){
  const activeIds = new Set((target.activeSessions || []).map(s => s.unitId).filter(Boolean));
  target.units = (target.units || DEFAULT_UNITS).map(u => {
    if (u.status !== 'broken' && activeIds.has(u.id)) return { ...u, status: 'in_use' };
    if (u.status === 'in_use' && !activeIds.has(u.id)) return { ...u, status: 'available' };
    return u;
  });
  if (persist) saveState();
}
function unitById(id){ return state.units.find(u => u.id === id); }
function statusLabel(status){ return status === 'available' ? 'Tersedia' : status === 'in_use' ? 'Dipakai' : 'Rusak'; }
function statusClass(status){ return status === 'available' ? 'open' : status === 'in_use' ? 'busy' : 'broken'; }
function availableUnits(){ syncUnitStatuses(state, false); return state.units.filter(u => u.status === 'available'); }

function sessionsBetween(start, end){ return state.sessions.filter(s => s.status === 'done' && s.date >= start && s.date <= end); }
function todaysSessions(){ return sessionsBetween(todayKey(), todayKey()); }
function calcReport(list = todaysSessions()){
  const done = list.filter(s => s.status === 'done');
  const revenue = done.reduce((sum,s)=>sum+Number(s.price||0),0);
  const duration = done.reduce((sum,s)=>sum+Number(s.minutes||0),0);
  const packageMap = {};
  const unitMap = {};
  done.forEach(s => {
    packageMap[s.packageName] = (packageMap[s.packageName] || 0) + 1;
    unitMap[s.unitName || '-'] = (unitMap[s.unitName || '-'] || 0) + 1;
  });
  const best = Object.entries(packageMap).sort((a,b)=>b[1]-a[1])[0]?.[0] || '-';
  const bestUnit = Object.entries(unitMap).sort((a,b)=>b[1]-a[1])[0]?.[0] || '-';
  return { doneCount: done.length, revenue, duration, best, bestUnit, average: done.length ? Math.round(revenue/done.length) : 0 };
}
function getReportRange(){
  const today = todayKey();
  if (reportMode === '7days') return { start: todayKey(addDays(new Date(), -6)), end: today, title: '7 Hari Terakhir' };
  if (reportMode === 'month') return { start: todayKey(addDays(new Date(), -29)), end: today, title: '1 Bulan Terakhir' };
  if (reportMode === 'custom') return { start: customStart || today, end: customEnd || today, title: 'Custom' };
  return { start: today, end: today, title: 'Hari Ini' };
}

function toast(msg){
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2600);
}

function syncUrl(){ return String(state.settings.syncUrl || '').trim(); }
function canSync(){ return Boolean(state.settings.syncEnabled && syncUrl()); }
function syncStamp(){ return new Date().toLocaleString('id-ID', { timeZone: WIB_TZ, dateStyle:'short', timeStyle:'medium' }); }
function setSyncStatus(text){ state.settings.syncStatus = text; state.settings.lastSyncAt = syncStamp(); persistWithoutTouch(); }
function cleanStateForSync(){
  return JSON.parse(JSON.stringify({
    day: state.day,
    packages: state.packages,
    units: state.units,
    sessions: state.sessions,
    activeSessions: state.activeSessions,
    settings: state.settings,
    updatedAt: state.updatedAt || Date.now()
  }));
}
function replaceStateFromRemote(remote){
  if (!remote || typeof remote !== 'object') return false;
  const merged = migrateState(remote);
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, merged);
  syncUnitStatuses(state, false);
  persistWithoutTouch();
  render();
  return true;
}
function scheduleSyncPush(){
  if (!canSync()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(()=>syncPush(false), 700);
}
async function syncPush(showToast = true){
  if (!canSync()) { if (showToast) toast('Aktifkan Google Sync dan isi URL Apps Script dulu.'); return; }
  if (syncBusy) return;
  syncBusy = true;
  try {
    const payload = { action:'push', device: state.settings.syncDeviceName || 'Owner', updatedAt: state.updatedAt || Date.now(), state: cleanStateForSync() };
    const res = await fetch(syncUrl(), { method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(()=>({ ok: res.ok }));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    setSyncStatus(`Tersimpan ke Google Sync oleh ${payload.device}`);
    if (showToast) toast('Data berhasil dikirim ke Google Sync.');
  } catch (err) {
    setSyncStatus(`Sync gagal: ${err.message}`);
    if (showToast) toast('Google Sync gagal. Cek URL/izin Apps Script.');
  } finally { syncBusy = false; }
}
async function syncPull(showToast = true){
  if (!canSync()) { if (showToast) toast('Aktifkan Google Sync dan isi URL Apps Script dulu.'); return; }
  if (syncBusy) return;
  syncBusy = true;
  try {
    const url = syncUrl() + (syncUrl().includes('?') ? '&' : '?') + 'action=pull&t=' + Date.now();
    const res = await fetch(url, { method:'GET', cache:'no-store' });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    const remoteState = data.state;
    const remoteUpdated = Number(data.updatedAt || remoteState?.updatedAt || 0);
    const localUpdated = Number(state.updatedAt || 0);
    if (remoteState && remoteUpdated > localUpdated) {
      replaceStateFromRemote(remoteState);
      setSyncStatus('Data terbaru ditarik dari Google Sync');
      if (showToast) toast('Data terbaru berhasil ditarik.');
    } else {
      setSyncStatus('Data lokal sudah paling baru');
      if (showToast) toast('Data lokal sudah paling baru.');
    }
  } catch (err) {
    setSyncStatus(`Sync gagal: ${err.message}`);
    if (showToast) toast('Tarik data gagal. Cek URL/izin Apps Script.');
  } finally { syncBusy = false; }
}
async function syncNow(){ await syncPush(true); await syncPull(false); render(); }
function beep(){
  if (!state.settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    setTimeout(()=>{ osc.stop(); ctx.close(); }, 450);
  } catch {}
}

function startSession(pkg, unitId){
  ensureDay(); syncUnitStatuses(state, false);
  if (state.settings.enforceHours && !isOperatingNow()) return toast(`Di luar jam operasional (${state.settings.openTime}-${state.settings.closeTime}). Ubah di Setting jika perlu.`);
  const unit = unitById(unitId);
  if (!unit) return toast('Pilih unit RC dulu.');
  if (unit.status === 'broken') return toast(`${unit.name} sedang rusak, tidak bisa dipakai.`);
  if (activeForUnit(unitId)) return toast(`${unit.name} masih dipakai. Selesaikan dulu.`);
  const now = Date.now();
  const session = {
    id: uid(), date: todayKey(), packageId: pkg.id, packageName: pkg.name,
    unitId: unit.id, unitName: unit.name, unitType: unit.type,
    minutes: Number(pkg.minutes), price: Number(pkg.price), baseMinutes: Number(pkg.minutes),
    startedAt: now, endsAt: now + Number(pkg.minutes)*60*1000, pausedAt: null, totalPausedMs: 0, status: 'active', note: '', notified: false
  };
  state.activeSessions.unshift(session);
  syncUnitStatuses(state, false);
  saveState();
  currentTab = 'dashboard';
  render();
  toast(`${pkg.name} dimulai di ${unit.name}: ${pkg.minutes} menit.`);
}
function pauseSession(id){
  const s = state.activeSessions.find(x => x.id === id);
  if (!s || s.status !== 'active') return;
  s.status = 'paused';
  s.pausedAt = Date.now();
  saveState(); render();
}
function resumeSession(id){
  const s = state.activeSessions.find(x => x.id === id);
  if (!s || s.status !== 'paused') return;
  const pausedMs = Date.now() - s.pausedAt;
  s.totalPausedMs += pausedMs;
  s.endsAt += pausedMs;
  s.pausedAt = null;
  s.status = 'active';
  saveState(); render();
}
function addMinutes(id, min){
  const s = state.activeSessions.find(x => x.id === id);
  if (!s) return;
  s.endsAt += min*60*1000;
  s.minutes += min;
  saveState(); render(); toast(`Tambah waktu ${min} menit untuk ${s.unitName}.`);
}
function finishSession(id){
  const idx = state.activeSessions.findIndex(x => x.id === id);
  if (idx < 0) return;
  const s = state.activeSessions[idx];
  s.finishedAt = Date.now();
  s.status = 'done';
  state.sessions.unshift(s);
  state.activeSessions.splice(idx, 1);
  syncUnitStatuses(state, false);
  saveState(); currentTab = 'dashboard'; render(); toast(`${s.unitName} selesai. Cash masuk laporan.`);
}
function cancelSession(id){
  const idx = state.activeSessions.findIndex(x => x.id === id);
  if (idx < 0) return;
  const s = state.activeSessions[idx];
  s.finishedAt = Date.now();
  s.status = 'cancelled';
  state.sessions.unshift(s);
  state.activeSessions.splice(idx, 1);
  syncUnitStatuses(state, false);
  saveState(); currentTab = 'dashboard'; render(); toast(`Sesi ${s.unitName} dibatalkan.`);
}

function updatePackage(id, field, value){
  const pkg = state.packages.find(p=>p.id===id); if(!pkg) return;
  pkg[field] = field === 'price' || field === 'minutes' ? Number(value) : value;
  saveState(); render();
}
function setUnitStatus(id, status){
  const unit = unitById(id); if (!unit) return;
  if (activeForUnit(id) && status !== 'in_use') return toast('Unit masih dipakai. Selesaikan sesi dulu.');
  unit.status = status;
  saveState(); render();
}
function updateUnit(id, field, value){
  const unit = unitById(id); if (!unit) return;
  unit[field] = value;
  saveState(); render();
}
function addUnit(){
  const name = document.querySelector('#newUnitName')?.value?.trim();
  const type = document.querySelector('#newUnitType')?.value?.trim() || 'RC';
  if (!name) return toast('Nama unit wajib diisi.');
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') + '-' + uid().slice(0,4);
  state.units.push({ id, name, type, status: 'available', note: '' });
  saveState(); render(); toast(`${name} ditambahkan.`);
}
function deleteUnit(id){
  const unit = unitById(id); if (!unit) return;
  if (activeForUnit(id)) return toast('Unit masih dipakai. Selesaikan sesi dulu.');
  if (!confirm(`Hapus unit ${unit.name}?`)) return;
  state.units = state.units.filter(u => u.id !== id);
  saveState(); render(); toast('Unit dihapus.');
}
function updateSetting(field, value){
  if (field === 'sound' || field === 'enforceHours' || field === 'syncEnabled') state.settings[field] = Boolean(value);
  else state.settings[field] = value;
  saveState(); render();
}
function saveSettingsFromForm(){
  const val = id => document.querySelector(id)?.value;
  const checked = id => Boolean(document.querySelector(id)?.checked);
  state.settings.businessName = val('#setBusinessName') || 'SATSET PLAYZONE';
  state.settings.profileText = val('#setProfileText') || 'Owner control · Multi unit RC · Cash only';
  state.settings.logoText = val('#setLogoText') || 'SP';
  state.settings.operationMode = val('#setOperationMode') || 'auto';
  state.settings.openTime = val('#setOpenTime') || '09:00';
  state.settings.closeTime = val('#setCloseTime') || '21:00';
  state.settings.enforceHours = checked('#setEnforceHours');
  state.settings.sound = checked('#setSound');
  state.settings.syncEnabled = checked('#setSyncEnabled');
  state.settings.syncUrl = val('#setSyncUrl') || '';
  state.settings.syncDeviceName = val('#setSyncDeviceName') || 'Owner';
  saveState(); render(); toast('Setting berhasil disimpan.');
}
function exportCSV(){
  const range = getReportRange();
  const rows = [['Tanggal','Unit','Jenis Unit','Paket','Durasi Menit','Harga Cash','Mulai','Selesai','Status','Catatan']];
  sessionsBetween(range.start, range.end).forEach(s => rows.push([s.date,s.unitName||'',s.unitType||'',s.packageName,s.minutes,s.price,dateTime(s.startedAt),dateTime(s.finishedAt),s.status,s.note||'']));
  const csv = rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `satset-playzone-report-${range.start}-${range.end}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function uploadLogo(input){
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('File logo harus gambar.');
  const reader = new FileReader();
  reader.onload = () => {
    state.settings.logoImage = reader.result;
    saveState(); render(); toast('Logo berhasil diganti.');
  };
  reader.readAsDataURL(file);
}
function clearLogo(){
  state.settings.logoImage = '';
  saveState(); render(); toast('Logo gambar dihapus.');
}

function resetData(){
  if (!confirm('Hapus semua data lokal SATSET PLAYZONE?')) return;
  localStorage.removeItem(STORAGE_KEY); location.reload();
}

function timerRemaining(s){
  if (!s) return { ms:0, total:0, pct:0, done:false };
  const now = s.status === 'paused' ? s.pausedAt : Date.now();
  const total = Math.max(1, s.minutes * 60 * 1000);
  const ms = Math.max(0, s.endsAt - now);
  const pct = Math.min(100, Math.max(0, ((total-ms)/total)*100));
  return { ms, total, pct, done: ms <= 0 };
}
function fmtTimer(ms){
  const sec = Math.ceil(ms/1000);
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = (sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

function renderShell(content){
  ensureDay(); syncUnitStatuses(state, false);
  const open = isOperatingNow();
  document.querySelector('#app').innerHTML = `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <div class="logo">${brandLogoHtml()}</div>
          <div><h1>${esc(state.settings.businessName || 'SATSET PLAYZONE')}</h1><p>${esc(state.settings.profileText || 'Owner control · Multi unit RC · Cash only')}</p></div>
          <div class="status-pill ${open ? 'open' : ''}">${operatingLabel()}</div>
        </div>
      </header>
      ${content}
      <nav class="bottom-nav nav-five">
        ${navButton('dashboard','Beranda')}${navButton('units','Unit')}${navButton('packages','Paket')}${navButton('history','Riwayat')}${navButton('settings','Setting')}
      </nav>
      <div id="toast" class="toast"></div>
    </main>`;
}
function navButton(tab,label){ return `<button class="nav-btn ${currentTab===tab?'active':''}" onclick="go('${tab}')">${label}</button>`; }
window.go = tab => { currentTab = tab; render(); };

function dashboardView(){
  const available = state.units.filter(u => u.status === 'available').length;
  const broken = state.units.filter(u => u.status === 'broken').length;
  return `
    <section class="section-title first-title"><h3>Status Unit</h3><span>${available}/${state.units.length} tersedia · ${broken} rusak</span></section>
    <div class="unit-strip">${state.units.map(unitMini).join('')}</div>
    <section class="section-title"><h3>Mulai Rental</h3><span>Pilih unit + paket</span></section>
    ${startRentalPanel()}
    <section class="section-title"><h3>Timer Aktif</h3><span>${state.activeSessions.length} berjalan</span></section>
    ${dashboardTimers()}
  `;
}
function unitMini(u){ return `<button class="unit-mini ${statusClass(u.status)}" onclick="go('units')"><strong>${esc(u.name)}</strong><small>${statusLabel(u.status)}</small></button>`; }
function startRentalPanel(){
  const units = availableUnits();
  if (!units.length) return `<div class="empty">Tidak ada unit tersedia. Cek menu Unit atau selesaikan sesi aktif.</div>`;
  return `<div class="start-panel card">
    <div class="field"><label>Pilih Unit RC</label><select id="unitSelect">${units.map(u=>`<option value="${u.id}">${esc(u.name)} · ${esc(u.type)}</option>`).join('')}</select></div>
    <div class="grid packages compact-packages">${state.packages.map(packageCard).join('')}</div>
  </div>`;
}
function packageCard(p){
  return `<button class="card package compact-package" onclick='startPackageFromSelect(${JSON.stringify(p)})'>${p.badge?`<span class="badge">${esc(p.badge)}</span>`:''}<h4>${esc(p.name)}</h4><div class="price">${rupiah(p.price).replace('Rp','Rp ')}</div><div class="duration">${p.minutes} menit</div></button>`;
}
function startPackageFromSelect(pkg){
  const select = document.querySelector('#unitSelect');
  const unitId = select?.value;
  startSession(pkg, unitId);
}
function dashboardTimers(){
  if (!state.activeSessions.length) return `<div class="empty">Belum ada timer aktif. Mulai rental dari panel di atas.</div>`;
  return `<div class="list compact-timer-list">${state.activeSessions.map(timerCard).join('')}</div>`;
}
function timerCard(s){
  const t = timerRemaining(s);
  if (t.done && s.status === 'active' && !s.notified) { s.notified = true; saveState(); setTimeout(()=>{ beep(); toast(`${s.unitName}: waktu habis. Terima cash lalu selesaikan sesi.`); render(); }, 50); }
  return `<section class="card timer-card compact-timer">
    <div class="timer-head"><div><strong>${esc(s.unitName)}</strong><small>${esc(s.packageName)} · ${rupiah(s.price)} cash</small></div><div class="timer-mini-display">${fmtTimer(t.ms)}</div></div>
    <div class="progress"><span style="width:${t.pct}%"></span></div>
    <div class="timer-status-row"><span>${s.status === 'paused' ? 'Pause' : t.done ? 'Waktu habis' : 'Berjalan'}</span><span>${s.minutes} menit</span></div>
    <div class="controls compact-controls"><button class="btn ghost" onclick="${s.status==='paused'?`resumeSession('${s.id}')`:`pauseSession('${s.id}')`}">${s.status==='paused'?'Lanjut':'Pause'}</button><button class="btn primary" onclick="addMinutes('${s.id}',5)">+5</button><button class="btn green" onclick="finishSession('${s.id}')">Cash</button><button class="btn red" onclick="cancelSession('${s.id}')">Batal</button></div>
  </section>`;
}
function unitsView(){
  syncUnitStatuses(state, false);
  return `<section class="card hero"><h2>Manajemen Unit RC</h2><p>Edit, tambah, dan atur status unit tanpa deploy ulang. Unit aktif otomatis jadi Dipakai.</p></section>
  <section class="section-title"><h3>Tambah Unit</h3><span>fleksibel</span></section>
  <div class="card start-panel"><div class="field"><label>Nama Unit</label><input id="newUnitName" placeholder="Contoh: Excavator 3"></div><div class="field"><label>Jenis Unit</label><input id="newUnitType" placeholder="Contoh: Excavator / Dump Truck / Loader"></div><button class="btn primary full" onclick="addUnit()">Tambah Unit</button></div>
  <section class="section-title"><h3>Daftar Unit</h3><span>${state.units.length} unit</span></section><div class="list">${state.units.map(u=>`<div class="item unit-item"><div class="row"><div><strong>${esc(u.name)}</strong><small>${esc(u.type)} · ${statusLabel(u.status)}</small></div><span class="status-pill ${statusClass(u.status)}">${statusLabel(u.status)}</span></div><div class="row"><div class="field" style="flex:1"><label>Nama</label><input value="${esc(u.name)}" onchange="updateUnit('${u.id}','name',this.value)"></div><div class="field" style="flex:1"><label>Jenis</label><input value="${esc(u.type)}" onchange="updateUnit('${u.id}','type',this.value)"></div></div><div class="row unit-actions"><button class="btn green" onclick="setUnitStatus('${u.id}','available')">Tersedia</button><button class="btn ghost" onclick="setUnitStatus('${u.id}','in_use')">Dipakai</button><button class="btn red" onclick="setUnitStatus('${u.id}','broken')">Rusak</button></div><div class="field"><label>Catatan unit</label><input value="${esc(u.note || '')}" onchange="updateUnit('${u.id}','note',this.value)" placeholder="Contoh: baterai lemah, rantai dicek..."></div><button class="btn ghost full" onclick="deleteUnit('${u.id}')">Hapus Unit</button></div>`).join('')}</div>`;
}
function packagesView(){
  return `<section class="card hero"><h2>Paket Harga</h2><p>Default: 5K/5m, 10K/15m, 15K/25m, 20K/35m. Paket 10K tetap rekomendasi utama.</p></section><section class="section-title"><h3>Edit Paket</h3><span>tersimpan lokal</span></section><div class="list">${state.packages.map(p=>`<div class="item"><div class="field"><label>Nama Paket</label><input value="${esc(p.name)}" onchange="updatePackage('${p.id}','name',this.value)"></div><div class="row"><div class="field" style="flex:1"><label>Durasi menit</label><input type="number" value="${p.minutes}" onchange="updatePackage('${p.id}','minutes',this.value)"></div><div class="field" style="flex:1"><label>Harga cash</label><input type="number" value="${p.price}" onchange="updatePackage('${p.id}','price',this.value)"></div></div><div class="field"><label>Badge</label><input value="${esc(p.badge||'')}" onchange="updatePackage('${p.id}','badge',this.value)"></div></div>`).join('')}</div>`;
}
function historyView(){
  const list = state.sessions.slice(0,100);
  return `<section class="section-title"><h3>Riwayat Sesi</h3><span>${state.sessions.length} data</span></section><div class="list">${list.length ? list.map(s=>`<div class="item"><strong>${esc(s.unitName || '-')} · ${esc(s.packageName)} · ${rupiah(s.price)}</strong><small>${dateTime(s.startedAt)} → ${dateTime(s.finishedAt)}<br>${s.minutes} menit · Status: ${s.status === 'done' ? 'Selesai / cash diterima' : 'Batal'}</small></div>`).join('') : '<div class="empty">Belum ada riwayat sesi.</div>'}</div>`;
}
function reportView(){
  const range = getReportRange();
  const list = sessionsBetween(range.start, range.end);
  const r = calcReport(list);
  return `<section class="card hero"><h2>Laporan ${range.title}</h2><p>Periode: ${dateRangeLabel(range.start, range.end)}. Omset dipindahkan ke menu laporan agar Beranda fokus operasional.</p></section>
  <div class="report-tabs"><button class="btn ${reportMode==='today'?'primary':'ghost'}" onclick="setReportMode('today')">Hari Ini</button><button class="btn ${reportMode==='7days'?'primary':'ghost'}" onclick="setReportMode('7days')">7 Hari</button><button class="btn ${reportMode==='month'?'primary':'ghost'}" onclick="setReportMode('month')">1 Bulan</button><button class="btn ${reportMode==='custom'?'primary':'ghost'}" onclick="setReportMode('custom')">Custom</button></div>
  ${reportMode==='custom'?`<div class="card start-panel"><div class="row"><div class="field" style="flex:1"><label>Dari</label><input type="date" value="${customStart}" onchange="customStart=this.value;render()"></div><div class="field" style="flex:1"><label>Sampai</label><input type="date" value="${customEnd}" onchange="customEnd=this.value;render()"></div></div></div>`:''}
  <section class="grid stats" style="margin-top:12px"><div class="card metric"><small>Total Cash</small><strong>${rupiah(r.revenue)}</strong><div class="sub">Semua transaksi cash</div></div><div class="card metric"><small>Total Sesi</small><strong>${r.doneCount}</strong><div class="sub">Sesi selesai</div></div><div class="card metric"><small>Total Durasi</small><strong>${r.duration}m</strong><div class="sub">Akumulasi main</div></div><div class="card metric"><small>Rata-rata</small><strong>${rupiah(r.average)}</strong><div class="sub">Per sesi</div></div></section>
  <section class="grid stats" style="margin-top:12px"><div class="card metric"><small>Top Unit</small><strong>${esc(r.bestUnit)}</strong><div class="sub">Paling sering dipakai</div></div><div class="card metric"><small>Paket Terlaris</small><strong>${esc(r.best)}</strong><div class="sub">Periode ini</div></div></section>
  <section class="section-title"><h3>Export</h3><span>${list.length} sesi</span></section><button class="btn primary full" onclick="exportCSV()">Export CSV Periode Ini</button>`;
}
function settingsView(){
  const range = getReportRange();
  const list = sessionsBetween(range.start, range.end);
  const r = calcReport(list);
  return `<section class="card hero"><h2>Setting & Privasi</h2><p>Simpan setting wajib dipencet setelah ubah jam, mode buka/tutup, profil, logo, atau Google Sync.</p></section>
  <section class="section-title"><h3>Profil Aplikasi</h3><span>logo & nama</span></section>
  <div class="card start-panel">
    <div class="row profile-row"><div class="logo logo-preview">${brandLogoHtml()}</div><div style="flex:1"><strong>${esc(state.settings.businessName || 'SATSET PLAYZONE')}</strong><small>${esc(state.settings.profileText || '')}</small></div></div>
    <div class="field"><label>Nama aplikasi</label><input id="setBusinessName" value="${esc(state.settings.businessName)}" placeholder="SATSET PLAYZONE"></div>
    <div class="field"><label>Profil / tagline kecil</label><input id="setProfileText" value="${esc(state.settings.profileText)}" placeholder="Owner control · Multi unit RC · Cash only"></div>
    <div class="field"><label>Teks logo jika tanpa gambar</label><input id="setLogoText" maxlength="4" value="${esc(state.settings.logoText)}" placeholder="SP"></div>
    <div class="field"><label>Upload logo gambar</label><input type="file" accept="image/*" onchange="uploadLogo(this)"></div>
    <button class="btn ghost full" onclick="clearLogo()">Hapus Logo Gambar</button>
  </div>

  <section class="section-title"><h3>Buka / Tutup</h3><span>${operatingLabel()} · WIB</span></section>
  <div class="card start-panel">
    <div class="field"><label>Mode operasional</label><select id="setOperationMode">
      <option value="auto" ${state.settings.operationMode==='auto'?'selected':''}>Otomatis sesuai jam WIB</option>
      <option value="manual_open" ${state.settings.operationMode==='manual_open'?'selected':''}>Manual buka</option>
      <option value="manual_closed" ${state.settings.operationMode==='manual_closed'?'selected':''}>Manual tutup / cuti</option>
    </select></div>
    <div class="row"><div class="field" style="flex:1"><label>Jam Buka WIB</label><input id="setOpenTime" type="time" value="${esc(state.settings.openTime)}"></div><div class="field" style="flex:1"><label>Jam Tutup WIB</label><input id="setCloseTime" type="time" value="${esc(state.settings.closeTime)}"></div></div>
    <label class="toggle-row"><input id="setEnforceHours" type="checkbox" ${state.settings.enforceHours?'checked':''}><span>Blok mulai rental saat status TUTUP</span></label>
    <label class="toggle-row"><input id="setSound" type="checkbox" ${state.settings.sound?'checked':''}><span>Suara alert timer habis</span></label>
    <div class="privacy-note">Tanggal laporan memakai WIB. Saat masuk hari baru, omset Hari Ini otomatis kembali Rp 0, tapi data kemarin tetap bisa dicek di laporan 7 hari / custom.</div>
  </div>

  <section class="section-title"><h3>Google Sync Data</h3><span>owner + bini</span></section>
  <div class="card start-panel sync-panel">
    <label class="toggle-row"><input id="setSyncEnabled" type="checkbox" ${state.settings.syncEnabled?'checked':''}><span>Aktifkan Google Sync realtime</span></label>
    <div class="field"><label>Nama device</label><input id="setSyncDeviceName" value="${esc(state.settings.syncDeviceName || 'Owner 1')}" placeholder="Contoh: HP Owner / HP Bini"></div>
    <div class="field"><label>URL Web App Google Apps Script</label><input id="setSyncUrl" value="${esc(state.settings.syncUrl || '')}" placeholder="https://script.google.com/macros/s/.../exec"></div>
    <div class="privacy-note">Sync menarik/mengirim data unit aktif, status RC, paket, riwayat, dan laporan. Auto sync berjalan tiap 15 detik saat aktif.</div>
    <div class="row unit-actions"><button class="btn primary" onclick="saveSettingsFromForm()">Simpan Setting</button><button class="btn green" onclick="syncNow()">Sync Sekarang</button><button class="btn ghost" onclick="syncPull(true)">Tarik Data</button></div>
    <small class="sync-status">Status: ${esc(state.settings.syncStatus || 'Belum aktif')} ${state.settings.lastSyncAt ? '· ' + esc(state.settings.lastSyncAt) : ''}</small>
  </div>

  <section class="section-title"><h3>Laporan Privat</h3><span>di dalam setting</span></section>
  <details class="card private-report"><summary>Lihat laporan omset</summary>
    <div class="report-tabs"><button class="btn ${reportMode==='today'?'primary':'ghost'}" onclick="setReportMode('today')">Hari Ini</button><button class="btn ${reportMode==='7days'?'primary':'ghost'}" onclick="setReportMode('7days')">7 Hari</button><button class="btn ${reportMode==='month'?'primary':'ghost'}" onclick="setReportMode('month')">1 Bulan</button><button class="btn ${reportMode==='custom'?'primary':'ghost'}" onclick="setReportMode('custom')">Custom</button></div>
    ${reportMode==='custom'?`<div class="row"><div class="field" style="flex:1"><label>Dari</label><input type="date" value="${customStart}" onchange="customStart=this.value;render()"></div><div class="field" style="flex:1"><label>Sampai</label><input type="date" value="${customEnd}" onchange="customEnd=this.value;render()"></div></div>`:''}
    <div class="privacy-note">Periode WIB: ${dateRangeLabel(range.start, range.end)}</div>
    <section class="grid stats private-stats"><div class="card metric"><small>Total Cash</small><strong>${rupiah(r.revenue)}</strong><div class="sub">${r.doneCount} sesi</div></div><div class="card metric"><small>Total Durasi</small><strong>${r.duration}m</strong><div class="sub">Top: ${esc(r.bestUnit)}</div></div></section>
    <section class="grid stats private-stats"><div class="card metric"><small>Rata-rata</small><strong>${rupiah(r.average)}</strong><div class="sub">Per sesi</div></div><div class="card metric"><small>Paket Laris</small><strong>${esc(r.best)}</strong><div class="sub">Periode ini</div></div></section>
    <button class="btn primary full" onclick="exportCSV()">Export CSV Periode Ini</button>
  </details>

  <button class="btn primary full sticky-save" onclick="saveSettingsFromForm()">Simpan Semua Setting</button>
  <section class="section-title"><h3>Data Lokal</h3><span>device ini</span></section><div class="grid"><button class="btn red full" onclick="resetData()">Reset Semua Data</button></div>`;
}
function setReportMode(mode){ reportMode = mode; render(); }

function render(){
  ensureDay(); syncUnitStatuses(state, false);
  const views = { dashboard:dashboardView, units:unitsView, packages:packagesView, history:historyView, settings:settingsView };
  renderShell((views[currentTab] || dashboardView)());
}
window.startSession = startSession; window.startPackageFromSelect = startPackageFromSelect; window.pauseSession = pauseSession; window.resumeSession = resumeSession; window.addMinutes = addMinutes; window.finishSession = finishSession; window.cancelSession = cancelSession; window.updatePackage = updatePackage; window.setUnitStatus = setUnitStatus; window.updateUnit = updateUnit; window.addUnit = addUnit; window.deleteUnit = deleteUnit; window.updateSetting = updateSetting; window.uploadLogo = uploadLogo; window.saveSettingsFromForm = saveSettingsFromForm; window.syncNow = syncNow; window.syncPull = syncPull; window.syncPush = syncPush; window.clearLogo = clearLogo; window.exportCSV = exportCSV; window.resetData = resetData; window.setReportMode = setReportMode;

setInterval(()=>{ if (state.activeSessions.length) render(); }, 1000);
setInterval(()=>{ if (canSync()) syncPull(false); }, SYNC_INTERVAL_MS);
ensureDay(); syncUnitStatuses(state, true);

// Mobile-first: prevent accidental pinch zoom / double tap zoom in owner app.
document.addEventListener('touchmove', (event) => { if (event.touches && event.touches.length > 1) event.preventDefault(); }, { passive:false });
document.addEventListener('gesturestart', (event) => event.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', (event) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) event.preventDefault();
  lastTouchEnd = now;
}, { passive:false });
if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
render();
