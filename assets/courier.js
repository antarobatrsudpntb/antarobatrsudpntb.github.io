export function createCourierModule(ctx) {
  const state = {
    loaded: false,
    loading: null,
    master: null,
    ready: [],
    mine: [],
    history: [],
    historyLoaded: false,
    historyLoading: null,
    activeIncident: null,
    search: '',
    timer: null
  };

  const esc = ctx.escapeHtml;
  const api = () => ctx.getApi();
  const token = () => ctx.getToken();
  const page = () => document.getElementById('pageContent');

  function resetForLogout() {
    if (state.timer) clearInterval(state.timer);
    state.loaded = false;
    state.loading = null;
    state.master = null;
    state.ready = [];
    state.mine = [];
    state.history = [];
    state.historyLoaded = false;
    state.historyLoading = null;
    state.activeIncident = null;
    state.search = '';
    state.timer = null;
  }

  async function ensureData(force = false) {
    if (state.loaded && !force) return state;
    if (state.loading && !force) return state.loading;
    state.loading = (async () => {
      const res = await api().courierBootstrap(token());
      const data = res.data || {};
      state.master = data.master || {};
      state.ready = Array.isArray(data.ready) ? data.ready : [];
      state.mine = Array.isArray(data.mine) ? data.mine : [];
      if (Array.isArray(data.history)) { state.history = data.history; state.historyLoaded = true; }
      state.activeIncident = data.activeIncident || null;
      state.loaded = true;
      startAutoRefresh();
      if (data.historyDeferred === true && !state.historyLoaded) loadHistoryBackground().catch(() => {});
      return state;
    })();
    try { return await state.loading; }
    finally { state.loading = null; }
  }

  async function loadHistoryBackground(force = false) {
    if (state.historyLoaded && !force) return state.history;
    if (state.historyLoading && !force) return state.historyLoading;
    state.historyLoading = (async () => {
      const history = await api().courierHistory(token(), 50);
      state.history = Array.isArray(history.data?.rows) ? history.data.rows : [];
      state.historyLoaded = true;
      if (ctx.getView() === 'home') renderHomeData();
      if (ctx.getView() === 'history') renderHistoryData();
      return state.history;
    })();
    try { return await state.historyLoading; } finally { state.historyLoading = null; }
  }

  async function refreshRows({includeHistory = false, silent = false} = {}) {
    try {
      const res = await api().courierRows(token());
      const data = res.data || {};
      state.ready = Array.isArray(data.ready) ? data.ready : [];
      state.mine = Array.isArray(data.mine) ? data.mine : [];
      state.activeIncident = data.activeIncident || null;
      if (includeHistory) await loadHistoryBackground(true);
      rerenderVisibleData();
      return state;
    } catch (err) {
      if (!silent) ctx.showToast(err.message, 'error');
      throw err;
    }
  }

  function startAutoRefresh() {
    if (state.timer) return;
    state.timer = setInterval(() => {
      if (!token()) return;
      const view = ctx.getView();
      if (!['home','ready','tasks'].includes(view)) return;
      refreshRows({silent:true}).catch(() => {});
    }, 30000);
  }

  function rerenderVisibleData() {
    const view = ctx.getView();
    if (view === 'home') renderHomeData();
    if (view === 'ready') renderReadyData();
    if (view === 'tasks') renderTasksData();
    if (view === 'history') renderHistoryData();
  }

  function metric(label, value, note, icon, tone = '') {
    return `<div class="card metric-card ${tone}"><div class="metric-top"><span>${esc(label)}</span><b>${esc(icon || '')}</b></div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></div>`;
  }

  function badge(text, cls = 'neutral') {
    return `<span class="status-badge ${cls}">${esc(text || '-')}</span>`;
  }

  function statusClass(status) {
    if (status === 'SIAP DIANTAR') return 'ready';
    if (status === 'DALAM PERJALANAN') return 'transit';
    if (status === 'TERKIRIM') return 'delivered';
    if (status === 'GAGAL ANTAR') return 'failed';
    return 'neutral';
  }

  function shortId(id) {
    const s = String(id || '');
    return s.length > 12 ? `${s.slice(0,5)}…${s.slice(-6)}` : s;
  }

  function timeOnly(value) {
    const s = String(value || '');
    const match = s.match(/(\d{2}:\d{2})(?::\d{2})?$/);
    return match ? match[1] : (s || '-');
  }

  function safeHref(url) {
    const raw = String(url || '').trim();
    if (/^https:\/\//i.test(raw) || /^tel:\+?\d+/i.test(raw)) return raw;
    return '#';
  }

  function areaText(r) {
    return [r.village, r.district, r.region].filter(Boolean).join(' • ') || '-';
  }

  async function renderHome() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">KURIR</div><h1>Pengantaran Hari Ini</h1><p>Ambil paket sesuai arah perjalanan, buka navigasi, hubungi penerima, dan selesaikan pengantaran dengan verifikasi penerimaan.</p></div><div class="hero-actions"><button id="courierHomeRefresh" class="secondary-btn">↻ Segarkan</button></div></section>
      <section class="section"><div id="courierHomeIncident"></div><div id="courierMetrics" class="grid grid-4"><div class="inline-loading">Memuat…</div></div></section>
      <section class="section"><div class="section-heading"><div><h2>Fokus Sekarang</h2><p>Aksi yang paling sering dibutuhkan Kurir.</p></div></div><div id="courierFocus" class="grid grid-2"></div></section>
      <section class="section"><div class="section-heading"><div><h2>Wilayah Siap Terbanyak</h2><p>Membantu memilih paket yang searah dengan perjalanan.</p></div></div><div id="courierRouteSummary" class="grid grid-3"></div></section>`;
    document.getElementById('courierHomeRefresh')?.addEventListener('click', async e => {
      setBusy(e.currentTarget, true, 'Memuat…');
      try { await refreshRows({includeHistory:true}); ctx.showToast('Data Kurir diperbarui.', 'success'); }
      finally { setBusy(e.currentTarget, false); }
    });
    try { await ensureData(); renderHomeData(); }
    catch (err) { page().innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  }

  function renderHomeData() {
    const metrics = document.getElementById('courierMetrics');
    if (!metrics) return;
    metrics.innerHTML = [
      metric('Siap Diambil', state.ready.length, 'Paket tersedia', '◎', 'tone-ready'),
      metric('Tugas Aktif', state.mine.length, 'Sedang dibawa', '➜', 'tone-transit'),
      metric('Selesai Hari Ini', state.historyLoaded ? state.history.length : '…', state.historyLoaded ? 'Riwayat kurir' : 'Memuat riwayat', '✓', 'tone-success'),
      metric('Kendala Aktif', state.activeIncident ? 1 : 0, state.activeIncident ? state.activeIncident.type : 'Tidak ada', '⚠', state.activeIncident ? 'tone-warning' : '')
    ].join('');
    const incident = document.getElementById('courierHomeIncident');
    if (incident) incident.innerHTML = incidentBanner();
    const focus = document.getElementById('courierFocus');
    if (focus) focus.innerHTML = `<button class="attention-card" id="focusReady"><span class="attention-icon">◎</span><span><strong>${state.ready.length} paket siap diambil</strong><small>Pilih paket yang searah dengan rute Anda.</small></span><b>›</b></button>
      <button class="attention-card ${state.mine.length ? 'warn' : ''}" id="focusTasks"><span class="attention-icon">➜</span><span><strong>${state.mine.length} tugas sedang aktif</strong><small>${state.mine.length ? 'Lanjutkan pengantaran yang sudah diambil.' : 'Belum ada tugas aktif.'}</small></span><b>›</b></button>`;
    document.getElementById('focusReady')?.addEventListener('click', () => ctx.navigate('ready'));
    document.getElementById('focusTasks')?.addEventListener('click', () => ctx.navigate('tasks'));

    const summary = document.getElementById('courierRouteSummary');
    if (summary) {
      const groups = routeGroups(state.ready).slice(0, 6);
      summary.innerHTML = groups.length ? groups.map(g => `<div class="card route-summary-card"><div class="route-summary-place"><strong>${esc(g.village || '-')}</strong><span>${esc(g.district || g.region || 'Wilayah')}</span></div><div class="route-summary-count"><b>${g.count}</b><span>paket siap</span></div></div>`).join('') : `<div class="content-card empty-state"><div>✓</div><h3>Belum ada antrean siap</h3><p>Paket baru akan muncul setelah Farmasi menandai obat siap diantar.</p></div>`;
    }
    bindIncidentResolveButton();
  }

  async function renderReady() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">SIAP DIAMBIL</div><h1>Pilih Rute yang Sejalan</h1><p>Cocokkan nama pasien, kode paket, dan wilayah sebelum mengambil tugas.</p></div><div class="hero-actions"><button id="readyRefresh" class="secondary-btn">↻ Segarkan</button></div></section>
      <section class="section"><div class="toolbar-card"><div class="search-box"><span>⌕</span><input id="readySearch" placeholder="Cari kelurahan, kecamatan, kota…" value="${esc(state.search)}"></div></div><div id="readyContent"><div class="inline-loading">Memuat antrean…</div></div></section>`;
    const search = document.getElementById('readySearch');
    search?.addEventListener('input', () => { state.search = search.value; renderReadyData(); });
    document.getElementById('readyRefresh')?.addEventListener('click', async e => {
      setBusy(e.currentTarget, true, 'Memuat…');
      try { await refreshRows(); ctx.showToast('Antrean siap diperbarui.', 'success'); }
      finally { setBusy(e.currentTarget, false); }
    });
    try { await ensureData(); renderReadyData(); }
    catch (err) { document.getElementById('readyContent').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  }

  function renderReadyData() {
    const box = document.getElementById('readyContent');
    if (!box) return;
    const q = state.search.trim().toLowerCase();
    const rows = state.ready.filter(r => !q || areaText(r).toLowerCase().includes(q) || String(r.id).toLowerCase().includes(q) || String(r.packageCode||'').toLowerCase().includes(q) || String(r.name||'').toLowerCase().includes(q));
    if (!rows.length) {
      box.innerHTML = `<div class="content-card empty-state"><div>◎</div><h3>Tidak ada paket sesuai pencarian</h3><p>${state.ready.length ? 'Coba kata kunci wilayah lain.' : 'Belum ada obat berstatus SIAP DIANTAR.'}</p></div>`;
      return;
    }
    const groups = routeGroups(rows);
    box.innerHTML = `<div class="route-groups">${groups.map(g => `<section class="route-group"><div class="route-group-head"><div><div class="eyebrow">${esc(g.district || g.region || 'WILAYAH')}</div><h3>${esc(g.village || '-')}</h3><p>${esc(g.region || '')}</p></div><span>${g.items.length} paket</span></div><div class="ready-card-grid">${g.items.map(r => `<article class="ready-route-card"><div class="ready-route-top"><strong class="package-code">${esc(r.packageCode || shortId(r.id))}</strong><div>${r.isRetry?`<span class="retry-chip">PENGANTARAN KE-${Number(r.attemptNo||2)}</span>`:''}</div></div><h4 class="ready-patient-name">${esc(r.name || '-')}</h4><div class="ready-location-block"><span>LOKASI</span><h4>${esc(r.village || '-')}</h4><p>${esc([r.district,r.region].filter(Boolean).join(' • ') || '-')}</p><small>Siap ${esc(timeOnly(r.readyAt))}${r.coverageStatus ? ` • ${esc(r.coverageStatus)}` : ''}</small></div>${r.courierNote?`<div class="courier-note-preview"><span>CATATAN FARMASI</span><p>${esc(r.courierNote)}</p></div>`:''}<button class="primary-btn ready-claim-btn" data-claim="${esc(r.id)}">Ambil Tugas</button></article>`).join('')}</div></section>`).join('')}</div>`;
    box.querySelectorAll('[data-claim]').forEach(btn => btn.addEventListener('click', () => claimReady(btn.dataset.claim, btn)));
  }

  function routeGroups(rows) {
    const map = new Map();
    rows.forEach(r => {
      const key = [r.region,r.district,r.village].join('|');
      if (!map.has(key)) map.set(key, {region:r.region,district:r.district,village:r.village,count:0,items:[]});
      const g = map.get(key); g.count += 1; g.items.push(r);
    });
    return [...map.values()].sort((a,b) => b.count - a.count || String(a.village).localeCompare(String(b.village)));
  }

  async function claimReady(id, button) {
    const r = state.ready.find(x => x.id === id);
    if (!r) return ctx.showToast('Paket tidak ditemukan. Segarkan antrean.', 'error');
    const ok = await ctx.confirmAction({
      title:'Ambil tugas pengantaran',
      message:`Pastikan paket ${r.packageCode || shortId(r.id)} atas nama ${r.name || '-'} sesuai label fisik.\n\nWilayah: ${areaText(r)}\nSiap: ${timeOnly(r.readyAt)}\n\nNo. RM, nomor WA, dan alamat lengkap baru terbuka setelah tugas diambil.`,
      confirmLabel:'Ya, Ambil Tugas'
    });
    if (!ok) return;
    setBusy(button, true, 'Mengambil…');
    try {
      const res = await api().claimTask(token(), id);
      state.ready = state.ready.filter(x => x.id !== id);
      if (res.data?.record) state.mine = [res.data.record, ...state.mine.filter(x => x.id !== id)];
      ctx.showToast('Tugas berhasil diambil.', 'success');
      if (res.data?.waAction) openWaAction(res.data.waAction, 'Beritahu pasien bahwa obat mulai diantar');
      setTimeout(() => ctx.navigate('tasks'), 120);
    } catch (err) {
      ctx.showToast(err.message, 'error');
      await refreshRows({silent:true}).catch(() => {});
    } finally { setBusy(button, false); }
  }

  async function renderTasks() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">TUGAS SAYA</div><h1>Pengantaran Aktif</h1><p>Kelola paket yang sedang Anda bawa.</p></div><div class="hero-actions"><button id="reportIncidentTop" class="warning-btn">⚠ Laporkan Kendala</button><button id="tasksRefresh" class="secondary-btn">↻ Segarkan</button></div></section>
      <section class="section"><div id="taskIncident"></div><div id="taskContent"><div class="inline-loading">Memuat tugas aktif…</div></div></section>`;
    document.getElementById('reportIncidentTop')?.addEventListener('click', openIncidentReport);
    document.getElementById('tasksRefresh')?.addEventListener('click', async e => {
      setBusy(e.currentTarget, true, 'Memuat…');
      try { await refreshRows(); ctx.showToast('Tugas aktif diperbarui.', 'success'); }
      finally { setBusy(e.currentTarget, false); }
    });
    try { await ensureData(); renderTasksData(); }
    catch (err) { document.getElementById('taskContent').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  }

  function renderTasksData() {
    const incident = document.getElementById('taskIncident');
    if (incident) incident.innerHTML = incidentBanner();
    const box = document.getElementById('taskContent');
    if (!box) return;
    bindIncidentResolveButton();
    if (!state.mine.length) {
      box.innerHTML = `<div class="content-card empty-state"><div>➜</div><h3>Belum ada tugas aktif</h3><p>Buka menu Siap dan ambil paket berdasarkan rute yang akan dilalui.</p><button id="goReadyFromEmpty" class="primary-btn empty-action">Lihat Paket Siap</button></div>`;
      document.getElementById('goReadyFromEmpty')?.addEventListener('click', () => ctx.navigate('ready'));
      return;
    }
    box.innerHTML = `<div class="courier-task-grid">${state.mine.map(taskCard).join('')}</div>`;
    box.querySelectorAll('[data-complete]').forEach(btn => btn.addEventListener('click', () => openCompletion(btn.dataset.complete)));
    box.querySelectorAll('[data-pending]').forEach(btn => btn.addEventListener('click', () => openPending(btn.dataset.pending)));
    box.querySelectorAll('[data-fail]').forEach(btn => btn.addEventListener('click', () => openFailure(btn.dataset.fail)));
    box.querySelectorAll('[data-resume]').forEach(btn => btn.addEventListener('click', () => resumePending(btn.dataset.resume, btn)));
  }

  function taskCard(r) {
    const maps = safeHref(r.mapsUrl), wa = safeHref(r.waUrl), phone = safeHref(r.phoneUrl);
    const failed = Boolean(r.failureReported);
    const pending = Boolean(r.pending) && !failed;
    const statusHtml = failed ? `${badge('GAGAL ANTAR','failed')}${r.incidentStatus === 'TERKENDALA' ? ` ${badge('TERKENDALA','warning')}` : ''}` : pending ? `${badge('PENDING','warning')}${r.incidentStatus === 'TERKENDALA' ? ` ${badge('TERKENDALA','warning')}` : ''}` : `${badge(r.status,statusClass(r.status))}${r.incidentStatus === 'TERKENDALA' ? ` ${badge('TERKENDALA','warning')}` : ''}`;
    const stateBox = failed ? `<div class="failure-reported-box"><strong>⚠ Gagal Antar</strong><p>${esc(r.failureReason||'Kendala pengantaran')}${r.failureDetail?` • ${esc(r.failureDetail)}`:''}</p><small>Pengantaran hari ini selesai. Kembalikan obat ke Farmasi untuk konfirmasi pengembalian dan tindak lanjut berikutnya.</small></div>` : pending ? `<div class="pending-delivery-box"><strong>⏸ PENDING</strong><p>${esc(r.pendingReason||'Pengantaran belum dapat diselesaikan')}${r.pendingDetail?` • ${esc(r.pendingDetail)}`:''}</p><small>Paket tetap dibawa oleh Kurir. Lanjutkan bila akan mencoba pengantaran kembali hari ini, atau pilih Gagal Antar bila sudah tidak memungkinkan.</small></div>` : '';
    const mainActions = failed ? `<div class="task-main-actions"><span class="return-reminder">Kembalikan obat ke Farmasi</span></div>` : pending ? `<div class="task-main-actions"><button class="primary-btn" data-resume="${esc(r.id)}">↻ Lanjut Antar</button><button class="danger-soft-btn" data-fail="${esc(r.id)}">Gagal Antar</button></div>` : `<div class="task-main-actions"><button class="primary-btn" data-complete="${esc(r.id)}">✓ Selesaikan Pengantaran</button><button class="pending-btn" data-pending="${esc(r.id)}">⏸ Pending</button><button class="danger-soft-btn" data-fail="${esc(r.id)}">Gagal Antar</button></div>`;
    return `<article class="courier-task-card ${r.incidentStatus === 'TERKENDALA' ? 'has-incident' : ''} ${failed?'failure-reported':''} ${pending?'pending-active':''}"><div class="task-card-head"><div>${statusHtml}</div><small class="package-code">${esc(r.packageCode || shortId(r.id))}</small></div>${r.isRetry?`<span class="retry-chip task-retry">PENGANTARAN KE-${Number(r.attemptNo||2)}</span>`:''}<h3>${esc(r.name || '-')}</h3><div class="task-area">${esc(areaText(r))}</div>${r.courierNote?`<div class="courier-note-task"><span>CATATAN FARMASI</span><p>${esc(r.courierNote)}</p></div>`:''}<div class="task-address"><span>Alamat</span><strong>${esc(r.address || '-')}</strong>${r.landmark ? `<p><b>Patokan:</b> ${esc(r.landmark)}</p>` : ''}</div><div class="task-meta"><span>Penerima rencana</span><b>${esc(r.plannedRecipient || r.name || '-')}</b><span>Diambil</span><b>${esc(timeOnly(r.claimedAt))}</b></div><div class="contact-actions"><a class="contact-btn maps" href="${esc(maps)}" target="_blank" rel="noopener">⌖ Maps</a><a class="contact-btn wa" href="${esc(wa)}" target="_blank" rel="noopener">WA</a><a class="contact-btn phone" href="${esc(phone)}">☎ Telepon</a></div>${stateBox}${mainActions}</article>`;
  }

  async function resumePending(id, button) {
    const ok = await ctx.confirmAction({title:'Lanjut antar?',message:'Status Pending akan ditutup. Gunakan saat Anda akan mencoba kembali pengantaran hari ini.',confirmLabel:'Ya, Lanjut Antar'});
    if(!ok) return;
    setBusy(button,true,'Melanjutkan…');
    try{const res=await api().resumeDelivery(token(),id);if(res.data?.record)state.mine=state.mine.map(x=>String(x.id)===String(id)?res.data.record:x);else state.mine=state.mine.map(x=>String(x.id)===String(id)?Object.assign({},x,{pending:false,pendingReason:'',pendingDetail:'',pendingSince:''}):x);renderTasksData();ctx.showToast('Pending ditutup. Pengantaran dilanjutkan.','success');setTimeout(()=>refreshRows({silent:true}).catch(()=>{}),160);}
    catch(err){ctx.showToast(err.message,'error');setTimeout(()=>refreshRows({silent:true}).catch(()=>{}),160);}
    finally{setBusy(button,false);}
  }

  function incidentBanner() {
    const i = state.activeIncident;
    if (!i) return '';
    return `<div class="incident-banner"><div><span>⚠ KENDALA AKTIF</span><strong>${esc(i.type || 'Kendala Kurir')}</strong><p>${esc(i.detail || '')}${i.delayEstimate ? ` • Perkiraan keterlambatan ${esc(i.delayEstimate)}` : ''}</p><small>${Number(i.affectedCount || 0)} paket terdampak</small></div><button class="secondary-btn" id="resolveIncidentBtn">Selesaikan Kendala</button></div>`;
  }

  function bindIncidentResolveButton() {
    document.getElementById('resolveIncidentBtn')?.addEventListener('click', openResolveIncident);
  }


  function openCompletion(id) {
    const r = state.mine.find(x => x.id === id);
    if (!r) return ctx.showToast('Tugas tidak ditemukan. Segarkan halaman.', 'error');
    const relations = optionList(state.master?.receiptRelationships || []);
    const noCodeReasons = optionList(state.master?.noCodeReasons || []);
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">VERIFIKASI PENERIMAAN</div><h3>Selesaikan Pengantaran</h3><p>${esc(r.name)} • ${esc(r.village)}</p></div><button class="modal-x" data-modal-close>×</button></div>
      <div class="notice-box">Minta kode penerimaan hanya setelah obat benar-benar sudah berada di tangan pasien/penerima.</div>
      <div class="form-grid two modal-form"><label><span>Nama penerima aktual *</span><input id="finishRecipient" value="${esc(r.plannedRecipient || r.name || '')}" autocomplete="off"></label><label><span>Hubungan penerima *</span><select id="finishRelation"><option value="">Pilih hubungan</option>${relations}</select></label></div>
      <div class="delivery-mode"><label class="mode-card active"><input type="radio" name="finishMode" value="CODE" checked><span><b>Dengan kode</b><small>Verifikasi langsung selesai</small></span></label><label class="mode-card"><input type="radio" name="finishMode" value="NO_CODE"><span><b>Tanpa kode</b><small>Masuk verifikasi manual Farmasi</small></span></label></div>
      <div id="finishCodeBox" class="finish-mode-box"><label><span>Kode penerimaan 4 digit *</span><input id="finishCode" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="••••" autocomplete="off"></label></div>
      <div id="finishNoCodeBox" class="finish-mode-box hidden"><label><span>Alasan tanpa kode *</span><select id="finishNoCode"><option value="">Pilih alasan</option>${noCodeReasons}</select></label></div>
      <div id="finishMessage"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="finishSubmit" class="primary-btn">Simpan Pengantaran</button></div>`);
    const updateMode = () => {
      const mode = document.querySelector('input[name="finishMode"]:checked')?.value || 'CODE';
      document.getElementById('finishCodeBox')?.classList.toggle('hidden', mode !== 'CODE');
      document.getElementById('finishNoCodeBox')?.classList.toggle('hidden', mode !== 'NO_CODE');
      document.querySelectorAll('.mode-card').forEach(el => el.classList.toggle('active', el.querySelector('input')?.checked));
    };
    document.querySelectorAll('input[name="finishMode"]').forEach(el => el.addEventListener('change', updateMode));
    document.getElementById('finishSubmit')?.addEventListener('click', () => submitCompletion(id));
  }

  async function submitCompletion(id) {
    const recipientName = document.getElementById('finishRecipient')?.value.trim() || '';
    const relationship = document.getElementById('finishRelation')?.value || '';
    const mode = document.querySelector('input[name="finishMode"]:checked')?.value || 'CODE';
    const code = String(document.getElementById('finishCode')?.value || '').replace(/\D/g,'').slice(0,4);
    const noCodeReason = document.getElementById('finishNoCode')?.value || '';
    const msg = document.getElementById('finishMessage');
    if (!recipientName || !relationship || (mode === 'CODE' && code.length !== 4) || (mode === 'NO_CODE' && !noCodeReason)) {
      if (msg) msg.innerHTML = `<div class="alert error">Lengkapi nama penerima, hubungan, dan ${mode === 'CODE' ? 'kode 4 digit' : 'alasan tanpa kode'}.</div>`;
      return;
    }
    const button = document.getElementById('finishSubmit'); setBusy(button,true,'Menyimpan…');
    try {
      const res = await api().completeVerified(token(), id, {recipientName,relationship,mode,code,noCodeReason});
      const data = res.data || {};
      if (data.codeInvalid || data.codeLocked) {
        if (msg) msg.innerHTML = `<div class="alert error">${esc(data.backendMessage || res.message || 'Kode tidak sesuai.')}${data.codeInvalid ? `<br>Sisa percobaan: ${Number(data.attemptsRemaining || 0)}` : ''}</div>`;
        if (data.codeLocked) {
          const noCodeRadio = document.querySelector('input[name="finishMode"][value="NO_CODE"]');
          if (noCodeRadio) { noCodeRadio.checked = true; noCodeRadio.dispatchEvent(new Event('change')); }
        }
        return;
      }
      ctx.closeModal();
      // Respons mutasi sudah menjadi sumber kebenaran. Perbarui kartu segera agar Kurir tidak menunggu read ulang.
      state.mine = state.mine.filter(item => String(item.id) !== String(id));
      renderTasksData();
      ctx.showToast(data.verificationPending ? 'Penyerahan disimpan. Menunggu verifikasi manual Farmasi.' : 'Pengantaran selesai dan terverifikasi.', data.verificationPending ? 'warning' : 'success');
      if (data.waAction) openWaAction(data.waAction, data.verificationPending ? 'Beritahu pasien tentang verifikasi lanjutan' : 'Kirim konfirmasi pengantaran');
      setTimeout(() => refreshRows({includeHistory:true, silent:true}).catch(() => {}), 120);
    } catch (err) {
      if (msg) msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    } finally { setBusy(button,false); }
  }

  function openPending(id) {
    const r = state.mine.find(x => x.id === id);
    if (!r) return ctx.showToast('Tugas tidak ditemukan. Segarkan halaman.', 'error');
    if (r.failureReported) return ctx.showToast('Tugas sudah dinyatakan Gagal Antar dan harus dikembalikan ke Farmasi.', 'warning');
    if (r.pending) return ctx.showToast('Tugas sudah berstatus Pending.', 'warning');
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">PENDING</div><h3>Pending Pengantaran</h3><p>${esc(r.name)} • ${esc(r.village)}</p></div><button class="modal-x" data-modal-close>×</button></div><div class="notice-box">Gunakan bila pengantaran belum dapat diselesaikan dan masih mungkin dicoba kembali hari ini.</div><div class="form-grid modal-form"><label><span>Alasan pending *</span><select id="pendingReason"><option value="">Pilih alasan</option>${optionList(state.master?.failureReasons || [])}</select></label><label><span>Catatan tambahan <small>opsional</small></span><textarea id="pendingDetail" rows="3" placeholder="Keterangan singkat bila diperlukan"></textarea></label></div><div id="pendingMessage"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="pendingSubmit" class="warning-btn">Simpan Pending & Buka WhatsApp</button></div>`);
    document.getElementById('pendingSubmit')?.addEventListener('click', () => submitPending(id));
  }

  async function submitPending(id) {
    const reason = document.getElementById('pendingReason')?.value || '';
    const detail = document.getElementById('pendingDetail')?.value.trim() || '';
    const msg = document.getElementById('pendingMessage');
    if (!reason) { if (msg) msg.innerHTML = `<div class="alert error">Alasan pending wajib dipilih.</div>`; return; }
    const button = document.getElementById('pendingSubmit'); setBusy(button,true,'Menyimpan…');
    try {
      const res = await api().pendingTask(token(), id, {reason,detail});
      if(res.data?.record)state.mine=state.mine.map(x=>String(x.id)===String(id)?res.data.record:x);
      ctx.closeModal(); renderTasksData(); ctx.showToast('Status Pending disimpan. Paket tetap dibawa oleh Kurir.', 'warning', 6500);
      if (res.data?.waAction) openWaAction(res.data.waAction, 'Beritahu pasien — pengantaran Pending');
      setTimeout(()=>refreshRows({silent:true}).catch(()=>{}),160);
    } catch (err) { if (msg) msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    finally { setBusy(button,false); }
  }

  function openFailure(id) {
    const r = state.mine.find(x => x.id === id);
    if (!r) return ctx.showToast('Tugas tidak ditemukan. Segarkan halaman.', 'error');
    if (r.failureReported) return ctx.showToast('Gagal Antar sudah dicatat. Kembalikan obat ke Farmasi.', 'warning');
    const reasons = state.master?.failureReasons || [];
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">GAGAL ANTAR</div><h3>Catat Gagal Antar</h3><p>${esc(r.name)} • ${esc(r.village)}</p></div><button class="modal-x" data-modal-close>×</button></div><div class="notice-box warning-note">Gunakan bila pengantaran hari ini sudah tidak memungkinkan. Setelah disimpan, obat wajib dikembalikan ke Farmasi. Penjadwalan ulang atau pengambilan mandiri ditindaklanjuti oleh Farmasi.</div><div class="form-grid modal-form"><label><span>Alasan gagal *</span><select id="failReason"><option value="">Pilih alasan</option>${reasons.map(v=>`<option value="${esc(v)}" ${r.pendingReason===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label><span>Catatan tambahan <small>opsional</small></span><textarea id="failDetail" rows="3" placeholder="Keterangan singkat bila diperlukan">${esc(r.pendingDetail||'')}</textarea></label></div><div id="failMessage"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="failSubmit" class="danger-btn">Simpan Gagal Antar & Buka WhatsApp</button></div>`);
    document.getElementById('failSubmit')?.addEventListener('click', () => submitFailure(id));
  }

  async function submitFailure(id) {
    const reason = document.getElementById('failReason')?.value || '';
    const detail = document.getElementById('failDetail')?.value.trim() || '';
    const msg = document.getElementById('failMessage');
    if (!reason) { if (msg) msg.innerHTML = `<div class="alert error">Alasan gagal wajib dipilih.</div>`; return; }
    const button = document.getElementById('failSubmit'); setBusy(button,true,'Menyimpan…');
    try {
      const res = await api().failTask(token(), id, {reason,detail});
      if(res.data?.record)state.mine=state.mine.map(x=>String(x.id)===String(id)?res.data.record:x);
      ctx.closeModal(); renderTasksData(); ctx.showToast('Gagal Antar disimpan. Kembalikan obat ke Farmasi.', 'warning', 7000);
      if (res.data?.waAction) openWaAction(res.data.waAction, 'Beritahu pasien — Gagal Antar');
      setTimeout(()=>refreshRows({silent:true}).catch(()=>{}),160);
    } catch (err) { if (msg) msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    finally { setBusy(button,false); }
  }

  function openIncidentReport() {
    if (!state.mine.length) return ctx.showToast('Tidak ada tugas aktif yang terdampak.', 'error');
    if (state.activeIncident) return ctx.showToast('Masih ada kendala aktif. Selesaikan kendala tersebut terlebih dahulu.', 'warning');
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">KENDALA KURIR</div><h3>Laporkan Kendala Operasional</h3><p>Kendala akan ditandai pada seluruh tugas aktif Anda.</p></div><button class="modal-x" data-modal-close>×</button></div><div class="form-grid modal-form"><label><span>Jenis kendala *</span><select id="incidentType"><option value="">Pilih jenis kendala</option>${optionList(state.master?.incidentTypes || [])}</select></label><label><span>Perkiraan keterlambatan *</span><select id="incidentDelay"><option value="">Pilih perkiraan</option>${optionList(state.master?.delayEstimates || [])}</select></label><label><span>Keterangan kendala *</span><textarea id="incidentDetail" rows="4" placeholder="Jelaskan kondisi secara singkat"></textarea></label></div><div id="incidentMessage"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="incidentSubmit" class="warning-btn">Simpan Kendala</button></div>`);
    document.getElementById('incidentSubmit')?.addEventListener('click', submitIncident);
  }

  async function submitIncident() {
    const type = document.getElementById('incidentType')?.value || '';
    const delayEstimate = document.getElementById('incidentDelay')?.value || '';
    const detail = document.getElementById('incidentDetail')?.value.trim() || '';
    const msg = document.getElementById('incidentMessage');
    if (!type || !delayEstimate || !detail) { if(msg) msg.innerHTML = `<div class="alert error">Jenis kendala, perkiraan keterlambatan, dan keterangan wajib diisi.</div>`; return; }
    const button = document.getElementById('incidentSubmit'); setBusy(button,true,'Menyimpan…');
    try {
      const res = await api().reportIncident(token(), {type,delayEstimate,detail});
      state.activeIncident = res.data?.incident || null;
      const affected=Array.isArray(res.data?.affectedRecords)?res.data.affectedRecords:[];
      if(affected.length){const map=new Map(affected.map(x=>[String(x.id),x]));state.mine=state.mine.map(x=>map.get(String(x.id))||x);}
      ctx.closeModal(); rerenderVisibleData(); ctx.showToast('Kendala Kurir berhasil dicatat.', 'warning');
      if (Array.isArray(res.data?.waActions) && res.data.waActions.length) openIncidentWaActions(res.data.waActions);
      setTimeout(()=>refreshRows({silent:true}).catch(()=>{}),160);
    } catch (err) { if(msg) msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    finally { setBusy(button,false); }
  }

  function openResolveIncident() {
    const i = state.activeIncident;
    if (!i) return ctx.showToast('Tidak ada kendala aktif.', 'info');
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">SELESAIKAN KENDALA</div><h3>${esc(i.type || 'Kendala Kurir')}</h3><p>${esc(i.detail || '')}</p></div><button class="modal-x" data-modal-close>×</button></div><div class="form-grid modal-form"><label><span>Catatan penyelesaian *</span><textarea id="resolveNote" rows="4" placeholder="Contoh: ban selesai diganti, pengantaran dilanjutkan"></textarea></label></div><div id="resolveMessage"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="resolveSubmit" class="primary-btn">Selesaikan Kendala</button></div>`);
    document.getElementById('resolveSubmit')?.addEventListener('click', submitResolveIncident);
  }

  async function submitResolveIncident() {
    const note = document.getElementById('resolveNote')?.value.trim() || '';
    const msg = document.getElementById('resolveMessage');
    if (!note) { if(msg) msg.innerHTML = `<div class="alert error">Catatan penyelesaian wajib diisi.</div>`; return; }
    const button = document.getElementById('resolveSubmit'); setBusy(button,true,'Menyimpan…');
    try {
      await api().resolveIncident(token(), state.activeIncident.id, note);
      ctx.closeModal(); state.activeIncident = null; state.mine=state.mine.map(x=>Object.assign({},x,{incidentStatus:'',activeIncidentId:''})); rerenderVisibleData(); ctx.showToast('Kendala diselesaikan. Pengantaran dapat dilanjutkan.', 'success');
      setTimeout(()=>refreshRows({silent:true}).catch(()=>{}),160);
    } catch (err) { if(msg) msg.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    finally { setBusy(button,false); }
  }

  async function renderHistory() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">RIWAYAT</div><h1>Selesai Hari Ini</h1><p>Pengantaran yang selesai oleh akun Kurir ini pada hari ini.</p></div><div class="hero-actions"><button id="historyRefresh" class="secondary-btn">↻ Segarkan</button></div></section><section class="section"><div id="historyContent"><div class="inline-loading">Memuat riwayat…</div></div></section>`;
    document.getElementById('historyRefresh')?.addEventListener('click', async e => {
      setBusy(e.currentTarget,true,'Memuat…');
      try { const res = await api().courierHistory(token(),50); state.history = res.data?.rows || []; state.historyLoaded = true; renderHistoryData(); ctx.showToast('Riwayat diperbarui.','success'); }
      catch(err){ctx.showToast(err.message,'error');}
      finally{setBusy(e.currentTarget,false);}
    });
    try { await ensureData(); if(!state.historyLoaded) await loadHistoryBackground(); renderHistoryData(); }
    catch(err){document.getElementById('historyContent').innerHTML=`<div class="alert error">${esc(err.message)}</div>`;}
  }

  function renderHistoryData() {
    const box = document.getElementById('historyContent'); if(!box) return;
    if(!state.history.length){box.innerHTML=`<div class="content-card empty-state"><div>↺</div><h3>Belum ada riwayat hari ini</h3><p>Pengantaran yang selesai akan muncul di sini.</p></div>`;return;}
    box.innerHTML=`<div class="content-card table-wrap"><table class="responsive-table courier-history-table"><thead><tr><th>Waktu</th><th>Pasien</th><th>Wilayah</th><th>Status</th><th>Verifikasi</th></tr></thead><tbody>${state.history.map(r=>`<tr><td data-label="Waktu">${esc(timeOnly(r.completedAt))}</td><td data-label="Pasien"><strong>${esc(r.name||'-')}</strong>${r.isRetry?`<span class="retry-chip">Pengantaran ke-${Number(r.attemptNo||2)}</span>`:''}<span class="cell-sub">${esc(r.packageCode || shortId(r.id))}</span></td><td data-label="Wilayah">${esc([r.village,r.district].filter(Boolean).join(' • ')||'-')}</td><td data-label="Status">${badge(r.status,statusClass(r.status))}${r.status==='GAGAL ANTAR'&&r.failureReason?`<span class="cell-sub">${esc(r.failureReason)}</span>`:''}</td><td data-label="Verifikasi">${r.status==='TERKIRIM'?badge(r.verificationStatus||'BELUM',r.verificationStatus==='TERVERIFIKASI KODE'||r.verificationStatus==='TERVERIFIKASI MANUAL'?'success':'warning'):'-'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function optionList(items) {
    return (items || []).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  }

  function setBusy(button, busy, label = 'Memproses…') {
    if (typeof ctx.setButtonBusy === 'function') return ctx.setButtonBusy(button,busy,label);
    if (!button) return;
    if (busy) { button.dataset.oldLabel = button.textContent; button.disabled = true; if(label) button.textContent = label; }
    else { button.disabled = false; if(button.dataset.oldLabel) button.textContent = button.dataset.oldLabel; }
  }

  function openWaAction(action, title = 'WhatsApp') {
    if (!action || !action.url) return;
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">WHATSAPP</div><h3>${esc(title)}</h3><p>${esc(action.phoneDisplay || '')}</p></div><button class="modal-x" data-modal-close>×</button></div><div class="wa-preview">${esc(action.message || '')}</div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Tutup</button><a class="primary-btn link-btn" href="${esc(safeHref(action.url))}" target="_blank" rel="noopener">Buka WhatsApp</a></div>`);
  }

  function openIncidentWaActions(actions) {
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">INFORMASI PASIEN</div><h3>Kirim Pemberitahuan Kendala</h3><p>${actions.length} pengantaran aktif terdampak. Disarankan kirim pemberitahuan ke semua pasien terdampak.</p></div><button class="modal-x" data-modal-close>×</button></div><div class="wa-action-list">${actions.map(a => `<div><span><strong>${esc(a.name || '-')}</strong><small>${esc(a.village || '')}</small></span>${a.waAction?.url ? `<a class="mini-btn success" href="${esc(safeHref(a.waAction.url))}" target="_blank" rel="noopener">Buka WA</a>` : '<small>WA tidak tersedia</small>'}</div>`).join('')}</div><div class="modal-actions"><button class="primary-btn" data-modal-close>Selesai</button></div>`);
  }

  return { renderHome, renderReady, renderTasks, renderHistory, resetForLogout };
}
