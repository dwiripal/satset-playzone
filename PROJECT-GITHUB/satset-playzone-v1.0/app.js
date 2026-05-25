const STORAGE_KEY = 'satset_playzone_v1_state';
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

function todayKey(date = new Date()) { return date.toISOString().slice(0,10); }
function rupiah(n) { return new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(n || 0)); }
function timeOnly(ts) { return ts ? new Date(ts).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '-'; }
function dateTime(ts) { return ts ? new Date(ts).toLocaleString('id-ID', { dateStyle:'medium', timeStyle:'short' }) : '-'; }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function loadState(){
  const fallback = { day: null, packages: DEFAULT_PACKAGES, units: DEFAULT_UNITS, sessions: [], activeSessions: [], activeSession: null, settings: { pin: '', ownerName: 'Owner', sound: true } };
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
  s.settings = { pin: '', ownerName: 'Owner', sound: true, ...(s.settings || {}) };
  syncUnitStatuses(s, false);
  return s;
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function ensureDay(){
  if (!state.day || state.day.date !== todayKey()) {
    state.day = { date: todayKey(), isOpen: false, openedAt: null, closedAt: null };
    saveState();
  }
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

function todaysSessions(){ return state.sessions.filter(s => s.date === todayKey() && s.status !== 'cancelled'); }
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

function toast(msg){
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2600);
}
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
  if (!state.day.isOpen) return toast('Buka kasir dulu sebelum mulai rental.');
  const unit = unitById(unitId);
  if (!unit) return toast('Pilih unit RC dulu.');
  if (unit.status === 'broken') return toast(`${unit.name} sedang rusak, tidak bisa dipakai.`);
  if (activeForUnit(unitId)) return toast(`${unit.name} masih dipakai. Selesaikan dulu.`);
  const now = Date.now();
  const session = {
    id: uid(), date: todayKey(), packageId: pkg.id, packageName: pkg.name,
    unitId: unit.id, unitName: unit.name, unitType: unit.type,
    minutes: Number(pkg.minutes), price: Number(pkg.price),
    startedAt: now, endsAt: now + Number(pkg.minutes)*60*1000, pausedAt: null, totalPausedMs: 0, status: 'active', note: '', notified: false
  };
  state.activeSessions.unshift(session);
  syncUnitStatuses(state, false);
  saveState();
  currentTab = 'timer';
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
function openDay(){
  ensureDay();
  state.day.isOpen = true; state.day.openedAt = Date.now(); state.day.closedAt = null; saveState(); render(); toast('Kasir SATSET PLAYZONE dibuka.');
}
function closeDay(){
  if (state.activeSessions.length) return toast('Selesaikan semua sesi aktif sebelum tutup kasir.');
  ensureDay(); state.day.isOpen = false; state.day.closedAt = Date.now(); saveState(); render(); toast('Kasir ditutup. Laporan harian sudah tersimpan lokal.');
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
function exportCSV(){
  const rows = [['Tanggal','Unit','Jenis Unit','Paket','Durasi Menit','Harga Cash','Mulai','Selesai','Status','Catatan']];
  state.sessions.forEach(s => rows.push([s.date,s.unitName||'',s.unitType||'',s.packageName,s.minutes,s.price,dateTime(s.startedAt),dateTime(s.finishedAt),s.status,s.note||'']));
  const csv = rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `satset-playzone-report-${todayKey()}.csv`; a.click();
  URL.revokeObjectURL(url);
}
function resetData(){
  if (!confirm('Hapus semua data lokal SATSET PLAYZONE?')) return;
  localStorage.removeItem(STORAGE_KEY); location.reload();
}

function timerRemaining(s){
  if (!s) return { ms:0, total:0, pct:0, done:false };
  const now = s.status === 'paused' ? s.pausedAt : Date.now();
  const total = s.minutes * 60 * 1000;
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
  document.querySelector('#app').innerHTML = `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <div class="logo">SP</div>
          <div><h1>SATSET PLAYZONE</h1><p>Owner control · Multi unit RC · Cash only</p></div>
          <div class="status-pill ${state.day.isOpen ? 'open' : ''}">${state.day.isOpen ? 'BUKA' : 'TUTUP'}</div>
        </div>
      </header>
      ${content}
      <nav class="bottom-nav nav-six">
        ${navButton('dashboard','Beranda')}${navButton('timer','Timer')}${navButton('units','Unit')}${navButton('packages','Paket')}${navButton('history','Riwayat')}${navButton('report','Laporan')}
      </nav>
      <div id="toast" class="toast"></div>
    </main>`;
}
function navButton(tab,label){ return `<button class="nav-btn ${currentTab===tab?'active':''}" onclick="go('${tab}')">${label}</button>`; }
window.go = tab => { currentTab = tab; render(); };

function dashboardView(){
  const r = calcReport();
  const available = state.units.filter(u => u.status === 'available').length;
  const broken = state.units.filter(u => u.status === 'broken').length;
  return `
    <section class="card hero"><h2>Kontrol rental hari ini</h2><p>Timer multi unit, status RC, dan omset cash dicatat otomatis dari jam buka sampai tutup.</p></section>
    <section class="grid stats" style="margin-top:12px">
      <div class="card metric"><small>Omset Cash Hari Ini</small><strong>${rupiah(r.revenue)}</strong><div class="sub">${r.doneCount} sesi selesai</div></div>
      <div class="card metric"><small>Sesi Aktif</small><strong>${state.activeSessions.length}</strong><div class="sub">Unit tersedia: ${available}</div></div>
      <div class="card metric"><small>Total Durasi Main</small><strong>${r.duration}m</strong><div class="sub">Paket laris: ${r.best}</div></div>
      <div class="card metric"><small>Kondisi Unit</small><strong>${available}/${state.units.length}</strong><div class="sub">Rusak: ${broken} · Top unit: ${r.bestUnit}</div></div>
    </section>
    <section class="section-title"><h3>Aksi Kasir</h3><span>Cash only</span></section>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <button class="btn green" onclick="openDay()">Buka Hari Ini</button>
      <button class="btn red" onclick="closeDay()">Tutup Hari Ini</button>
    </div>
    <section class="section-title"><h3>Status Unit</h3><span>${state.units.length} RC</span></section>
    <div class="unit-strip">${state.units.map(unitMini).join('')}</div>
    <section class="section-title"><h3>Mulai Rental</h3><span>Pilih unit + paket</span></section>
    ${startRentalPanel()}
  `;
}
function unitMini(u){ return `<div class="unit-mini ${statusClass(u.status)}"><strong>${esc(u.name)}</strong><small>${statusLabel(u.status)}</small></div>`; }
function startRentalPanel(){
  const units = availableUnits();
  if (!units.length) return `<div class="empty">Tidak ada unit tersedia. Cek tab Unit atau selesaikan sesi aktif.</div>`;
  return `<div class="start-panel card">
    <div class="field"><label>Pilih Unit RC</label><select id="unitSelect">${units.map(u=>`<option value="${u.id}">${esc(u.name)} · ${esc(u.type)}</option>`).join('')}</select></div>
    <div class="grid packages">${state.packages.map(packageCard).join('')}</div>
  </div>`;
}
function packageCard(p){
  return `<button class="card package" onclick='startPackageFromSelect(${JSON.stringify(p)})'>${p.badge?`<span class="badge">${esc(p.badge)}</span>`:''}<h4>${esc(p.name)}</h4><div class="price">${rupiah(p.price).replace('Rp','Rp ')}</div><div class="duration">${p.minutes} menit · Cash</div></button>`;
}
function startPackageFromSelect(pkg){
  const select = document.querySelector('#unitSelect');
  const unitId = select?.value;
  startSession(pkg, unitId);
}
function timerView(){
  if (!state.activeSessions.length) return `<section class="card timer-card"><h2>Tidak ada sesi aktif</h2><p class="timer-status">Mulai rental dari Beranda. Satu unit bisa berjalan sendiri-sendiri.</p></section><section class="section-title"><h3>Pilih Unit + Paket</h3><span>Cash</span></section>${startRentalPanel()}`;
  return `<section class="section-title"><h3>Timer Aktif</h3><span>${state.activeSessions.length} berjalan</span></section><div class="list">${state.activeSessions.map(timerCard).join('')}</div>`;
}
function timerCard(s){
  const t = timerRemaining(s);
  if (t.done && s.status === 'active' && !s.notified) { s.notified = true; saveState(); setTimeout(()=>{ beep(); toast(`${s.unitName}: waktu habis. Terima cash lalu selesaikan sesi.`); render(); }, 50); }
  return `<section class="card timer-card"><div class="timer-status"><strong>${esc(s.unitName)}</strong> · ${esc(s.packageName)} · ${rupiah(s.price)} cash</div><div class="timer-display">${fmtTimer(t.ms)}</div><div class="timer-status">${s.status === 'paused' ? 'Timer dipause' : t.done ? 'Waktu habis' : 'Sedang berjalan'}</div><div class="progress"><span style="width:${t.pct}%"></span></div><div class="controls"><button class="btn ghost" onclick="${s.status==='paused'?`resumeSession('${s.id}')`:`pauseSession('${s.id}')`}">${s.status==='paused'?'Lanjut':'Pause'}</button><button class="btn primary" onclick="addMinutes('${s.id}',5)">+5 Menit</button><button class="btn green" onclick="finishSession('${s.id}')">Terima Cash</button><button class="btn red" onclick="cancelSession('${s.id}')">Batalkan</button></div></section>`;
}
function unitsView(){
  syncUnitStatuses(state, false);
  return `<section class="card hero"><h2>Manajemen Unit RC</h2><p>Default v1.1: Excavator 1, Excavator 2, Dump Truck 1, Loader 1. Status unit: tersedia, dipakai, atau rusak.</p></section><section class="section-title"><h3>Daftar Unit</h3><span>multi unit</span></section><div class="list">${state.units.map(u=>`<div class="item unit-item"><div class="row"><div><strong>${esc(u.name)}</strong><small>${esc(u.type)} · ${statusLabel(u.status)}</small></div><span class="status-pill ${statusClass(u.status)}">${statusLabel(u.status)}</span></div><div class="row unit-actions"><button class="btn green" onclick="setUnitStatus('${u.id}','available')">Tersedia</button><button class="btn ghost" onclick="setUnitStatus('${u.id}','in_use')">Dipakai</button><button class="btn red" onclick="setUnitStatus('${u.id}','broken')">Rusak</button></div><div class="field"><label>Catatan unit</label><input value="${esc(u.note || '')}" onchange="updateUnit('${u.id}','note',this.value)" placeholder="Contoh: baterai lemah, rantai dicek..."></div></div>`).join('')}</div>`;
}
function packagesView(){
  return `<section class="card hero"><h2>Paket Harga</h2><p>Default v1.1: 5K/5m, 10K/15m, 15K/25m, 20K/35m. Paket 10K dijadikan rekomendasi utama.</p></section><section class="section-title"><h3>Edit Paket</h3><span>tersimpan lokal</span></section><div class="list">${state.packages.map(p=>`<div class="item"><div class="field"><label>Nama Paket</label><input value="${esc(p.name)}" onchange="updatePackage('${p.id}','name',this.value)"></div><div class="row"><div class="field" style="flex:1"><label>Durasi menit</label><input type="number" value="${p.minutes}" onchange="updatePackage('${p.id}','minutes',this.value)"></div><div class="field" style="flex:1"><label>Harga cash</label><input type="number" value="${p.price}" onchange="updatePackage('${p.id}','price',this.value)"></div></div><div class="field"><label>Badge</label><input value="${esc(p.badge||'')}" onchange="updatePackage('${p.id}','badge',this.value)"></div></div>`).join('')}</div>`;
}
function historyView(){
  const list = state.sessions.slice(0,80);
  return `<section class="section-title"><h3>Riwayat Sesi</h3><span>${state.sessions.length} data</span></section><div class="list">${list.length ? list.map(s=>`<div class="item"><strong>${esc(s.unitName || '-')} · ${esc(s.packageName)} · ${rupiah(s.price)}</strong><small>${dateTime(s.startedAt)} → ${dateTime(s.finishedAt)}<br>${s.minutes} menit · Status: ${s.status === 'done' ? 'Selesai / cash diterima' : 'Batal'}</small></div>`).join('') : '<div class="empty">Belum ada riwayat sesi.</div>'}</div>`;
}
function reportView(){
  const r = calcReport();
  return `<section class="card hero"><h2>Laporan Hari Ini</h2><p>Rekap dari jam buka sampai tutup. Metode bayar v1.1 masih cash only, dengan breakdown unit RC.</p></section><section class="grid stats" style="margin-top:12px"><div class="card metric"><small>Total Cash</small><strong>${rupiah(r.revenue)}</strong><div class="sub">Semua transaksi cash</div></div><div class="card metric"><small>Total Sesi</small><strong>${r.doneCount}</strong><div class="sub">Sesi selesai</div></div><div class="card metric"><small>Top Unit</small><strong>${esc(r.bestUnit)}</strong><div class="sub">Paling sering dipakai</div></div><div class="card metric"><small>Paket Terlaris</small><strong>${esc(r.best)}</strong><div class="sub">Hari ini</div></div></section><section class="section-title"><h3>Export & Data</h3><span>lokal device</span></section><div class="grid"><button class="btn primary full" onclick="exportCSV()">Export CSV</button><button class="btn ghost full" onclick="state.settings.sound=!state.settings.sound;saveState();render();">Suara Alert: ${state.settings.sound?'Aktif':'Mati'}</button><button class="btn red full" onclick="resetData()">Reset Semua Data</button></div>`;
}

function render(){
  ensureDay(); syncUnitStatuses(state, false);
  const views = { dashboard:dashboardView, timer:timerView, units:unitsView, packages:packagesView, history:historyView, report:reportView };
  renderShell((views[currentTab] || dashboardView)());
}
window.startSession = startSession; window.startPackageFromSelect = startPackageFromSelect; window.pauseSession = pauseSession; window.resumeSession = resumeSession; window.addMinutes = addMinutes; window.finishSession = finishSession; window.cancelSession = cancelSession; window.openDay = openDay; window.closeDay = closeDay; window.updatePackage = updatePackage; window.setUnitStatus = setUnitStatus; window.updateUnit = updateUnit; window.exportCSV = exportCSV; window.resetData = resetData;

setInterval(()=>{ if (currentTab === 'timer' && state.activeSessions.length) render(); }, 1000);
ensureDay(); syncUnitStatuses(state, true);
if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
render();
