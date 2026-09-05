import { APP_CONFIG } from './config.js?v=1.0.0';
import { AppsScriptTransport, PengantaranApi } from './api-client.js?v=1.0.0';
import { createFarmasiModule } from './farmasi.js?v=1.0.0';
import { createCourierModule } from './courier.js?v=1.0.0';
import { createAdminModule } from './admin.js?v=1.0.0';
import { createManagementModule } from './management.js?v=1.0.0';

const $ = id => document.getElementById(id);
const state = {
  api:null,
  transport:null,
  endpoint:'',
  session:null,
  view:'home',
  backendReady:false,
  backendInfo:null,
  activeRequests:0,
  lastSessionCheck:0,
  authResetting:false,
  updateRegistration:null,
  updateRequested:false
};

const NAV = {
  FARMASI: [
    ['home','home','Beranda'],['registration','user-plus','Pendaftaran'],['today','calendar','Hari Ini'],['verification','badge-check','Verifikasi'],['followup','rotate','Tindak Lanjut'],['labels','tag','Label'],['account','user','Akun']
  ],
  KURIR: [
    ['home','home','Beranda'],['ready','package-check','Siap'],['tasks','truck','Tugas'],['history','history','Riwayat'],['account','user','Akun']
  ],
  ADMIN: [
    ['home','home','Beranda'],['corrections','file-pen','Koreksi Data'],['archive','archive','Arsip'],['master','database','Master'],['audit','list-checks','Audit'],['account','user','Akun']
  ],
  MANAJEMEN: [
    ['home','layout-dashboard','Ringkasan'],['performance','chart-column','Kinerja'],['areas','map-pin','Wilayah'],['reports','file-chart','Laporan'],['account','user','Akun']
  ]
};

function navIconSvg(name) {
  const paths = {
    'home':'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    'user-plus':'<circle cx="9" cy="8" r="3"/><path d="M3.5 20c.5-4 2.7-6 5.5-6s5 2 5.5 6"/><path d="M18 8v6M15 11h6"/>',
    'calendar':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    'badge-check':'<path d="m12 3 2.2 1.3 2.5-.1 1.2 2.2 2.2 1.2-.1 2.5 1.3 2.2-1.3 2.2.1 2.5-2.2 1.2-1.2 2.2-2.5-.1L12 21l-2.2-1.3-2.5.1-1.2-2.2-2.2-1.2.1-2.5L2.7 12 4 9.8l-.1-2.5 2.2-1.2 1.2-2.2 2.5.1L12 3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
    'rotate':'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/>',
    'tag':'<path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
    'package-check':'<path d="m21 8-9-5-9 5v8l9 5 9-5V8Z"/><path d="m3.5 7.5 8.5 5 8.5-5M12 12.5V21"/><path d="m15.5 15 1.5 1.5 3-3"/>',
    'truck':'<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    'history':'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6M12 7v5l3 2"/>',
    'file-pen':'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 16l6-6 2 2-6 6-3 1z"/>',
    'archive':'<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
    'database':'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    'list-checks':'<path d="m4 7 1.5 1.5L8 6M11 7h9M4 12l1.5 1.5L8 11M11 12h9M4 17l1.5 1.5L8 16M11 17h9"/>',
    'layout-dashboard':'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    'chart-column':'<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 20h20"/>',
    'map-pin':'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    'file-chart':'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 17v-4M12 17V9M16 17v-6"/>',
    'user':'<circle cx="12" cy="8" r="4"/><path d="M4 21c.7-5 3.4-7 8-7s7.3 2 8 7"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.home}</svg>`;
}

const PAGE_META = {
  home:['Beranda','Ringkasan kegiatan'],
  registration:['Pendaftaran','Daftarkan pengantaran obat'],
  today:['Hari Ini','Pantau pengantaran hari ini'],
  verification:['Verifikasi','Penerimaan tanpa kode'],
  followup:['Tindak Lanjut','Gagal antar dan pengantaran ulang'],
  labels:['Label','Cetak dan cetak ulang label'],
  ready:['Siap','Paket siap diambil'],
  tasks:['Tugas','Pengantaran aktif'],
  history:['Riwayat','Pengantaran selesai hari ini'],
  corrections:['Koreksi Data','Perbaikan data dengan jejak audit'],
  archive:['Arsip','Pemeliharaan data arsip'],
  master:['Master','Ringkasan konfigurasi sistem'],
  audit:['Audit','Jejak aktivitas sistem'],
  performance:['Kinerja','Kinerja layanan dan petugas'],
  areas:['Wilayah','Sebaran layanan'],
  reports:['Laporan','Laporan periode'],
  account:['Akun','Informasi akun']
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function displayRole(role) {
  return String(role || '').toUpperCase() === 'ADMIN' ? 'ADMIN DATA' : String(role || '').toUpperCase();
}

function initials(name) {
  return String(name || 'A').trim().split(/\s+/).slice(0,2).map(item => item[0] || '').join('').toUpperCase() || 'A';
}

function getClientId() {
  let id = localStorage.getItem(APP_CONFIG.clientIdStorageKey);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(APP_CONFIG.clientIdStorageKey,id);
  }
  return id;
}

function getEndpoint() {
  const override = String(localStorage.getItem(APP_CONFIG.backendStorageKey) || '').trim();
  return override || String(APP_CONFIG.backendUrl || '').trim();
}

function saveEndpoint(url) {
  localStorage.setItem(APP_CONFIG.backendStorageKey,String(url || '').trim());
}

function clearEndpointOverride() {
  localStorage.removeItem(APP_CONFIG.backendStorageKey);
}

function showAlert(target,text,type='error') {
  if (!target) return;
  target.innerHTML = text ? `<div class="alert ${type}">${escapeHtml(text)}</div>` : '';
}

function setBackendState(ready,message) {
  state.backendReady = ready;
  const el = $('backendState');
  if (!el) return;
  el.innerHTML = `<span class="dot ${ready?'ok':'bad'}"></span><span>${escapeHtml(message)}</span>`;
}

function setRequestState({active=false}={}) {
  state.activeRequests = Math.max(0,state.activeRequests + (active ? 1 : -1));
  $('requestBar')?.classList.toggle('active',state.activeRequests > 0);
}

function setButtonBusy(button,busy,label='Memproses…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.busyOriginalHtml) button.dataset.busyOriginalHtml = button.innerHTML;
    button.dataset.busyWasDisabled = button.disabled ? '1' : '0';
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy','true');
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
  } else {
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    if (button.dataset.busyOriginalHtml) { button.innerHTML = button.dataset.busyOriginalHtml; delete button.dataset.busyOriginalHtml; }
    const wasDisabled = button.dataset.busyWasDisabled === '1';
    delete button.dataset.busyWasDisabled;
    button.disabled = wasDisabled;
  }
}

function updateConnectivity() {
  const offline = !navigator.onLine;
  $('networkBanner')?.classList.toggle('hidden',!offline);
  if (offline) setBackendState(false,'Perangkat offline');
}

function showToast(message,type='info',timeout=4200) {
  const box = $('toastContainer');
  if (!box || !message) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span><button aria-label="Tutup">×</button>`;
  const close = () => { toast.classList.add('leaving'); setTimeout(() => toast.remove(),180); };
  toast.querySelector('button').addEventListener('click',close);
  box.appendChild(toast);
  setTimeout(close,timeout);
}

function openModal(html,{wide=false}={}) {
  $('modalContent').className = `modal ${wide?'wide':''}`;
  $('modalContent').innerHTML = html;
  $('appModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  $('modalContent').querySelectorAll('[data-modal-close]').forEach(button => button.addEventListener('click',closeModal));
}

function closeModal() {
  $('appModal').classList.add('hidden');
  $('modalContent').innerHTML = '';
  document.body.classList.remove('modal-open');
}

function confirmAction({title='Konfirmasi',message='',confirmLabel='Lanjutkan',tone='normal'}={}) {
  return new Promise(resolve => {
    openModal(`<div class="modal-head"><div><div class="eyebrow">KONFIRMASI</div><h3>${escapeHtml(title)}</h3></div><button class="modal-x" id="confirmClose">×</button></div><div class="confirm-message">${escapeHtml(message).replace(/\n/g,'<br>')}</div><div class="modal-actions"><button id="confirmCancel" class="secondary-btn">Batal</button><button id="confirmOk" class="${tone==='warning'?'warning-btn':tone==='danger'?'danger-btn':'primary-btn'}">${escapeHtml(confirmLabel)}</button></div>`);
    let done = false;
    const finish = value => { if (done) return; done = true; closeModal(); resolve(value); };
    $('confirmClose').addEventListener('click',() => finish(false));
    $('confirmCancel').addEventListener('click',() => finish(false));
    $('confirmOk').addEventListener('click',() => finish(true));
  });
}

function setNavBadge(view,count) {
  const value = Math.max(0,Number(count || 0));
  document.querySelectorAll(`[data-nav-badge="${view}"]`).forEach(el => {
    el.textContent = value > 99 ? '99+' : String(value);
    el.classList.toggle('hidden',!value);
  });
}

function initTransport(endpoint) {
  if (state.transport) state.transport.destroy();
  state.endpoint = endpoint;
  state.transport = new AppsScriptTransport({
    endpoint,
    timeoutMs:APP_CONFIG.transportTimeoutMs,
    expectedContract:APP_CONFIG.apiContract,
    onState:item => setBackendState(Boolean(item.ready),item.message),
    onAuthError:handleSessionExpired,
    onRequestState:setRequestState
  });
  state.api = new PengantaranApi(state.transport,{
    readRetryCount:APP_CONFIG.readRetryCount,
    readRetryDelayMs:APP_CONFIG.readRetryDelayMs,
    loginRetryCount:APP_CONFIG.loginRetryCount,
    loginRetryDelayMs:APP_CONFIG.loginRetryDelayMs,
    mutationReplayWindowMs:APP_CONFIG.mutationReplayWindowMs,
    mutationBusyRetryCount:APP_CONFIG.mutationBusyRetryCount,
    mutationBusyRetryDelayMs:APP_CONFIG.mutationBusyRetryDelayMs
  });
}

async function connectBackend(endpoint=getEndpoint()) {
  if (!endpoint) {
    setBackendState(false,'Layanan belum dikonfigurasi');
    return false;
  }
  initTransport(endpoint);
  try {
    const result = await state.transport.connect();
    state.backendInfo = result?.data || null;
    return true;
  } catch (error) {
    state.backendInfo = null;
    setBackendState(false,error.message);
    if (error?.code === 'VERSION_MISMATCH') showToast(error.message,'warning',9000);
    return false;
  }
}

function openBackendModal() {
  if (state.session && state.session.user?.role !== 'ADMIN') return;
  $('backendUrl').value = getEndpoint();
  showAlert($('backendModalMessage'),'');
  $('backendModal').classList.remove('hidden');
  setTimeout(() => $('backendUrl')?.focus(),50);
}

function closeBackendModal() { $('backendModal').classList.add('hidden'); }

async function saveBackend() {
  const url = $('backendUrl').value.trim();
  if (!url.endsWith('/exec')) {
    showAlert($('backendModalMessage'),'Alamat backend harus berupa deployment Apps Script yang berakhir /exec.');
    return;
  }
  saveEndpoint(url);
  setButtonBusy($('saveBackendSetup'),true,'Menyimpan…');
  showAlert($('backendModalMessage'),'Menguji koneksi…','info');
  const ok = await connectBackend(url);
  setButtonBusy($('saveBackendSetup'),false);
  if (ok) {
    showAlert($('backendModalMessage'),'Koneksi berhasil.','info');
    setTimeout(() => { closeBackendModal(); if (state.session?.user?.role === 'ADMIN' && state.view === 'account') renderAccountPage(); },500);
  } else showAlert($('backendModalMessage'),'Backend belum dapat dihubungi. Periksa deployment dan alamatnya.');
}

function clearLocalSession() {
  farmasi.resetForLogout();
  courier.resetForLogout();
  admin.resetForLogout();
  management.resetForLogout();
  state.session = null;
  state.lastSessionCheck = 0;
  sessionStorage.removeItem(APP_CONFIG.sessionStorageKey);
}

function showLogin(message='') {
  delete document.body.dataset.role;
  clearLocalSession();
  closeModal();
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  if (message) showAlert($('loginMessage'),message,'error');
  setTimeout(() => $('pin')?.focus(),80);
}

function handleSessionExpired() {
  if (state.authResetting) return;
  state.authResetting = true;
  showLogin('Sesi Anda telah berakhir. Silakan masuk kembali.');
  showToast('Sesi berakhir. Silakan masuk kembali.','warning',6000);
  setTimeout(() => { state.authResetting = false; },300);
}

async function recheckSession(force=false) {
  if (!state.session?.token || !state.api || !navigator.onLine) return false;
  const now = Date.now();
  if (!force && now - state.lastSessionCheck < APP_CONFIG.sessionRecheckMs) return true;
  try {
    const result = await state.api.session(state.session.token);
    state.session.user = result.data.user;
    state.lastSessionCheck = now;
    sessionStorage.setItem(APP_CONFIG.sessionStorageKey,JSON.stringify(state.session));
    return true;
  } catch (error) {
    if (error.code === 'SESSION_EXPIRED') handleSessionExpired();
    return false;
  }
}

async function login(event) {
  event.preventDefault();
  showAlert($('loginMessage'),'');
  if (!state.backendReady) {
    const ok = await connectBackend();
    if (!ok) {
      showAlert($('loginMessage'),'Aplikasi belum dapat terhubung ke layanan. Hubungi Admin Data.');
      $('initialSetupLink')?.classList.remove('hidden');
      return;
    }
  }
  const pin = $('pin').value.trim();
  if (!pin) return;
  setButtonBusy($('loginButton'),true,'Masuk…');
  try {
    const result = await state.api.login(pin,{clientId:getClientId(),userAgent:navigator.userAgent,origin:location.origin});
    state.session = {token:result.data.token,user:result.data.user};
    state.lastSessionCheck = Date.now();
    sessionStorage.setItem(APP_CONFIG.sessionStorageKey,JSON.stringify(state.session));
    $('pin').value = '';
    showApp();
    if (result.data?.recoveryOnly) showToast('Mode Pemulihan Akses aktif. Pulihkan Akun & PIN dari Backup Sehat Terakhir sebelum kembali ke operasional normal.','warning',10000);
  } catch (error) {
    showAlert($('loginMessage'),error.message);
  } finally {
    setButtonBusy($('loginButton'),false);
    $('loginButton').textContent = 'Masuk';
  }
}

async function restoreSession() {
  const raw = sessionStorage.getItem(APP_CONFIG.sessionStorageKey);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);
    if (!saved?.token) return false;
    const result = await state.api.session(saved.token);
    state.session = {token:saved.token,user:result.data.user};
    state.lastSessionCheck = Date.now();
    sessionStorage.setItem(APP_CONFIG.sessionStorageKey,JSON.stringify(state.session));
    showApp();
    return true;
  } catch (error) {
    sessionStorage.removeItem(APP_CONFIG.sessionStorageKey);
    if (error?.code === 'SESSION_EXPIRED') showAlert($('loginMessage'),'Sesi sebelumnya telah berakhir. Silakan masuk kembali.','info');
    return false;
  }
}

async function logout() {
  const ok = await confirmAction({title:'Keluar dari aplikasi?',message:'Sesi akun ini akan ditutup.',confirmLabel:'Keluar',tone:'danger'});
  if (!ok) return;
  const token = state.session?.token;
  try { if (token && state.api && navigator.onLine) await state.api.logout(token); } catch (_) {}
  showLogin('');
}

function buildNav() {
  const role = state.session.user.role;
  const items = NAV[role] || NAV.FARMASI;
  $('sideNav').innerHTML = items.map(item => `<button class="nav-item" data-view="${item[0]}"><span class="nav-icon">${navIconSvg(item[1])}</span>${escapeHtml(item[2])}<span class="nav-count-badge hidden" data-nav-badge="${item[0]}"></span></button>`).join('');

  let mobileItems;
  if (role === 'FARMASI') mobileItems = items.filter(item => item[0] !== 'account');
  else if (role === 'ADMIN') mobileItems = items.filter(item => item[0] !== 'account').slice(0,5);
  else mobileItems = items.slice(0,5);
  $('bottomNav').style.setProperty('--nav-count',mobileItems.length);
  $('bottomNav').innerHTML = mobileItems.map(item => `<button data-view="${item[0]}"><span class="nav-mobile-icon">${navIconSvg(item[1])}</span>${escapeHtml(item[2])}<span class="nav-count-badge hidden" data-nav-badge="${item[0]}"></span></button>`).join('');
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => openView(button.dataset.view)));
}

function showApp() {
  const user = state.session.user;
  user.role = String(user.role || '').trim().toUpperCase();
  document.body.dataset.role = user.role;
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('sideUserName').textContent = user.name;
  $('sideUserRole').textContent = displayRole(user.role);
  $('roleChip').textContent = displayRole(user.role);
  $('avatar').textContent = initials(user.name);
  $('sidebarBackendButton')?.classList.toggle('hidden',user.role !== 'ADMIN');
  buildNav();
  openView('home');
}

function openView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view === view));
  const role = String(state.session?.user?.role || '').toUpperCase();
  const meta = PAGE_META[view] || ['Menu','MELESAT · Pengantaran Obat'];
  $('pageTitle').textContent = role === 'MANAJEMEN' && view === 'home' ? 'Ringkasan' : meta[0];
  $('pageSubtitle').textContent = role === 'MANAJEMEN' && view === 'home' ? 'Key Performance Indicator (KPI) layanan' : meta[1];
  const contextLabel = role === 'MANAJEMEN' ? 'DASHBOARD MANAJEMEN' : role === 'ADMIN' ? 'ADMIN DATA' : role === 'FARMASI' ? 'FARMASI' : role === 'KURIR' ? 'KURIR' : 'LAYANAN INTERNAL';
  if ($('mobileContext')) $('mobileContext').textContent = contextLabel;
  $('pageContent').innerHTML = '';
  window.scrollTo({top:0,behavior:'auto'});

  if (role === 'FARMASI') {
    if (view === 'home') return farmasi.renderHome();
    if (view === 'registration') return farmasi.renderRegistration();
    if (view === 'today') return farmasi.renderToday();
    if (view === 'verification') return farmasi.renderVerification();
    if (view === 'followup') return farmasi.renderFollowUp();
    if (view === 'labels') return farmasi.renderLabels();
  }
  if (role === 'KURIR') {
    if (view === 'home') return courier.renderHome();
    if (view === 'ready') return courier.renderReady();
    if (view === 'tasks') return courier.renderTasks();
    if (view === 'history') return courier.renderHistory();
  }
  if (role === 'ADMIN') {
    if (view === 'home') return admin.renderHome();
    if (view === 'corrections') return admin.renderCorrections();
    if (view === 'archive') return admin.renderArchive();
    if (view === 'master') return admin.renderMaster();
    if (view === 'audit') return admin.renderAudit();
  }
  if (role === 'MANAJEMEN') {
    if (view === 'home') return management.renderHome();
    if (view === 'performance') return management.renderPerformance();
    if (view === 'areas') return management.renderAreas();
    if (view === 'reports') return management.renderReports();
  }
  if (view === 'account') return renderAccountPage();
}

function renderAccountPage() {
  const user = state.session.user;
  const recoveryNote = user.recoveryOnly ? `<div class="system-alert warning"><strong>Mode Pemulihan Akses</strong><span>Sesi ini hanya untuk pemulihan. Pulihkan Akun & PIN terlebih dahulu agar akses Admin kembali normal.</span></div>` : '';
  const adminTechnical = user.role === 'ADMIN' ? `<div class="account-section"><div class="section-heading"><div><h2>Koneksi Sistem</h2><p>Informasi teknis hanya tersedia untuk Admin Data.</p></div></div><div class="grid grid-2"><div class="card account-card"><span>Frontend</span><strong>${escapeHtml(APP_CONFIG.version)}</strong><small>PWA</small></div><div class="card account-card"><span>Backend</span><strong>${escapeHtml(state.backendInfo?.version || '-')}</strong><small>${escapeHtml(state.backendInfo?.apiContract || APP_CONFIG.apiContract)}</small></div><div class="card account-card"><span>Status</span><strong>${state.backendReady?'Terhubung':'Tidak terhubung'}</strong><small>${navigator.onLine?'Perangkat online':'Perangkat offline'}</small></div><div class="card account-card"><span>Backend aktif</span><strong class="technical-url">${escapeHtml(getEndpoint() || '-')}</strong><small>${APP_CONFIG.backendUrl?'Konfigurasi produksi':'Konfigurasi browser'}</small></div></div><div class="account-actions"><button id="accountBackendSettings" class="secondary-btn">Pengaturan Koneksi</button>${localStorage.getItem(APP_CONFIG.backendStorageKey) && APP_CONFIG.backendUrl ? '<button id="accountResetBackend" class="secondary-btn">Kembali ke Backend Produksi</button>' : ''}</div></div>` : '';

  $('pageContent').innerHTML = `<section class="account-hero"><div class="account-avatar">${escapeHtml(initials(user.name))}</div><div><div class="eyebrow">AKUN</div><h1>${escapeHtml(user.name)}</h1><p>${escapeHtml(displayRole(user.role))}${user.email?` • ${escapeHtml(user.email)}`:''}</p></div></section>${recoveryNote}<section class="section account-layout"><div class="card account-main"><div class="account-detail"><span>Nama</span><strong>${escapeHtml(user.name)}</strong></div><div class="account-detail"><span>Role</span><strong>${escapeHtml(displayRole(user.role))}</strong></div>${user.email?`<div class="account-detail"><span>Email</span><strong>${escapeHtml(user.email)}</strong></div>`:''}</div>${adminTechnical}<button id="accountLogout" class="danger-outline-btn account-logout">Keluar dari Aplikasi</button></section>`;
  $('accountLogout')?.addEventListener('click',logout);
  $('accountBackendSettings')?.addEventListener('click',openBackendModal);
  $('accountResetBackend')?.addEventListener('click',async() => {
    clearEndpointOverride();
    const ok = await connectBackend(APP_CONFIG.backendUrl);
    showToast(ok?'Kembali menggunakan backend produksi.':'Backend produksi belum dapat dihubungi.',ok?'success':'error');
    renderAccountPage();
  });
}

const farmasi = createFarmasiModule({
  escapeHtml,
  getApi:() => state.api,
  getToken:() => state.session?.token || '',
  getUser:() => state.session?.user || null,
  getView:() => state.view,
  navigate:openView,
  openModal,
  closeModal,
  confirmAction,
  showToast,
  setNavBadge,
  setButtonBusy
});

const courier = createCourierModule({
  escapeHtml,
  getApi:() => state.api,
  getToken:() => state.session?.token || '',
  getUser:() => state.session?.user || null,
  getView:() => state.view,
  navigate:openView,
  openModal,
  closeModal,
  confirmAction,
  showToast,
  setButtonBusy
});

const admin = createAdminModule({
  escapeHtml,
  getApi:() => state.api,
  getToken:() => state.session?.token || '',
  getUser:() => state.session?.user || null,
  getView:() => state.view,
  navigate:openView,
  openModal,
  closeModal,
  confirmAction,
  showToast,
  setButtonBusy,
  refreshSession:() => recheckSession(true)
});

const management = createManagementModule({
  escapeHtml,
  getApi:() => state.api,
  getToken:() => state.session?.token || '',
  getUser:() => state.session?.user || null,
  getView:() => state.view,
  navigate:openView,
  openModal,
  closeModal,
  confirmAction,
  showToast,
  setButtonBusy,
  minimumStatsSample:APP_CONFIG.statsMinimumSample
});

function showUpdateAvailable(registration) {
  state.updateRegistration = registration || state.updateRegistration;
  $('updateBanner')?.classList.remove('hidden');
}

function hideUpdateAvailable() { $('updateBanner')?.classList.add('hidden'); }

async function applyAppUpdate() {
  const registration = state.updateRegistration || await navigator.serviceWorker.getRegistration();
  if (!registration?.waiting) { hideUpdateAvailable(); location.reload(); return; }
  state.updateRequested = true;
  setButtonBusy($('applyUpdateButton'),true,'Memperbarui…');
  registration.waiting.postMessage({type:'SKIP_WAITING'});
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.register('./sw.js?v=1.0.0',{updateViaCache:'none'});
  state.updateRegistration = registration;
  if (registration.waiting && navigator.serviceWorker.controller) showUpdateAvailable(registration);
  registration.addEventListener('updatefound',() => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange',() => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateAvailable(registration);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange',() => { if (state.updateRequested) location.reload(); });
  try { await registration.update(); } catch (_) {}
}

async function boot() {
  $('initialSetupLink')?.addEventListener('click',openBackendModal);
  $('sidebarBackendButton')?.addEventListener('click',openBackendModal);
  $('closeBackendSetup')?.addEventListener('click',closeBackendModal);
  $('saveBackendSetup')?.addEventListener('click',saveBackend);
  $('backendModal')?.addEventListener('click',event => { if (event.target === $('backendModal')) closeBackendModal(); });
  $('appModal')?.addEventListener('click',event => { if (event.target === $('appModal')) closeModal(); });
  $('loginForm')?.addEventListener('submit',login);
  $('logoutButton')?.addEventListener('click',logout);
  $('avatarButton')?.addEventListener('click',() => { if (state.session) openView('account'); });
  $('togglePin')?.addEventListener('click',() => {
    const input = $('pin'); const button = $('togglePin'); const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-label', show ? 'Sembunyikan PIN' : 'Tampilkan PIN');
    button.setAttribute('title', show ? 'Sembunyikan PIN' : 'Tampilkan PIN');
    button.innerHTML = show
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.7 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16.3 16.3 0 0 1-3.2 3.8"/><path d="M6.2 6.3C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.5 9.5 0 0 0 2.6-.4"/><path d="M10.2 10.2a2.8 2.8 0 0 0 3.6 3.6"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  });
  $('applyUpdateButton')?.addEventListener('click',applyAppUpdate);

  window.addEventListener('offline',() => {
    updateConnectivity();
    showToast('Koneksi internet terputus. Aksi baru belum dapat dikirim.','warning',7000);
  });
  window.addEventListener('online',async() => {
    updateConnectivity();
    showToast('Koneksi internet kembali.','info');
    if (getEndpoint()) await connectBackend(getEndpoint());
    if (state.session) await recheckSession(true);
  });
  document.addEventListener('visibilitychange',() => {
    if (document.visibilityState !== 'visible' || !state.session) return;
    recheckSession(false);
    if (String(state.session?.user?.role || '').toUpperCase() === 'FARMASI' && typeof farmasi.refreshVisibleData === 'function') {
      farmasi.refreshVisibleData({silent:true}).catch(() => {});
    }
  });

  updateConnectivity();
  const endpoint = getEndpoint();
  if (endpoint && navigator.onLine) await connectBackend(endpoint);
  const restored = state.backendReady ? await restoreSession() : false;
  if (!restored) $('loginView').classList.remove('hidden');
  $('loading').classList.add('hidden');
  if (!endpoint) $('initialSetupLink')?.classList.remove('hidden');
  registerServiceWorker().catch(() => {});
}

window.addEventListener('unhandledrejection',event => {
  const error = event.reason;
  if (error?.code === 'SESSION_EXPIRED') return;
  console.error('[Pengantaran Obat]',error?.code || 'ERROR',error?.message || String(error));
});

boot();
