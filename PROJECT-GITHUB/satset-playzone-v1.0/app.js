const STORAGE_KEY = 'satset_playzone_v1_state';
const DEFAULT_PACKAGES = [
  { id: 'try', name: 'Coba Dulu', minutes: 5, price: 5000, badge: 'Entry' },
  { id: 'seru', name: 'Paket Seru', minutes: 15, price: 10000, badge: 'Rekomendasi' },
  { id: 'puas', name: 'Paket Puas', minutes: 25, price: 15000, badge: 'Upsell' },
  { id: 'lama', name: 'Main Lama', minutes: 35, price: 20000, badge: 'Hemat' }
];

const state = loadState();
let currentTab = 'dashboard';
let tickInterval = null;

function todayKey(date = new Date()) { return date.toISOString().slice(0,10); }
function rupiah(n) { return new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(n || 0)); }
function timeOnly(ts) { return ts ? new Date(ts).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '-'; }
function dateTime(ts) { return ts ? new Date(ts).toLocaleString('id-ID', { dateStyle:'medium', timeStyle:'short' }) : '-'; }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function loadState(){
  const fallback = { day: null, packages: DEFAULT_PACKAGES, sessions: [], activeSession: null, settings: { pin: '', ownerName: 'Owner', sound: true } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed, packages: parsed.packages?.length ? parsed.packages : DEFAULT_PACKAGES };
  } catch { return fallback; }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function ensureDay(){
  if (!state.day || state.day.date !== todayKey()) {
    state.day = { date: todayKey(), isOpen: false, openedAt: null, closedAt: null };
    saveState();
  }
}

function todaysSessions(){ return state.sessions.filter(s => s.date === todayKey() && s.status !== 'cancelled'); }
function calcReport(list = todaysSessions()){
  const done = list.filter(s => s.status === 'done');
  const revenue = done.reduce((sum,s)=>sum+Number(s.price||0),0);
  const duration = done.reduce((sum,s)=>sum+Number(s.minutes||0),0);
  const packageMap = {};
  done.forEach(s => { packageMap[s.packageName] = (packageMap[s.packageName] || 0) + 1; });
  const best = Object.entries(packageMap).sort((a,b)=>b[1]-a[1])[0]?.[0] || '-';
  return { doneCount: done.length, revenue, duration, best, average: done.length ? Math.round(revenue/done.length) : 0 };
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

function startSession(pkg){
  ensureDay();
  if (!state.day.isOpen) return toast('Buka kasir dulu sebelum mulai rental.');
  if (state.activeSession) return toast('Masih ada sesi aktif. Selesaikan dulu.');
  const now = Date.now();
  state.activeSession = {
    id: uid(), date: todayKey(), packageId: pkg.id, packageName: pkg.name, minutes: Number(pkg.minutes), price: Number(pkg.price),
    startedAt: now, endsAt: now + Number(pkg.minutes)*60*1000, pausedAt: null, totalPausedMs: 0, status: 'active', note: ''
  };
  saveState();
  currentTab = 'timer';
  render();
  toast(`${pkg.name} dimulai: ${pkg.minutes} menit.`);
}
function pauseSession(){
  if (!state.activeSession || state.activeSession.status !== 'active') return;
  state.activeSession.status = 'paused';
  state.activeSession.pausedAt = Date.now();
  saveState(); render();
}
function resumeSession(){
  const s = state.activeSession;
  if (!s || s.status !== 'paused') return;
  const pausedMs = Date.now() - s.pausedAt;
  s.totalPausedMs += pausedMs;
  s.endsAt += pausedMs;
  s.pausedAt = null;
  s.status = 'active';
  saveState(); render();
}
function addMinutes(min){
  if (!state.activeSession) return;
  state.activeSession.endsAt += min*60*1000;
  state.activeSession.minutes += min;
  saveState(); render(); toast(`Tambah waktu ${min} menit.`);
}
function finishSession(){
  const s = state.activeSession;
  if (!s) return;
  s.finishedAt = Date.now();
  s.status = 'done';
  state.sessions.unshift(s);
  state.activeSession = null;
  saveState(); currentTab = 'dashboard'; render(); toast('Sesi selesai dan cash masuk laporan.');
}
function cancelSession(){
  const s = state.activeSession;
  if (!s) return;
  s.finishedAt = Date.now();
  s.status = 'cancelled';
  state.sessions.unshift(s);
  state.activeSession = null;
  saveState(); currentTab = 'dashboard'; render(); toast('Sesi dibatalkan.');
}
function openDay(){
  ensureDay();
  state.day.isOpen = true; state.day.openedAt = Date.now(); state.day.closedAt = null; saveState(); render(); toast('Kasir SATSET PLAYZONE dibuka.');
}
function closeDay(){
  if (state.activeSession) return toast('Selesaikan sesi aktif sebelum tutup kasir.');
  ensureDay(); state.day.isOpen = false; state.day.closedAt = Date.now(); saveState(); render(); toast('Kasir ditutup. Laporan harian sudah terkunci lokal.');
}

function updatePackage(id, field, value){
  const pkg = state.packages.find(p=>p.id===id); if(!pkg) return;
  pkg[field] = field === 'price' || field === 'minutes' ? Number(value) : value;
  saveState(); render();
}
function exportCSV(){
  const rows = [['Tanggal','Paket','Durasi Menit','Harga Cash','Mulai','Selesai','Status','Catatan']];
  state.sessions.forEach(s => rows.push([s.date,s.packageName,s.minutes,s.price,dateTime(s.startedAt),dateTime(s.finishedAt),s.status,s.note||'']));
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

function timerRemaining(){
  const s = state.activeSession;
  if (!s) return { ms:0, total:s?.minutes*60*1000 || 0, pct:0, done:false };
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
  ensureDay();
  const report = calcReport();
  document.querySelector('#app').innerHTML = `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <div class="logo">SP</div>
          <div><h1>SATSET PLAYZONE</h1><p>Owner control · RC rental timer · Cash only</p></div>
          <div class="status-pill ${state.day.isOpen ? 'open' : ''}">${state.day.isOpen ? 'BUKA' : 'TUTUP'}</div>
        </div>
      </header>
      ${content}
      <nav class="bottom-nav">
        ${navButton('dashboard','Beranda')}${navButton('timer','Timer')}${navButton('packages','Paket')}${navButton('history','Riwayat')}${navButton('report','Laporan')}
      </nav>
      <div id="toast" class="toast"></div>
    </main>`;
}
function navButton(tab,label){ return `<button class="nav-btn ${currentTab===tab?'active':''}" onclick="go('${tab}')">${label}</button>`; }
window.go = tab => { currentTab = tab; render(); };

function dashboardView(){
  const r = calcReport();
  return `
    <section class="card hero"><h2>Kontrol rental hari ini</h2><p>Timer, sesi bermain, dan omset cash dicatat otomatis dari jam buka sampai tutup.</p></section>
    <section class="grid stats" style="margin-top:12px">
      <div class="card metric"><small>Omset Cash Hari Ini</small><strong>${rupiah(r.revenue)}</strong><div class="sub">${r.doneCount} sesi selesai</div></div>
      <div class="card metric"><small>Total Durasi Main</small><strong>${r.duration}m</strong><div class="sub">Paket laris: ${r.best}</div></div>
      <div class="card metric"><small>Jam Buka</small><strong>${timeOnly(state.day.openedAt)}</strong><div class="sub">Status: ${state.day.isOpen?'berjalan':'belum/tutup'}</div></div>
      <div class="card metric"><small>Sesi Aktif</small><strong>${state.activeSession ? '1' : '0'}</strong><div class="sub">${state.activeSession ? state.activeSession.packageName : 'Tidak ada sesi'}</div></div>
    </section>
    <section class="section-title"><h3>Aksi Kasir</h3><span>Cash only</span></section>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <button class="btn green" onclick="openDay()">Buka Hari Ini</button>
      <button class="btn red" onclick="closeDay()">Tutup Hari Ini</button>
    </div>
    <section class="section-title"><h3>Mulai Rental</h3><span>Pilih paket</span></section>
    <div class="grid packages">${state.packages.map(packageCard).join('')}</div>
  `;
}
function packageCard(p){
  return `<button class="card package" onclick='startSession(${JSON.stringify(p)})'>${p.badge?`<span class="badge">${p.badge}</span>`:''}<h4>${p.name}</h4><div class="price">${rupiah(p.price).replace('Rp','Rp ')}</div><div class="duration">${p.minutes} menit · Cash</div></button>`;
}
function timerView(){
  const s = state.activeSession;
  if (!s) return `<section class="card timer-card"><h2>Tidak ada sesi aktif</h2><p class="timer-status">Mulai rental dari Beranda atau pilih paket di bawah.</p></section><section class="section-title"><h3>Pilih Paket</h3><span>Cash</span></section><div class="grid packages">${state.packages.map(packageCard).join('')}</div>`;
  const t = timerRemaining();
  if (t.done && s.status === 'active' && !s.notified) { s.notified = true; saveState(); setTimeout(()=>{ beep(); toast('Waktu habis. Terima cash lalu selesaikan sesi.'); render(); }, 50); }
  return `<section class="card timer-card"><div class="timer-status">${s.packageName} · ${rupiah(s.price)} cash</div><div class="timer-display">${fmtTimer(t.ms)}</div><div class="timer-status">${s.status === 'paused' ? 'Timer dipause' : t.done ? 'Waktu habis' : 'Sedang berjalan'}</div><div class="progress"><span style="width:${t.pct}%"></span></div><div class="controls"><button class="btn ghost" onclick="${s.status==='paused'?'resumeSession()':'pauseSession()'}">${s.status==='paused'?'Lanjut':'Pause'}</button><button class="btn primary" onclick="addMinutes(5)">+5 Menit</button><button class="btn green" onclick="finishSession()">Terima Cash</button><button class="btn red" onclick="cancelSession()">Batalkan</button></div></section>`;
}
function packagesView(){
  return `<section class="card hero"><h2>Paket Harga</h2><p>Default v1.0: 5K/5m, 10K/15m, 15K/25m, 20K/35m. Paket 10K dijadikan rekomendasi utama.</p></section><section class="section-title"><h3>Edit Paket</h3><span>tersimpan lokal</span></section><div class="list">${state.packages.map(p=>`<div class="item"><div class="field"><label>Nama Paket</label><input value="${p.name}" onchange="updatePackage('${p.id}','name',this.value)"></div><div class="row"><div class="field" style="flex:1"><label>Durasi menit</label><input type="number" value="${p.minutes}" onchange="updatePackage('${p.id}','minutes',this.value)"></div><div class="field" style="flex:1"><label>Harga cash</label><input type="number" value="${p.price}" onchange="updatePackage('${p.id}','price',this.value)"></div></div><div class="field"><label>Badge</label><input value="${p.badge||''}" onchange="updatePackage('${p.id}','badge',this.value)"></div></div>`).join('')}</div>`;
}
function historyView(){
  const list = state.sessions.slice(0,60);
  return `<section class="section-title"><h3>Riwayat Sesi</h3><span>${state.sessions.length} data</span></section><div class="list">${list.length ? list.map(s=>`<div class="item"><strong>${s.packageName} · ${rupiah(s.price)}</strong><small>${dateTime(s.startedAt)} → ${dateTime(s.finishedAt)}<br>${s.minutes} menit · Status: ${s.status === 'done' ? 'Selesai / cash diterima' : 'Batal'}</small></div>`).join('') : '<div class="empty">Belum ada riwayat sesi.</div>'}</div>`;
}
function reportView(){
  const r = calcReport();
  return `<section class="card hero"><h2>Laporan Hari Ini</h2><p>Rekap dari jam buka sampai tutup. Metode bayar v1.0 hanya cash.</p></section><section class="grid stats" style="margin-top:12px"><div class="card metric"><small>Total Cash</small><strong>${rupiah(r.revenue)}</strong><div class="sub">Semua transaksi cash</div></div><div class="card metric"><small>Total Sesi</small><strong>${r.doneCount}</strong><div class="sub">Sesi selesai</div></div><div class="card metric"><small>Rata-rata</small><strong>${rupiah(r.average)}</strong><div class="sub">Per sesi</div></div><div class="card metric"><small>Paket Terlaris</small><strong>${r.best}</strong><div class="sub">Hari ini</div></div></section><section class="section-title"><h3>Export & Data</h3><span>lokal device</span></section><div class="grid"><button class="btn primary full" onclick="exportCSV()">Export CSV</button><button class="btn ghost full" onclick="state.settings.sound=!state.settings.sound;saveState();render();">Suara Alert: ${state.settings.sound?'Aktif':'Mati'}</button><button class="btn red full" onclick="resetData()">Reset Semua Data</button></div>`;
}

function render(){
  const views = { dashboard:dashboardView, timer:timerView, packages:packagesView, history:historyView, report:reportView };
  renderShell((views[currentTab] || dashboardView)());
}
window.startSession = startSession; window.pauseSession = pauseSession; window.resumeSession = resumeSession; window.addMinutes = addMinutes; window.finishSession = finishSession; window.cancelSession = cancelSession; window.openDay = openDay; window.closeDay = closeDay; window.updatePackage = updatePackage; window.exportCSV = exportCSV; window.resetData = resetData;

setInterval(()=>{ if (currentTab === 'timer' && state.activeSession) render(); }, 1000);
if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
render();
