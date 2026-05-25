const STORAGE_KEY = 'satset_playzone_v1_state';
const WIB_TZ = 'Asia/Jakarta';
const SYNC_INTERVAL_MS = 15000;
let syncBusy = false;
let syncTimer = null;
const finishingIds = new Set();

const DEFAULT_PACKAGES = [
  { id: 'try', name: 'Coba Dulu', minutes: 5, price: 5000, badge: 'Entry' },
  { id: 'seru', name: 'Paket Seru', minutes: 15, price: 10000, badge: 'Rekomendasi' },
  { id: 'puas', name: 'Paket Puas', minutes: 25, price: 15000, badge: 'Upsell' },
  { id: 'lama', name: 'Main Lama', minutes: 35, price: 20000, badge: 'Hemat' }
];
const DEFAULT_UNITS = [
  { id: 'excavator-1', name: 'Excavator 1', type: 'Excavator', status: 'available', note: '', maintenanceCost: 0, maintenanceLog: [] },
  { id: 'excavator-2', name: 'Excavator 2', type: 'Excavator', status: 'available', note: '', maintenanceCost: 0, maintenanceLog: [] },
  { id: 'dump-truck-1', name: 'Dump Truck 1', type: 'Dump Truck', status: 'available', note: '', maintenanceCost: 0, maintenanceLog: [] },
  { id: 'loader-1', name: 'Loader 1', type: 'Loader', status: 'available', note: '', maintenanceCost: 0, maintenanceLog: [] }
];

const state = migrateState(loadState());
let currentTab = 'dashboard';
let reportMode = 'today';
let historyMode = 'today';
let customStart = todayKey();
let customEnd = todayKey();
let historyUnitFilter = 'all';
let historyStatusFilter = 'all';
let ownerUnlocked = sessionStorage.getItem('satset_playzone_owner_unlocked') === 'yes';

function todayKey(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: WIB_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(date); }
function rupiah(n) { return new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(n || 0)); }
function timeOnly(ts) { return ts ? new Date(ts).toLocaleTimeString('id-ID', { timeZone: WIB_TZ, hour:'2-digit', minute:'2-digit' }) : '-'; }
function dateTime(ts) { return ts ? new Date(ts).toLocaleString('id-ID', { timeZone: WIB_TZ, dateStyle:'medium', timeStyle:'short' }) : '-'; }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toMinutes(str){ const [h,m] = String(str || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function addDays(date, days){ const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function dateRangeLabel(start, end){ return start === end ? start : `${start} s/d ${end}`; }
function hashPin(pin){ return btoa(unescape(encodeURIComponent(String(pin || '').trim()))).split('').reverse().join(''); }
function hasPin(){ return Boolean(state.security?.pinHash); }
function isOwner(){ return state.settings.deviceMode === 'owner' && ownerUnlocked; }
function isViewer(){ return !isOwner(); }
function canOperate(){ return isOwner(); }

function loadState(){
  const fallback = {
    day: null,
    packages: DEFAULT_PACKAGES,
    units: DEFAULT_UNITS,
    sessions: [],
    activeSessions: [],
    completedIds: [],
    settings: {
      ownerName: 'Owner', sound: true, openTime: '09:00', closeTime: '21:00', enforceHours: false,
      operationMode: 'auto', businessName: 'SATSET PLAYZONE', profileText: 'Multi unit RC · Cash only',
      logoText: 'SP', logoImage: '', syncEnabled: false, syncUrl: '', syncDeviceName: 'Owner 1',
      lastSyncAt: '', syncStatus: 'Belum aktif', deviceMode: 'viewer'
    },
    security: { pinHash: '' },
    updatedAt: Date.now()
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed, settings: { ...fallback.settings, ...(parsed.settings || {}) }, security: { ...fallback.security, ...(parsed.security || {}) } };
  } catch { return fallback; }
}
function migrateState(s){
  s.packages = s.packages?.length ? s.packages : DEFAULT_PACKAGES;
  s.units = (s.units?.length ? s.units : DEFAULT_UNITS).map(u => ({ maintenanceCost: 0, maintenanceLog: [], ...u }));
  s.sessions = Array.isArray(s.sessions) ? s.sessions : [];
  s.activeSessions = Array.isArray(s.activeSessions) ? s.activeSessions : [];
  if (s.activeSession) { s.activeSessions.unshift(s.activeSession); s.activeSession = null; }
  s.completedIds = Array.isArray(s.completedIds) ? s.completedIds : s.sessions.filter(x=>x.status==='done').map(x=>x.id).filter(Boolean);
  s.settings = { ownerName: 'Owner', sound: true, openTime: '09:00', closeTime: '21:00', enforceHours: false, operationMode: 'auto', businessName: 'SATSET PLAYZONE', profileText: 'Multi unit RC · Cash only', logoText: 'SP', logoImage: '', syncEnabled: false, syncUrl: '', syncDeviceName: 'Owner 1', lastSyncAt: '', syncStatus: 'Belum aktif', deviceMode: s.settings?.deviceMode || 'viewer', ...(s.settings || {}) };
  if (s.settings.profileText && s.settings.profileText.includes('Owner control')) s.settings.profileText = 'Multi unit RC · Cash only';
  s.security = { pinHash: '', ...(s.security || {}) };
  if (s.settings.pin) delete s.settings.pin;
  s.updatedAt = Number(s.updatedAt || Date.now());
  syncUnitStatuses(s, false);
  return s;
}
function saveState(options = {}){ const shouldPush = options.push !== false; state.updatedAt = Date.now(); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); if (shouldPush) scheduleSyncPush(); }
function persistWithoutTouch(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function ensureDay(){ if (!state.day || state.day.date !== todayKey()) { state.day = { date: todayKey(), openedAt: null, closedAt: null }; saveState({push:false}); } }

function isWithinOperatingHours(){
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: WIB_TZ, hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date());
  const h = Number(parts.find(p=>p.type==='hour')?.value || 0); const m = Number(parts.find(p=>p.type==='minute')?.value || 0);
  const current = h*60 + m; const open = toMinutes(state.settings.openTime); const close = toMinutes(state.settings.closeTime);
  if (open === close) return true; if (open < close) return current >= open && current < close; return current >= open || current < close;
}
function isOperatingNow(){ if (state.settings.operationMode === 'manual_open') return true; if (state.settings.operationMode === 'manual_closed') return false; return isWithinOperatingHours(); }
function operatingLabel(){ if (state.settings.operationMode === 'manual_open') return 'BUKA'; if (state.settings.operationMode === 'manual_closed') return 'TUTUP'; return isOperatingNow() ? 'BUKA' : 'TUTUP'; }
function brandLogoHtml(){ if (state.settings.logoImage) return `<img src="${esc(state.settings.logoImage)}" alt="Logo" />`; return esc(state.settings.logoText || 'SP'); }
function activeForUnit(unitId){ return state.activeSessions.find(s => s.unitId === unitId); }
function syncUnitStatuses(target = state, persist = true){
  const activeIds = new Set((target.activeSessions || []).map(s => s.unitId).filter(Boolean));
  target.units = (target.units || DEFAULT_UNITS).map(u => {
    if (u.status !== 'broken' && u.status !== 'service' && activeIds.has(u.id)) return { ...u, status: 'in_use' };
    if (u.status === 'in_use' && !activeIds.has(u.id)) return { ...u, status: 'available' };
    return u;
  });
  if (persist) saveState();
}
function unitById(id){ return state.units.find(u => u.id === id); }
function statusLabel(status){ return status === 'available' ? 'Tersedia' : status === 'in_use' ? 'Dipakai' : status === 'service' ? 'Servis' : 'Rusak'; }
function statusClass(status){ return status === 'available' ? 'open' : status === 'in_use' ? 'busy' : status === 'service' ? 'service' : 'broken'; }
function availableUnits(){ syncUnitStatuses(state, false); return state.units.filter(u => u.status === 'available'); }
function sessionsBetween(start, end, includeCancelled=false){ return state.sessions.filter(s => (includeCancelled || s.status === 'done') && s.date >= start && s.date <= end); }
function todaysSessions(){ return sessionsBetween(todayKey(), todayKey()); }
function maintenanceBetween(start,end){
  return state.units.flatMap(u => (u.maintenanceLog || []).map(m => ({...m, unitName:u.name}))).filter(m => m.date >= start && m.date <= end);
}
function calcReport(list = todaysSessions(), start=todayKey(), end=todayKey()){
  const done = list.filter(s => s.status === 'done');
  const revenue = done.reduce((sum,s)=>sum+Number(s.price||0),0);
  const duration = done.reduce((sum,s)=>sum+Number(s.minutes||0),0);
  const maintenance = maintenanceBetween(start,end).reduce((sum,m)=>sum+Number(m.cost||0),0);
  const packageMap = {}, unitMap = {}, unitRevenue = {};
  done.forEach(s => { packageMap[s.packageName] = (packageMap[s.packageName] || 0) + 1; unitMap[s.unitName || '-'] = (unitMap[s.unitName || '-'] || 0) + 1; unitRevenue[s.unitName || '-'] = (unitRevenue[s.unitName || '-'] || 0) + Number(s.price || 0); });
  const best = Object.entries(packageMap).sort((a,b)=>b[1]-a[1])[0]?.[0] || '-';
  const bestUnit = Object.entries(unitMap).sort((a,b)=>b[1]-a[1])[0]?.[0] || '-';
  return { doneCount: done.length, revenue, duration, best, bestUnit, average: done.length ? Math.round(revenue/done.length) : 0, maintenance, net: revenue - maintenance, unitMap, unitRevenue };
}
function getRangeForMode(mode){ const today = todayKey(); if (mode === 'yesterday') { const y = todayKey(addDays(new Date(), -1)); return { start:y, end:y, title:'Kemarin' }; } if (mode === '7days') return { start: todayKey(addDays(new Date(), -6)), end: today, title: '7 Hari Terakhir' }; if (mode === 'month') return { start: todayKey(addDays(new Date(), -29)), end: today, title: '1 Bulan Terakhir' }; if (mode === 'custom') return { start: customStart || today, end: customEnd || today, title: 'Custom' }; return { start: today, end: today, title: 'Hari Ini' }; }
function getReportRange(){ return getRangeForMode(reportMode); }
function toast(msg){ const el = document.querySelector('#toast'); if (!el) return; el.textContent = msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2600); }
function requireOwner(msg='Masukkan PIN pengelola dulu.'){ if (canOperate()) return true; toast(msg); currentTab='settings'; render(); return false; }

function syncUrl(){ return String(state.settings.syncUrl || '').trim(); }
function canSync(){ return Boolean(state.settings.syncEnabled && syncUrl()); }
function syncStamp(){ return new Date().toLocaleString('id-ID', { timeZone: WIB_TZ, dateStyle:'short', timeStyle:'medium' }); }
function setSyncStatus(text){ state.settings.syncStatus = text; state.settings.lastSyncAt = syncStamp(); persistWithoutTouch(); }
function cleanStateForSync(){ return JSON.parse(JSON.stringify({ day: state.day, packages: state.packages, units: state.units, sessions: state.sessions, activeSessions: state.activeSessions, completedIds: state.completedIds, settings: state.settings, security: state.security, updatedAt: state.updatedAt || Date.now() })); }
function replaceStateFromRemote(remote){ if (!remote || typeof remote !== 'object') return false; const merged = migrateState(remote); Object.keys(state).forEach(k => delete state[k]); Object.assign(state, merged); syncUnitStatuses(state, false); persistWithoutTouch(); render(); return true; }
function scheduleSyncPush(){ if (!canSync()) return; clearTimeout(syncTimer); syncTimer = setTimeout(()=>syncPush(false), 700); }
async function syncPush(showToast = true){
  if (!canSync()) { if (showToast) toast('Aktifkan Google Sync dan isi URL Apps Script dulu.'); return; }
  if (syncBusy) return; syncBusy = true;
  try { const payload = { action:'push', deviceName: state.settings.syncDeviceName || 'Device', updatedAt: state.updatedAt || Date.now(), state: cleanStateForSync() };
    const res = await fetch(syncUrl(), { method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(()=>({ ok: res.ok })); if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    setSyncStatus(`Tersimpan oleh ${payload.deviceName}`); if (showToast) toast('Data berhasil dikirim ke Google Sync.');
  } catch (err) { setSyncStatus(`Sync gagal: ${err.message}`); if (showToast) toast('Google Sync gagal. Cek URL/izin Apps Script.'); } finally { syncBusy = false; }
}
async function syncPull(showToast = true){
  if (!canSync()) { if (showToast) toast('Aktifkan Google Sync dan isi URL Apps Script dulu.'); return; }
  if (syncBusy) return; syncBusy = true;
  try { const url = syncUrl() + (syncUrl().includes('?') ? '&' : '?') + 'action=pull&t=' + Date.now(); const res = await fetch(url, { method:'GET', cache:'no-store' }); const data = await res.json(); if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    const remoteState = data.state; const remoteUpdated = Number(data.updatedAt || remoteState?.updatedAt || 0); const localUpdated = Number(state.updatedAt || 0);
    if (remoteState && remoteUpdated > localUpdated) { replaceStateFromRemote(remoteState); setSyncStatus('Data terbaru ditarik'); if (showToast) toast('Data terbaru berhasil ditarik.'); } else { setSyncStatus('Data lokal sudah paling baru'); if (showToast) toast('Data lokal sudah paling baru.'); }
  } catch (err) { setSyncStatus(`Sync gagal: ${err.message}`); if (showToast) toast('Tarik data gagal.'); } finally { syncBusy = false; }
}
async function syncNow(){ await syncPush(true); await syncPull(false); render(); }
function beep(){ if (!state.settings.sound) return; try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.frequency.value = 880; gain.gain.value = 0.08; osc.connect(gain); gain.connect(ctx.destination); osc.start(); setTimeout(()=>{ osc.stop(); ctx.close(); }, 450); } catch {} }

function startSession(pkg, unitId){
  if (!requireOwner('Mode viewer hanya bisa melihat. Buka akses pengelola dulu.')) return;
  ensureDay(); syncUnitStatuses(state, false);
  if (state.settings.enforceHours && !isOperatingNow()) return toast(`Status TUTUP (${state.settings.openTime}-${state.settings.closeTime} WIB). Ubah di Setting jika perlu.`);
  const unit = unitById(unitId); if (!unit) return toast('Pilih unit RC dulu.');
  if (unit.status === 'broken' || unit.status === 'service') return toast(`${unit.name} sedang ${statusLabel(unit.status).toLowerCase()}, tidak bisa dipakai.`);
  if (activeForUnit(unitId)) return toast(`${unit.name} masih dipakai. Selesaikan dulu.`);
  const now = Date.now(); const session = { id: uid(), date: todayKey(), packageId: pkg.id, packageName: pkg.name, unitId: unit.id, unitName: unit.name, unitType: unit.type, minutes: Number(pkg.minutes), price: Number(pkg.price), baseMinutes: Number(pkg.minutes), startedAt: now, endsAt: now + Number(pkg.minutes)*60*1000, pausedAt: null, totalPausedMs: 0, status: 'active', note: '', notified: false, completed: false };
  state.activeSessions.unshift(session); syncUnitStatuses(state, false); saveState(); currentTab = 'dashboard'; render(); toast(`${pkg.name} dimulai di ${unit.name}: ${pkg.minutes} menit.`);
}
function pauseSession(id){ if(!requireOwner()) return; const s = state.activeSessions.find(x => x.id === id); if (!s || s.status !== 'active') return; s.status = 'paused'; s.pausedAt = Date.now(); saveState(); render(); }
function resumeSession(id){ if(!requireOwner()) return; const s = state.activeSessions.find(x => x.id === id); if (!s || s.status !== 'paused') return; const pausedMs = Date.now() - s.pausedAt; s.totalPausedMs += pausedMs; s.endsAt += pausedMs; s.pausedAt = null; s.status = 'active'; saveState(); render(); }
function addMinutes(id, min){ if(!requireOwner()) return; const s = state.activeSessions.find(x => x.id === id); if (!s) return; s.endsAt += min*60*1000; s.minutes += min; saveState(); render(); toast(`Tambah waktu ${min} menit untuk ${s.unitName}.`); }
function finishSession(id){
  if(!requireOwner()) return; if (finishingIds.has(id) || state.completedIds.includes(id)) return toast('Sesi ini sudah diproses.');
  const idx = state.activeSessions.findIndex(x => x.id === id); if (idx < 0) return; finishingIds.add(id);
  const s = state.activeSessions[idx]; s.finishedAt = Date.now(); s.status = 'done'; s.completed = true;
  state.completedIds.unshift(id); state.completedIds = [...new Set(state.completedIds)].slice(0,1000);
  state.sessions.unshift(s); state.activeSessions.splice(idx, 1); syncUnitStatuses(state, false); saveState(); currentTab = 'dashboard'; render(); toast(`${s.unitName} selesai. Cash masuk laporan.`); setTimeout(()=>finishingIds.delete(id), 1200);
}
function cancelSession(id){ if(!requireOwner()) return; const idx = state.activeSessions.findIndex(x => x.id === id); if (idx < 0) return; const s = state.activeSessions[idx]; s.finishedAt = Date.now(); s.status = 'cancelled'; state.sessions.unshift(s); state.activeSessions.splice(idx, 1); syncUnitStatuses(state, false); saveState(); currentTab = 'dashboard'; render(); toast(`Sesi ${s.unitName} dibatalkan.`); }

function updatePackage(id, field, value){ if(!requireOwner()) return; const pkg = state.packages.find(p=>p.id===id); if(!pkg) return; pkg[field] = field === 'price' || field === 'minutes' ? Number(value) : value; saveState(); render(); }
function setUnitStatus(id, status){ if(!requireOwner()) return; const unit = unitById(id); if (!unit) return; if (activeForUnit(id) && status !== 'in_use') return toast('Unit masih dipakai. Selesaikan sesi dulu.'); unit.status = status; saveState(); render(); }
function updateUnit(id, field, value){ if(!requireOwner()) return; const unit = unitById(id); if (!unit) return; unit[field] = field === 'maintenanceCost' ? Number(value) : value; saveState(); render(); }
function addUnit(){ if(!requireOwner()) return; const name = document.querySelector('#newUnitName')?.value?.trim(); const type = document.querySelector('#newUnitType')?.value?.trim() || 'RC'; if (!name) return toast('Nama unit wajib diisi.'); const id = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') + '-' + uid().slice(0,4); state.units.push({ id, name, type, status: 'available', note: '', maintenanceCost: 0, maintenanceLog: [] }); saveState(); render(); toast(`${name} ditambahkan.`); }
function deleteUnit(id){ if(!requireOwner()) return; const unit = unitById(id); if (!unit) return; if (activeForUnit(id)) return toast('Unit masih dipakai. Selesaikan sesi dulu.'); if (!confirm(`Hapus unit ${unit.name}?`)) return; state.units = state.units.filter(u => u.id !== id); saveState(); render(); toast('Unit dihapus.'); }
function addMaintenance(id){ if(!requireOwner()) return; const unit = unitById(id); if(!unit) return; const cost = Number(document.querySelector(`#mcost-${id}`)?.value || 0); const note = document.querySelector(`#mnote-${id}`)?.value?.trim() || 'Maintenance'; unit.maintenanceLog = unit.maintenanceLog || []; unit.maintenanceLog.unshift({ id: uid(), date: todayKey(), time: Date.now(), cost, note }); unit.maintenanceCost = Number(unit.maintenanceCost || 0) + cost; unit.status = 'service'; saveState(); render(); toast('Catatan maintenance disimpan.'); }

function saveSettingsFromForm(){
  if(!requireOwner()) return;
  const val = id => document.querySelector(id)?.value; const checked = id => Boolean(document.querySelector(id)?.checked);
  state.settings.businessName = val('#setBusinessName') || 'SATSET PLAYZONE'; state.settings.profileText = val('#setProfileText') || 'Multi unit RC · Cash only'; state.settings.logoText = val('#setLogoText') || 'SP'; state.settings.deviceMode = val('#setDeviceMode') || 'viewer'; state.settings.operationMode = val('#setOperationMode') || 'auto'; state.settings.openTime = val('#setOpenTime') || '09:00'; state.settings.closeTime = val('#setCloseTime') || '21:00'; state.settings.enforceHours = checked('#setEnforceHours'); state.settings.sound = checked('#setSound'); state.settings.syncEnabled = checked('#setSyncEnabled'); state.settings.syncUrl = val('#setSyncUrl') || ''; state.settings.syncDeviceName = val('#setSyncDeviceName') || 'Owner'; saveState(); render(); toast('Setting berhasil disimpan.');
}
function setupOrUnlockOwner(){
  const pin = document.querySelector('#ownerPin')?.value?.trim(); const pin2 = document.querySelector('#ownerPin2')?.value?.trim();
  if (!pin || pin.length < 4) return toast('PIN minimal 4 angka/karakter.');
  if (!hasPin()) { if (pin !== pin2) return toast('Konfirmasi PIN belum sama.'); state.security.pinHash = hashPin(pin); state.settings.deviceMode = 'owner'; ownerUnlocked = true; sessionStorage.setItem('satset_playzone_owner_unlocked','yes'); saveState(); render(); toast('PIN pengelola dibuat. Owner mode aktif di device ini.'); return; }
  if (hashPin(pin) !== state.security.pinHash) return toast('PIN salah.'); ownerUnlocked = true; sessionStorage.setItem('satset_playzone_owner_unlocked','yes'); state.settings.deviceMode = 'owner'; saveState(); render(); toast('Akses pengelola terbuka.');
}
function lockOwner(){ ownerUnlocked=false; sessionStorage.removeItem('satset_playzone_owner_unlocked'); state.settings.deviceMode='viewer'; saveState(); render(); toast('Owner mode dikunci/disamarkan.'); }
function changePin(){ if(!requireOwner()) return; const oldPin = document.querySelector('#oldPin')?.value?.trim(); const newPin = document.querySelector('#newPin')?.value?.trim(); const confirmPin = document.querySelector('#confirmPin')?.value?.trim(); if (!newPin || newPin.length < 4) return toast('PIN baru minimal 4 karakter.'); if (hasPin() && hashPin(oldPin) !== state.security.pinHash) return toast('PIN lama salah.'); if (newPin !== confirmPin) return toast('Konfirmasi PIN baru belum sama.'); state.security.pinHash = hashPin(newPin); saveState(); render(); toast('PIN berhasil diganti.'); }

function exportCSV(){ const range = getReportRange(); const rows = [['Tanggal','Unit','Jenis Unit','Paket','Durasi Menit','Harga Cash','Mulai','Selesai','Status','Catatan']]; sessionsBetween(range.start, range.end, true).forEach(s => rows.push([s.date,s.unitName||'',s.unitType||'',s.packageName,s.minutes,s.price,dateTime(s.startedAt),dateTime(s.finishedAt),s.status,s.note||''])); downloadText(rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n'), `satset-playzone-report-${range.start}-${range.end}.csv`, 'text/csv;charset=utf-8'); }
function downloadText(text, filename, type='application/json'){ const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function exportBackup(){ if(!requireOwner()) return; downloadText(JSON.stringify(cleanStateForSync(), null, 2), `satset-playzone-backup-${todayKey()}.json`); }
function importBackup(input){ if(!requireOwner()) return; const file = input.files && input.files[0]; if(!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result); replaceStateFromRemote(data); saveState(); toast('Backup berhasil di-restore.'); } catch { toast('File backup tidak valid.'); } }; reader.readAsText(file); }
function uploadLogo(input){ if(!requireOwner()) return; const file = input.files && input.files[0]; if (!file) return; if (!file.type.startsWith('image/')) return toast('File logo harus gambar.'); const reader = new FileReader(); reader.onload = () => { state.settings.logoImage = reader.result; saveState(); render(); toast('Logo berhasil diganti.'); }; reader.readAsDataURL(file); }
function clearLogo(){ if(!requireOwner()) return; state.settings.logoImage = ''; saveState(); render(); toast('Logo gambar dihapus.'); }
function resetData(){ if(!requireOwner()) return; if (!confirm('Hapus semua data lokal SATSET PLAYZONE?')) return; localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem('satset_playzone_owner_unlocked'); location.reload(); }

function timerRemaining(s){ if (!s) return { ms:0, total:0, pct:0, done:false }; const now = s.status === 'paused' ? s.pausedAt : Date.now(); const total = Math.max(1, s.minutes * 60 * 1000); const ms = Math.max(0, s.endsAt - now); const pct = Math.min(100, Math.max(0, ((total-ms)/total)*100)); return { ms, total, pct, done: ms <= 0 }; }
function fmtTimer(ms){ const sec = Math.ceil(ms/1000); const h = Math.floor(sec/3600); const m = Math.floor((sec%3600)/60).toString().padStart(2,'0'); const s = (sec%60).toString().padStart(2,'0'); return h ? `${h}:${m}:${s}` : `${m}:${s}`; }

function renderShell(content){
  ensureDay(); syncUnitStatuses(state, false); const open = isOperatingNow();
  document.querySelector('#app').innerHTML = `<main class="app"><header class="topbar"><div class="brand"><div class="logo">${brandLogoHtml()}</div><div><h1>${esc(state.settings.businessName || 'SATSET PLAYZONE')}</h1><p>${esc(state.settings.profileText || 'Multi unit RC · Cash only')}</p></div><div class="topbar-private-link"><span class="role-pill ${isOwner()?'owner':'viewer'}">${isOwner()?'Owner':'View'}</span><div class="status-pill ${open ? 'open' : ''}">${operatingLabel()}</div></div></div></header>${content}<nav class="bottom-nav nav-five">${navButton('dashboard','Beranda')}${navButton('units','Unit')}${navButton('packages','Paket')}${navButton('history','Riwayat')}${navButton('settings','Setting')}</nav><div id="toast" class="toast"></div></main>`;
}
function navButton(tab,label){ return `<button class="nav-btn ${currentTab===tab?'active':''}" onclick="go('${tab}')">${label}</button>`; }
window.go = tab => { currentTab = tab; render(); };
function viewerBanner(){ return isOwner() ? '' : `<div class="viewer-banner">Mode lihat aktif. Data unit dan timer bisa dipantau, tapi tombol transaksi dan setting penting dikunci/disamarkan. Buka akses pengelola di menu Setting jika mau mengubah data.</div>`; }
function dashboardView(){ const available = state.units.filter(u => u.status === 'available').length; const broken = state.units.filter(u => u.status === 'broken').length; const service = state.units.filter(u => u.status === 'service').length; return `${viewerBanner()}<section class="section-title first-title"><h3>Status Unit</h3><span>${available}/${state.units.length} tersedia · ${broken} rusak · ${service} servis</span></section><div class="unit-strip">${state.units.map(unitMini).join('')}</div><section class="section-title"><h3>Mulai Rental</h3><span>${isOwner()?'Pilih unit + paket':'dikunci'}</span></section>${startRentalPanel()}<section class="section-title"><h3>Timer Aktif</h3><span>${state.activeSessions.length} berjalan</span></section>${dashboardTimers()}`; }
function unitMini(u){ return `<button class="unit-mini ${statusClass(u.status)}" onclick="go('units')"><strong>${esc(u.name)}</strong><small>${statusLabel(u.status)}</small></button>`; }
function startRentalPanel(){ if (!isOwner()) return `<div class="empty">Panel mulai rental disamarkan. Buka akses pengelola di Setting untuk mulai sewa.</div>`; const units = availableUnits(); if (!units.length) return `<div class="empty">Tidak ada unit tersedia. Cek status unit di menu Unit.</div>`; return `<div class="card start-panel"><div class="field"><label>Pilih Unit RC</label><select id="unitSelect">${units.map(u=>`<option value="${u.id}">${esc(u.name)} · ${esc(u.type)}</option>`).join('')}</select></div><div class="grid packages compact-packages">${state.packages.map(packageCard).join('')}</div></div>`; }
function packageCard(p){ return `<button class="card package compact-package" onclick='startPackageFromSelect(${JSON.stringify(p)})'>${p.badge?`<span class="badge">${esc(p.badge)}</span>`:''}<h4>${esc(p.name)}</h4><div class="price">${rupiah(p.price).replace('Rp','Rp ')}</div><div class="duration">${p.minutes} menit</div></button>`; }
function startPackageFromSelect(pkg){ const select = document.querySelector('#unitSelect'); startSession(pkg, select?.value); }
function dashboardTimers(){ if (!state.activeSessions.length) return `<div class="empty">Belum ada timer aktif.</div>`; return `<div class="list compact-timer-list">${state.activeSessions.map(timerCard).join('')}</div>`; }
function timerCard(s){ const t = timerRemaining(s); if (t.done && s.status === 'active' && !s.notified) { s.notified = true; saveState(); setTimeout(()=>{ beep(); toast(`${s.unitName}: waktu habis.`); render(); }, 50); } const locked = isOwner() ? '' : 'action-locked'; return `<section class="card timer-card compact-timer ${t.done?'expired':''}"><div class="timer-head"><div><strong>${esc(s.unitName)}</strong><small>${esc(s.packageName)} · ${rupiah(s.price)} cash</small></div><div class="timer-mini-display">${fmtTimer(t.ms)}</div></div><div class="progress"><span style="width:${t.pct}%"></span></div><div class="timer-status-row"><span>${s.status === 'paused' ? 'Pause' : t.done ? 'Waktu habis' : 'Berjalan'}</span><span>${s.minutes} menit</span></div><div class="controls compact-controls ${locked}"><button class="btn ghost" onclick="${s.status==='paused'?`resumeSession('${s.id}')`:`pauseSession('${s.id}')`}">${s.status==='paused'?'Lanjut':'Pause'}</button><button class="btn primary" onclick="addMinutes('${s.id}',5)">+5</button><button class="btn green" onclick="finishSession('${s.id}')">Cash</button><button class="btn red" onclick="cancelSession('${s.id}')">Batal</button></div>${!isOwner()?'<small class="muted">Aksi dikunci untuk viewer.</small>':''}</section>`; }

function unitsView(){ syncUnitStatuses(state, false); if (!isOwner()) return `<section class="section-title first-title"><h3>Status Unit</h3><span>${state.units.length} unit</span></section><div class="unit-strip">${state.units.map(unitMini).join('')}</div><section class="section-title"><h3>Timer Aktif</h3><span>${state.activeSessions.length} berjalan</span></section>${dashboardTimers()}`; return `<section class="section-title first-title"><h3>Tambah Unit</h3><span>owner</span></section><div class="card start-panel"><div class="field"><label>Nama Unit</label><input id="newUnitName" placeholder="Contoh: Excavator 3"></div><div class="field"><label>Jenis Unit</label><input id="newUnitType" placeholder="Contoh: Excavator / Dump Truck / Loader"></div><button class="btn primary full" onclick="addUnit()">Tambah Unit</button></div><section class="section-title"><h3>Daftar Unit</h3><span>${state.units.length} unit</span></section><div class="list">${state.units.map(unitEditor).join('')}</div>`; }
function unitEditor(u){ const recentMaint = (u.maintenanceLog || []).slice(0,2).map(m=>`<small>${esc(m.date)} · ${rupiah(m.cost)} · ${esc(m.note)}</small>`).join(''); return `<div class="item unit-item"><div class="row"><div><strong>${esc(u.name)}</strong><small>${esc(u.type)} · ${statusLabel(u.status)}</small></div><span class="status-pill ${statusClass(u.status)}">${statusLabel(u.status)}</span></div><div class="row"><div class="field" style="flex:1"><label>Nama</label><input value="${esc(u.name)}" onchange="updateUnit('${u.id}','name',this.value)"></div><div class="field" style="flex:1"><label>Jenis</label><input value="${esc(u.type)}" onchange="updateUnit('${u.id}','type',this.value)"></div></div><div class="row unit-actions"><button class="btn green" onclick="setUnitStatus('${u.id}','available')">Tersedia</button><button class="btn ghost" onclick="setUnitStatus('${u.id}','service')">Servis</button><button class="btn red" onclick="setUnitStatus('${u.id}','broken')">Rusak</button></div><div class="field"><label>Catatan unit</label><input value="${esc(u.note || '')}" onchange="updateUnit('${u.id}','note',this.value)" placeholder="Contoh: baterai lemah..."></div><div class="maintenance-box"><strong>Maintenance</strong><div class="small-grid"><div class="field"><label>Biaya servis</label><input id="mcost-${u.id}" type="number" placeholder="25000"></div><div class="field"><label>Catatan servis</label><input id="mnote-${u.id}" placeholder="Roda macet / baterai..."></div></div><button class="btn ghost full" onclick="addMaintenance('${u.id}')">Simpan Catatan Servis</button>${recentMaint}</div><button class="btn ghost full" onclick="deleteUnit('${u.id}')">Hapus Unit</button></div>`; }
function packagesView(){ if(!isOwner()) return `<div class="empty">Paket disamarkan. Buka akses pengelola di Setting.</div>`; return `<section class="section-title first-title"><h3>Edit Paket</h3><span>owner</span></section><div class="list">${state.packages.map(p=>`<div class="item"><div class="field"><label>Nama Paket</label><input value="${esc(p.name)}" onchange="updatePackage('${p.id}','name',this.value)"></div><div class="row"><div class="field" style="flex:1"><label>Durasi menit</label><input type="number" value="${p.minutes}" onchange="updatePackage('${p.id}','minutes',this.value)"></div><div class="field" style="flex:1"><label>Harga cash</label><input type="number" value="${p.price}" onchange="updatePackage('${p.id}','price',this.value)"></div></div><div class="field"><label>Badge</label><input value="${esc(p.badge||'')}" onchange="updatePackage('${p.id}','badge',this.value)"></div></div>`).join('')}</div>`; }
function historyRange(){ return getRangeForMode(historyMode); }
function historyView(){ const range = historyRange(); let list = sessionsBetween(range.start, range.end, true); if(historyUnitFilter !== 'all') list = list.filter(s=>s.unitId===historyUnitFilter); if(historyStatusFilter !== 'all') list = list.filter(s=>s.status===historyStatusFilter); return `<section class="section-title first-title"><h3>Riwayat Sesi</h3><span>${list.length} data</span></section><div class="card start-panel history-filter"><div class="report-tabs"><button class="btn ${historyMode==='today'?'primary':'ghost'}" onclick="setHistoryMode('today')">Hari Ini</button><button class="btn ${historyMode==='yesterday'?'primary':'ghost'}" onclick="setHistoryMode('yesterday')">Kemarin</button><button class="btn ${historyMode==='7days'?'primary':'ghost'}" onclick="setHistoryMode('7days')">7 Hari</button><button class="btn ${historyMode==='custom'?'primary':'ghost'}" onclick="setHistoryMode('custom')">Custom</button></div>${historyMode==='custom'?`<div class="filter-row"><div class="field"><label>Dari</label><input type="date" value="${customStart}" onchange="customStart=this.value;render()"></div><div class="field"><label>Sampai</label><input type="date" value="${customEnd}" onchange="customEnd=this.value;render()"></div></div>`:''}<div class="filter-row"><div class="field"><label>Filter unit</label><select onchange="historyUnitFilter=this.value;render()"><option value="all">Semua unit</option>${state.units.map(u=>`<option value="${u.id}" ${historyUnitFilter===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></div><div class="field"><label>Status</label><select onchange="historyStatusFilter=this.value;render()"><option value="all">Semua</option><option value="done" ${historyStatusFilter==='done'?'selected':''}>Selesai</option><option value="cancelled" ${historyStatusFilter==='cancelled'?'selected':''}>Batal</option></select></div></div></div><div class="list">${list.length ? list.map(s=>`<div class="item"><strong>${esc(s.unitName || '-')} · ${esc(s.packageName)} · ${rupiah(s.price)}</strong><small>${dateTime(s.startedAt)} → ${dateTime(s.finishedAt)}<br>${s.minutes} menit · Status: ${s.status === 'done' ? 'Selesai / cash diterima' : 'Batal'}</small></div>`).join('') : '<div class="empty">Belum ada riwayat untuk filter ini.</div>'}</div>`; }
function settingsView(){ return `${ownerAccessPanel()}${isOwner()?ownerSettingsPanel():viewerSettingsPanel()}`; }
function ownerAccessPanel(){ if (isOwner()) return `<section class="section-title first-title"><h3>Akses Pengelola</h3><span>private</span></section><div class="card lock-card mode-card"><div class="row"><div><strong>Owner mode aktif</strong><small>Fitur transaksi, unit, paket, laporan, dan setting terbuka.</small></div><button class="btn ghost" onclick="lockOwner()">Kunci</button></div></div>`; if (!hasPin()) return `<section class="section-title first-title"><h3>Akses Pengelola</h3><span>buat PIN</span></section><div class="card lock-card"><h3>Buat PIN Pengelola</h3><p class="privacy-note">Tidak ada PIN default. Buat PIN sendiri dulu agar owner mode tetap private.</p><div class="pin-form"><input id="ownerPin" type="password" inputmode="numeric" placeholder="PIN baru"><input id="ownerPin2" type="password" inputmode="numeric" placeholder="Ulangi PIN baru"><button class="btn primary full" onclick="setupOrUnlockOwner()">Buat PIN & Buka Owner Mode</button></div></div>`; return `<section class="section-title first-title"><h3>Akses Pengelola</h3><span>private</span></section><div class="card lock-card"><h3>Owner mode dikunci</h3><p class="privacy-note">Masukkan PIN untuk membuka fitur pengelola. PIN tidak ditampilkan di aplikasi.</p><div class="pin-form"><input id="ownerPin" type="password" inputmode="numeric" placeholder="Masukkan PIN"><button class="btn primary full" onclick="setupOrUnlockOwner()">Buka Akses Pengelola</button></div></div>`; }
function viewerSettingsPanel(){ return `<section class="section-title"><h3>Google Sync Data</h3><span>viewer</span></section><div class="card start-panel sync-panel"><label class="toggle-row"><input id="setSyncEnabled" type="checkbox" ${state.settings.syncEnabled?'checked':''} onchange="state.settings.syncEnabled=this.checked;saveState();render()"><span>Aktifkan Google Sync realtime</span></label><div class="field"><label>Nama device</label><input id="viewerDeviceName" value="${esc(state.settings.syncDeviceName || 'Viewer')}" onchange="state.settings.syncDeviceName=this.value;saveState();render()"></div><div class="field"><label>URL Web App Google Apps Script</label><input value="${esc(state.settings.syncUrl || '')}" onchange="state.settings.syncUrl=this.value;saveState();render()" placeholder="https://script.google.com/macros/s/.../exec"></div><div class="row unit-actions"><button class="btn green" onclick="syncPull(true)">Tarik Data</button><button class="btn ghost" onclick="syncNow()">Sync</button></div><small class="sync-status">Status: ${esc(state.settings.syncStatus || 'Belum aktif')} ${state.settings.lastSyncAt ? '· ' + esc(state.settings.lastSyncAt) : ''}</small></div>`; }
function ownerSettingsPanel(){ const range = getReportRange(); const list = sessionsBetween(range.start, range.end); const r = calcReport(list, range.start, range.end); const unitRows = Object.keys(r.unitMap).map(name=>`<div class="mini-report-row"><span>${esc(name)} · ${r.unitMap[name]} sesi</span><strong>${rupiah(r.unitRevenue[name] || 0)}</strong></div>`).join('') || '<div class="empty">Belum ada data unit.</div>'; return `<section class="section-title"><h3>Profil Aplikasi</h3><span>logo & nama</span></section><div class="card start-panel"><div class="row profile-row"><div class="logo logo-preview">${brandLogoHtml()}</div><div style="flex:1"><strong>${esc(state.settings.businessName || 'SATSET PLAYZONE')}</strong><small>${esc(state.settings.profileText || '')}</small></div></div><div class="field"><label>Nama aplikasi</label><input id="setBusinessName" value="${esc(state.settings.businessName)}"></div><div class="field"><label>Profil/tagline kecil</label><input id="setProfileText" value="${esc(state.settings.profileText)}"></div><div class="field"><label>Teks logo jika tanpa gambar</label><input id="setLogoText" maxlength="4" value="${esc(state.settings.logoText)}"></div><div class="field"><label>Upload logo gambar</label><input type="file" accept="image/*" onchange="uploadLogo(this)"></div><button class="btn ghost full" onclick="clearLogo()">Hapus Logo Gambar</button></div><section class="section-title"><h3>Mode Device</h3><span>owner/viewer</span></section><div class="card start-panel"><div class="field"><label>Mode device ini</label><select id="setDeviceMode"><option value="owner" ${state.settings.deviceMode==='owner'?'selected':''}>Owner - bisa edit/transaksi</option><option value="viewer" ${state.settings.deviceMode==='viewer'?'selected':''}>Viewer - pantau saja</option></select></div><p class="privacy-note">Untuk HP bini, pilih Viewer agar hanya pantau unit aktif. Untuk HP owner, pilih Owner dan buka dengan PIN.</p></div><section class="section-title"><h3>Buka / Tutup</h3><span>${operatingLabel()} · WIB</span></section><div class="card start-panel"><div class="field"><label>Mode operasional</label><select id="setOperationMode"><option value="auto" ${state.settings.operationMode==='auto'?'selected':''}>Otomatis sesuai jam WIB</option><option value="manual_open" ${state.settings.operationMode==='manual_open'?'selected':''}>Manual buka</option><option value="manual_closed" ${state.settings.operationMode==='manual_closed'?'selected':''}>Manual tutup / cuti</option></select></div><div class="row"><div class="field" style="flex:1"><label>Jam Buka WIB</label><input id="setOpenTime" type="time" value="${esc(state.settings.openTime)}"></div><div class="field" style="flex:1"><label>Jam Tutup WIB</label><input id="setCloseTime" type="time" value="${esc(state.settings.closeTime)}"></div></div><label class="toggle-row"><input id="setEnforceHours" type="checkbox" ${state.settings.enforceHours?'checked':''}><span>Blok mulai rental saat status TUTUP</span></label><label class="toggle-row"><input id="setSound" type="checkbox" ${state.settings.sound?'checked':''}><span>Suara alert timer habis</span></label></div><section class="section-title"><h3>Google Sync Data</h3><span>owner + bini</span></section><div class="card start-panel sync-panel"><label class="toggle-row"><input id="setSyncEnabled" type="checkbox" ${state.settings.syncEnabled?'checked':''}><span>Aktifkan Google Sync realtime</span></label><div class="field"><label>Nama device</label><input id="setSyncDeviceName" value="${esc(state.settings.syncDeviceName || 'Owner 1')}"></div><div class="field"><label>URL Web App Google Apps Script</label><input id="setSyncUrl" value="${esc(state.settings.syncUrl || '')}" placeholder="https://script.google.com/macros/s/.../exec"></div><div class="row unit-actions"><button class="btn primary" onclick="saveSettingsFromForm()">Simpan Setting</button><button class="btn green" onclick="syncNow()">Sync Sekarang</button><button class="btn ghost" onclick="syncPull(true)">Tarik Data</button></div><small class="sync-status">Status: ${esc(state.settings.syncStatus || 'Belum aktif')} ${state.settings.lastSyncAt ? '· ' + esc(state.settings.lastSyncAt) : ''}</small></div><section class="section-title"><h3>Laporan Privat</h3><span>di dalam setting</span></section><details class="card private-report"><summary>Lihat laporan omset</summary><div class="report-tabs"><button class="btn ${reportMode==='today'?'primary':'ghost'}" onclick="setReportMode('today')">Hari Ini</button><button class="btn ${reportMode==='7days'?'primary':'ghost'}" onclick="setReportMode('7days')">7 Hari</button><button class="btn ${reportMode==='month'?'primary':'ghost'}" onclick="setReportMode('month')">1 Bulan</button><button class="btn ${reportMode==='custom'?'primary':'ghost'}" onclick="setReportMode('custom')">Custom</button></div>${reportMode==='custom'?`<div class="row"><div class="field" style="flex:1"><label>Dari</label><input type="date" value="${customStart}" onchange="customStart=this.value;render()"></div><div class="field" style="flex:1"><label>Sampai</label><input type="date" value="${customEnd}" onchange="customEnd=this.value;render()"></div></div>`:''}<div class="privacy-note">Periode WIB: ${dateRangeLabel(range.start, range.end)}</div><section class="grid stats private-stats"><div class="card metric"><small>Total Cash</small><strong>${rupiah(r.revenue)}</strong><div class="sub">${r.doneCount} sesi</div></div><div class="card metric"><small>Estimasi Bersih</small><strong>${rupiah(r.net)}</strong><div class="sub">Servis: ${rupiah(r.maintenance)}</div></div></section><section class="grid stats private-stats"><div class="card metric"><small>Total Durasi</small><strong>${r.duration}m</strong><div class="sub">Top: ${esc(r.bestUnit)}</div></div><div class="card metric"><small>Paket Laris</small><strong>${esc(r.best)}</strong><div class="sub">Periode ini</div></div></section><div class="unit-report"><strong>Laporan per unit</strong>${unitRows}</div><button class="btn primary full" onclick="exportCSV()">Export CSV Periode Ini</button></details><section class="section-title"><h3>PIN Pengelola</h3><span>private</span></section><div class="card start-panel"><div class="field"><label>PIN lama</label><input id="oldPin" type="password" inputmode="numeric"></div><div class="field"><label>PIN baru</label><input id="newPin" type="password" inputmode="numeric"></div><div class="field"><label>Ulangi PIN baru</label><input id="confirmPin" type="password" inputmode="numeric"></div><button class="btn ghost full" onclick="changePin()">Ganti PIN</button></div><section class="section-title"><h3>Backup / Restore</h3><span>data lokal</span></section><div class="card start-panel"><div class="backup-row"><button class="btn green" onclick="exportBackup()">Export Backup</button><label class="btn ghost" style="text-align:center">Import Backup<input type="file" accept="application/json" style="display:none" onchange="importBackup(this)"></label></div></div><button class="btn primary full sticky-save" onclick="saveSettingsFromForm()">Simpan Semua Setting</button><section class="section-title"><h3>Data Lokal</h3><span>device ini</span></section><div class="grid"><button class="btn red full" onclick="resetData()">Reset Semua Data</button></div>`; }
function setReportMode(mode){ reportMode = mode; render(); }
function setHistoryMode(mode){ historyMode = mode; render(); }
function render(){ ensureDay(); syncUnitStatuses(state, false); const views = { dashboard:dashboardView, units:unitsView, packages:packagesView, history:historyView, settings:settingsView }; renderShell((views[currentTab] || dashboardView)()); }

Object.assign(window, { startSession,startPackageFromSelect,pauseSession,resumeSession,addMinutes,finishSession,cancelSession,updatePackage,setUnitStatus,updateUnit,addUnit,deleteUnit,addMaintenance,uploadLogo,saveSettingsFromForm,syncNow,syncPull,syncPush,clearLogo,exportCSV,resetData,setReportMode,setHistoryMode,setupOrUnlockOwner,lockOwner,changePin,exportBackup,importBackup });
setInterval(()=>{ if (state.activeSessions.length) render(); }, 1000);
setInterval(()=>{ if (canSync()) syncPull(false); }, SYNC_INTERVAL_MS);
ensureDay(); syncUnitStatuses(state, true);
document.addEventListener('touchmove', (event) => { if (event.touches && event.touches.length > 1) event.preventDefault(); }, { passive:false });
document.addEventListener('gesturestart', (event) => event.preventDefault());
let lastTouchEnd = 0; document.addEventListener('touchend', (event) => { const now = Date.now(); if (now - lastTouchEnd <= 300) event.preventDefault(); lastTouchEnd = now; }, { passive:false });
if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
render();
