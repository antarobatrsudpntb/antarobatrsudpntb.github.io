import { buildManagementPdf, downloadPdfBlob, reportFilename } from './report-pdf.js?v=1.0.0';
export function createManagementModule(ctx) {
  const esc = ctx.escapeHtml;
  const api = () => ctx.getApi();
  const token = () => ctx.getToken();
  const page = () => document.getElementById('pageContent');
  const setBusy = (button,busy,label='Memproses…') => { if (typeof ctx.setButtonBusy === 'function') return ctx.setButtonBusy(button,busy,label); if(!button)return; if(busy){button.dataset.oldLabel=button.textContent;button.disabled=true;button.textContent=label;}else{button.disabled=false;if(button.dataset.oldLabel)button.textContent=button.dataset.oldLabel;} };
  const MIN_STATS_SAMPLE = Math.max(2, Number(ctx.minimumStatsSample || 10));
  const CLIENT_SCOPE_CACHE_MS = 45000;

  const state = {
    data: null,
    loading: null,
    preset: 'month',
    basis: 'DAFTAR',
    start: '',
    end: '',
    lastLoadedKey: '',
    dataCache: new Map(),
    performanceTab: 'pharmacy'
  };

  function setManagementPageMode(mode = '') {
    const el = page();
    if (!el) return;
    el.classList.toggle('management-summary-page', mode === 'summary');
  }

  function localDateKey(date = new Date()) {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
  function startOfQuarter(d) { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1); }
  function startOfSemester(d) { return new Date(d.getFullYear(), d.getMonth() < 6 ? 0 : 6, 1); }
  function applyPreset(preset) {
    state.preset = preset;
    const now = new Date();
    let start = now;
    if (preset === '7d') start = addDays(now, -6);
    else if (preset === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (preset === 'quarter') start = startOfQuarter(now);
    else if (preset === 'semester') start = startOfSemester(now);
    else if (preset === 'year') start = new Date(now.getFullYear(), 0, 1);
    else if (preset === 'custom') return;
    state.start = localDateKey(start);
    state.end = localDateKey(now);
  }
  applyPreset('month');

  const n = value => Number(value || 0).toLocaleString('id-ID');
  const pct = value => `${(Number(value || 0) * 100).toFixed(1)}%`;
  const minutes = value => `${n(value)} menit`;
  function fmtDate(value) {
    if (!value) return '—';
    const [y, m, d] = String(value).slice(0, 10).split('-');
    return y && m && d ? `${d}/${m}/${y}` : String(value);
  }
  function periodLabel() { return state.start === state.end ? fmtDate(state.start) : `${fmtDate(state.start)}–${fmtDate(state.end)}`; }

  function hero(title, subtitle, eyebrow = 'MANAJEMEN', branded = false) {
    return `<section class="hero compact management-hero ${branded?'brand-hero':''}"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${branded?'<img class="hero-brand-mascot" src="./icons/mascot-melesat.png" alt="" aria-hidden="true">':''}<div class="hero-actions"><button id="mgmtRefresh" class="secondary-btn">↻ Segarkan</button></div></section>`;
  }
  function metric(label, value, note = '', tone = '') {
    return `<div class="kpi-card ${tone}"><span>${esc(label)}</span><strong>${esc(String(value))}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  }

  function executiveStatusCard(k = {}) {
    const delivered = Number(k.delivered || 0);
    const failed = Number(k.failed || 0);
    const ready = Number(k.ready || 0);
    const transit = Number(k.transit || 0);
    const waiting = Number(k.waiting || 0);
    const finished = delivered + failed;
    const success = Math.max(0, Math.min(100, Number(k.successRate || 0) * 100));
    return `<article class="executive-status-card">
      <div class="executive-status-head"><div><span>STATUS LAYANAN</span><h3>Pengantaran pada periode ini</h3></div><strong>${n(finished)} selesai</strong></div>
      <div class="executive-status-body">
        <div class="success-donut" style="--success:${success.toFixed(1)}"><div><strong>${success.toFixed(1)}%</strong><span>berhasil</span></div></div>
        <div class="executive-status-list">
          <div class="success"><span>Terkirim</span><b>${n(delivered)}</b></div>
          <div class="danger"><span>Gagal Antar</span><b>${n(failed)}</b></div>
          <div class="transit"><span>Dalam Perjalanan</span><b>${n(transit)}</b></div>
          <div class="ready"><span>Siap Diantar</span><b>${n(ready)}</b></div>
          <div class="neutral"><span>Menunggu Diproses</span><b>${n(waiting)}</b></div>
        </div>
      </div>
    </article>`;
  }
  function empty(title, text = '') {
    return `<div class="empty-state mgmt-empty"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
  }

  function filterBar() {
    const presets = [['today','Hari Ini'],['7d','7 Hari'],['month','Bulan Ini'],['quarter','Triwulan'],['semester','Semester'],['year','Tahun'],['custom','Kustom']];
    return `<div class="mgmt-filter-card">
      <div class="mgmt-presets">${presets.map(([key,label]) => `<button data-period="${key}" class="${state.preset === key ? 'active' : ''}">${label}</button>`).join('')}</div>
      <div class="mgmt-custom">
        <label>Awal<input id="mgmtStart" type="date" value="${esc(state.start)}"></label>
        <label>Akhir<input id="mgmtEnd" type="date" value="${esc(state.end)}"></label>
        <label>Hitung berdasarkan<select id="mgmtBasis"><option value="DAFTAR" ${state.basis === 'DAFTAR' ? 'selected' : ''}>Tanggal Pendaftaran</option><option value="SELESAI" ${state.basis === 'SELESAI' ? 'selected' : ''}>Tanggal Pengantaran Selesai</option></select></label>
        <button id="mgmtApply" class="primary-btn">Tampilkan</button>
      </div>
      <div class="mgmt-period-caption">Periode <strong>${esc(periodLabel())}</strong></div>
    </div>`;
  }

  function bindFilter(onReload) {
    document.querySelectorAll('[data-period]').forEach(button => {
      button.onclick = () => {
        const preset = button.dataset.period;
        if (preset === 'custom') state.preset = 'custom'; else applyPreset(preset);
        document.querySelectorAll('[data-period]').forEach(x => x.classList.toggle('active', x.dataset.period === state.preset));
        const start = document.getElementById('mgmtStart');
        const end = document.getElementById('mgmtEnd');
        if (start) start.value = state.start;
        if (end) end.value = state.end;
        if (preset !== 'custom') { setBusy(button,true,'Memuat…'); Promise.resolve(onReload()).finally(()=>setBusy(button,false)); }
      };
    });
    const apply = document.getElementById('mgmtApply');
    if (apply) apply.onclick = async () => {
      state.preset = 'custom';
      state.start = document.getElementById('mgmtStart').value;
      state.end = document.getElementById('mgmtEnd').value;
      state.basis = document.getElementById('mgmtBasis').value;
      setBusy(apply,true,'Memuat…');
      try { await onReload(); } finally { setBusy(apply,false); }
    };
    const basis = document.getElementById('mgmtBasis');
    if (basis) basis.onchange = () => { state.basis = basis.value; };
  }

  function currentScope() {
    const view = String(typeof ctx.getView === 'function' ? ctx.getView() : '').toLowerCase();
    if (view === 'performance') return 'PERFORMANCE';
    if (view === 'areas') return 'AREAS';
    if (view === 'reports') return 'REPORTS';
    return 'HOME';
  }

  async function ensureData(force = false, scope = 'HOME') {
    const normalizedScope = String(scope || 'HOME').toUpperCase();
    const key = [state.start, state.end, state.basis, normalizedScope].join('|');
    if (!force && state.dataCache.has(key)) {
      const hit = state.dataCache.get(key);
      if (hit && Date.now() - Number(hit.at || 0) < CLIENT_SCOPE_CACHE_MS) {
        state.data = hit.data || {};
        state.lastLoadedKey = key;
        return state.data;
      }
      state.dataCache.delete(key);
    }
    if (state.loading && !force && state.loading.key === key) return state.loading.promise;
    const promise = (async () => {
      const response = await api().managementData(token(), state.start, state.end, state.basis, normalizedScope, force === true);
      const dashboard = response.data?.dashboard || {};
      state.data = dashboard;
      state.lastLoadedKey = key;
      state.dataCache.set(key, {data:dashboard,at:Date.now()});
      return dashboard;
    })();
    state.loading = { key, promise };
    try { return await promise; }
    finally { if (state.loading?.promise === promise) state.loading = null; }
  }

  async function refreshCurrent(draw, scope = currentScope()) {
    const button = document.getElementById('mgmtRefresh');
    if (button) setBusy(button,true,'Memuat…');
    try {
      await ensureData(true, scope);
      draw();
      ctx.showToast('Data Manajemen diperbarui.', 'success');
    } catch (error) { ctx.showToast(error.message, 'error'); }
    finally { if (button) setBusy(button,false); }
  }

  function timeInsight(value, label, description = '') {
    const x = value || {};
    const sample = Number(x.sample || 0);
    if (!sample) return `<article class="time-insight"><span>${esc(label)}</span><strong>Belum ada data</strong>${description ? `<small>${esc(description)}</small>` : ''}</article>`;
    if (sample < MIN_STATS_SAMPLE) {
      return `<article class="time-insight"><span>${esc(label)}</span><div class="time-insight-grid stats-three"><div><small>Mean (rata-rata)</small><strong>${minutes(x.average)}</strong></div></div><small>${n(sample)} pengantaran dianalisis. Data belum cukup untuk analisis Median dan P90${description ? ` • ${esc(description)}` : ''}.</small></article>`;
    }
    return `<article class="time-insight"><span>${esc(label)}</span><div class="time-insight-grid stats-three"><div><small>Mean (rata-rata)</small><strong>${minutes(x.average)}</strong></div><div><small>Median (nilai tengah)</small><strong>${minutes(x.median)}</strong></div><div><small>P90 (90% selesai dalam)</small><strong>≤ ${minutes(x.p90)}</strong></div></div><small>${n(sample)} pengantaran dianalisis${description ? ` • ${esc(description)}` : ''}.</small></article>`;
  }

  function incidentTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return esc(String(value));
    return d.toLocaleString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).replace('.',':');
  }

  function activeIncidentPanel(rows = []) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '';
    return `<div class="content-card active-incident-panel"><div class="mgmt-card-head"><div><h3>Kendala Aktif</h3><p>Informasi operasional untuk tindak lanjut PJ/Koordinator.</p></div></div><div class="active-incident-grid">${list.map(item => {
      const areas = Array.isArray(item.affectedAreas) && item.affectedAreas.length ? item.affectedAreas.join(', ') : '—';
      return `<article class="incident-detail-card"><div class="incident-detail-top"><strong>${esc(item.courier || 'Kurir')}</strong><span>${esc(item.delayEstimate || 'Perkiraan belum diisi')}</span></div><h4>${esc(item.type || 'Kendala operasional')}</h4>${item.detail ? `<p>${esc(item.detail)}</p>` : ''}<dl><div><dt>Mulai</dt><dd>${incidentTime(item.startedAt)}</dd></div><div><dt>Paket terdampak</dt><dd>${n(item.affectedCount || 0)}</dd></div><div><dt>Wilayah terdampak</dt><dd>${esc(areas)}</dd></div></dl></article>`;
    }).join('')}</div></div>`;
  }

  function lineChart(rows) {
    if (!rows?.length) return empty('Belum ada tren', 'Belum ada aktivitas pada periode yang dipilih.');
    const W = 760, H = 250, pad = 34;
    const max = Math.max(1, ...rows.flatMap(r => [Number(r.total||0), Number(r.delivered||0), Number(r.failed||0)]));
    const points = key => rows.map((r,i) => {
      const x = rows.length === 1 ? W/2 : pad + i * (W-pad*2)/(rows.length-1);
      const y = H-pad - (Number(r[key]||0)/max)*(H-pad*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<div class="svg-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tren pengantaran"><line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" class="axis"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H-pad}" class="axis"/><polyline points="${points('total')}" class="line total"/><polyline points="${points('delivered')}" class="line delivered"/><polyline points="${points('failed')}" class="line failed"/></svg><div class="chart-legend"><span class="total">Pendaftaran</span><span class="delivered">Terkirim</span><span class="failed">Gagal Antar</span></div></div>`;
  }

  function barRanking(rows, limit = 10) {
    const list = (rows || []).slice(0, limit);
    if (!list.length) return empty('Belum ada data wilayah');
    const max = Math.max(1, ...list.map(x => Number(x.count || 0)));
    return `<div class="bar-ranking">${list.map(x => `<div><div class="bar-ranking-label"><span>${esc(x.name || 'Tidak diketahui')}</span><b>${n(x.count)}</b></div><div class="bar-track"><i style="width:${Math.max(2, Number(x.count||0)/max*100)}%"></i></div></div>`).join('')}</div>`;
  }

  function rankingTable(rows, label) {
    if (!rows?.length) return empty('Belum ada data');
    return `<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>${esc(label)}</th><th>Jumlah</th></tr></thead><tbody>${rows.slice(0,30).map(x => `<tr><td>${esc(x.name || 'Tidak diketahui')}</td><td><b>${n(x.count)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }

  function verificationPanel(v = {}) {
    if (!Number(v.eligible || 0)) return empty('Belum ada penerimaan yang dapat dianalisis');
    return `<div class="verification-clean"><div><span>Penerimaan terverifikasi</span><strong>${pct(v.rate)}</strong><small>${n(v.verified)} dari ${n(v.eligible)} penerimaan</small></div><div class="verification-mini"><span>Kode <b>${n(v.code)}</b></span><span>Tanpa kode <b>${n(v.manual)}</b></span><span>Menunggu <b>${n(v.pending)}</b></span></div></div>`;
  }

  function deliverySummary(a = {}) {
    return `<div class="content-card mgmt-chart-card"><div class="mgmt-card-head"><div><h3>Pengantaran Ulang</h3><p>Aktivitas pengantaran tetap tercatat meskipun satu pasien memerlukan pengantaran ulang.</p></div></div><div class="report-summary-grid compact-summary"><div><span>Total Pengantaran</span><b>${n(a.total)}</b></div><div><span>Berhasil Diantar</span><b>${n(a.delivered)}</b></div><div><span>Gagal Diantar</span><b>${n(a.failed)}</b></div><div><span>Kasus Pengantaran Ulang</span><b>${n(a.retriedCases)}</b></div><div><span>Pengantaran Ulang Berhasil</span><b>${n(a.retryDelivered)}</b></div><div><span>Ambil Mandiri</span><b>${n(a.selfPickup)}</b></div></div></div>`;
  }

  function executiveHighlights(k = {}, v = {}, inc = {}) {
    const items = [
      {tone:'success', label:'Terkirim', value:n(k.delivered || 0)},
      {tone:'danger', label:'Gagal antar', value:n(k.failed || 0)},
      {tone:'teal', label:'Penerimaan terverifikasi', value:pct(v.rate)},
      {tone:Number(inc.active||0) > 0 ? 'warning' : 'neutral', label:'Kendala aktif', value:n(inc.active || 0)}
    ];
    return `<div class="executive-highlight-strip" aria-label="Sorotan periode">${items.map(item => `<div class="${item.tone}"><span>${esc(item.label)}</span><strong>${esc(String(item.value))}</strong></div>`).join('')}</div>`;
  }

  function pharmacyMobileCards(rows = []) {
    if (!rows.length) return '';
    return `<div class="mgmt-mobile-staff-list pharmacy-mobile-list">${rows.map(x => `<article class="mgmt-mobile-staff-card"><div class="mgmt-mobile-staff-head"><div><span>PETUGAS FARMASI</span><h4>${esc(x.name)}</h4></div><strong>${n(x.registrations)}<small>pendaftaran</small></strong></div><dl><div><dt>Siap Diantar</dt><dd>${n(x.ready)}</dd></div><div><dt>Verifikasi</dt><dd>${n(x.verifications)}</dd></div><div><dt>Tindak Lanjut</dt><dd>${n(x.followUps)}</dd></div><div><dt>Pengantaran Ulang</dt><dd>${n(x.redeliveries)}</dd></div></dl></article>`).join('')}</div>`;
  }

  function courierMobileCards(rows = []) {
    if (!rows.length) return '';
    return `<div class="mgmt-mobile-staff-list courier-mobile-list">${rows.map(x => {
      const completed = Number(x.delivered||0) + Number(x.failed||0);
      return `<article class="mgmt-mobile-staff-card courier-mobile-card"><div class="mgmt-mobile-staff-head"><div><span>KURIR</span><h4>${esc(x.name)}</h4>${x.topRegion ? `<p>${esc(x.topRegion)}</p>` : ''}</div><strong>${pct(x.successRate)}<small>keberhasilan</small></strong></div><dl><div><dt>Tugas selesai</dt><dd>${n(completed)}</dd></div><div><dt>Terkirim</dt><dd>${n(x.delivered)}</dd></div><div><dt>Gagal antar</dt><dd>${n(x.failed)}</dd></div><div><dt>Pending</dt><dd>${n(x.pendingDeliveries||0)}</dd></div><div><dt>Kendala</dt><dd>${n(x.incidents)}</dd></div><div class="wide-stat"><dt>Durasi penyelesaian</dt><dd>${performanceDurationCell(x.timeStats)}</dd></div></dl></article>`;
    }).join('')}</div>`;
  }

  async function renderHome() {
    setManagementPageMode('summary');
    page().innerHTML = `${hero('Ringkasan Eksekutif','Gambaran singkat layanan pengantaran obat untuk pemantauan dan pengambilan keputusan.','MANAJEMEN',true)}<section class="section">${filterBar()}<div id="mgmtHome" class="mgmt-loading">Memuat data…</div></section>`;
    bindFilter(() => loadHome(true));
    document.getElementById('mgmtRefresh').onclick = () => refreshCurrent(drawHome, 'HOME');
    await loadHome(false);
  }
  async function loadHome(force) {
    try { await ensureData(force, 'HOME'); drawHome(); }
    catch (error) { document.getElementById('mgmtHome').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; }
  }
  function drawHome() {
    const d = state.data || {}, k = d.kpi || {}, v = d.verification || {}, inc = d.incidentSummary || {};
    const root = document.getElementById('mgmtHome'); if (!root) return;
    root.innerHTML = `<div class="executive-heading executive-overview-heading"><div><span>EXECUTIVE OVERVIEW</span><h2>Kondisi Layanan Periode Ini</h2><p>Tren dan status utama untuk periode ${esc(periodLabel())}.</p></div></div>
      <div class="executive-overview-grid"><div class="content-card mgmt-chart-card executive-trend-card"><div class="mgmt-card-head"><div><span class="section-kicker">TREN LAYANAN</span><h3>Pergerakan Harian</h3><p>Pendaftaran, terkirim, dan gagal antar.</p></div></div>${lineChart(d.daily||[])}</div>${executiveStatusCard(k)}</div>
      ${executiveHighlights(k,v,inc)}
      <div class="executive-heading executive-kpi-heading"><div><span>INDIKATOR UTAMA</span><h2>Key Performance Indicator (KPI)</h2><p>Rincian angka utama layanan pada periode terpilih.</p></div></div>
      <div class="kpi-grid mgmt-kpi-grid executive-kpi-grid">${metric('Total Pendaftaran',n(k.total),'Kasus pada periode','neutral-soft')}${metric('Terkirim',n(k.delivered),`${n(k.failed)} gagal antar`,'success-soft')}${metric('Gagal Antar',n(k.failed),'Pengantaran yang tidak berhasil','danger-soft')}${metric('Dalam Perjalanan',n(k.transit),`${n(k.ready)} siap diantar`,'transit-soft')}${metric('Penerimaan Terverifikasi',pct(v.rate),`${n(v.verified)} dari ${n(v.eligible)} penerimaan`,'teal-soft')}${metric('Kendala Aktif',n(inc.active),`${n(inc.total)} kendala tercatat`,'warning-soft')}</div>
      ${activeIncidentPanel(d.activeIncidents || [])}
      <div class="section-head mgmt-subhead"><div><h2>Waktu Layanan</h2><p>Durasi digunakan untuk membaca proses layanan, bukan sebagai satu-satunya ukuran kinerja petugas.</p></div></div>
      <div class="time-insight-grid executive-time-grid">${timeInsight(d.timeStats?.total,'Total Waktu Layanan','Pendaftaran hingga obat diterima')}${timeInsight(d.timeStats?.pharmacy,'Pendaftaran hingga Siap Diantar')}${timeInsight(d.timeStats?.consolidation,'Menunggu Diambil Kurir')}${timeInsight(d.timeStats?.courier,'Durasi Penyelesaian Pengantaran')}</div>
      <div class="mgmt-dashboard-grid"><div class="content-card mgmt-chart-card"><div class="mgmt-card-head"><div><h3>Verifikasi Penerimaan</h3><p>Status verifikasi penerimaan obat.</p></div></div>${verificationPanel(v)}</div>${deliverySummary(d.deliveryAnalytics||{})}</div>
      <div class="content-card mgmt-chart-card"><div class="mgmt-card-head"><div><h3>Wilayah Pengantaran Terkirim</h3><p>Tujuan pengantaran terbanyak.</p></div></div>${barRanking(d.deliveredRegions||[],8)}</div>`;
  }


  async function renderPerformance() {
    setManagementPageMode();
    page().innerHTML = `${hero('Kinerja Layanan & Petugas','Aktivitas Farmasi dan Kurir pada periode yang dipilih.','KINERJA')}<section class="section">${filterBar()}<div class="segmented-tabs performance-tabs"><button data-performance-tab="pharmacy" class="${state.performanceTab==='pharmacy'?'active':''}">Farmasi</button><button data-performance-tab="courier" class="${state.performanceTab==='courier'?'active':''}">Kurir</button></div><div id="mgmtPerformance" class="mgmt-loading">Memuat kinerja…</div></section>`;
    bindFilter(() => loadPerformance(true));
    document.querySelectorAll('[data-performance-tab]').forEach(button => button.onclick = () => { state.performanceTab = button.dataset.performanceTab; document.querySelectorAll('[data-performance-tab]').forEach(x => x.classList.toggle('active', x.dataset.performanceTab === state.performanceTab)); drawPerformance(); });
    document.getElementById('mgmtRefresh').onclick = () => refreshCurrent(drawPerformance, 'PERFORMANCE');
    await loadPerformance(false);
  }
  async function loadPerformance(force) {
    try { await ensureData(force, 'PERFORMANCE'); drawPerformance(); }
    catch (error) { document.getElementById('mgmtPerformance').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; }
  }
  function drawPerformance() {
    const root = document.getElementById('mgmtPerformance'); if (!root) return;
    const d = state.data || {};
    root.innerHTML = state.performanceTab === 'pharmacy' ? pharmacyPerformanceView(d) : courierPerformanceView(d);
  }
  function pharmacyPerformanceView(d) {
    const p = d.pharmacyPerformance || {staff:[],totals:{}};
    const rows = p.staff || [], t = p.totals || {};
    return `<div class="kpi-grid">${metric('Petugas Aktif di Periode',n(rows.length),'Memiliki aktivitas Farmasi')}${metric('Pendaftaran Ditangani',n(t.registrations))}${metric('Ditandai Siap Diantar',n(t.ready))}${metric('Verifikasi',n(t.verifications))}${metric('Tindak Lanjut',n(t.followUps))}${metric('Pengantaran Ulang Dibuat',n(t.redeliveries))}</div>
      <div class="content-card mgmt-table-card"><div class="mgmt-card-head"><div><h3>Aktivitas Petugas Farmasi</h3><p>Aktivitas dihitung berdasarkan petugas yang benar-benar melakukan setiap tindakan.</p></div></div>${rows.length ? `<div class="mgmt-desktop-table table-scroll"><table class="data-table mgmt-table"><thead><tr><th>Petugas Farmasi</th><th>Pendaftaran</th><th>Siap Diantar</th><th>Verifikasi</th><th>Tindak Lanjut</th><th>Pengantaran Ulang</th></tr></thead><tbody>${rows.map(x => `<tr><td><strong>${esc(x.name)}</strong></td><td>${n(x.registrations)}</td><td>${n(x.ready)}</td><td>${n(x.verifications)}</td><td>${n(x.followUps)}</td><td>${n(x.redeliveries)}</td></tr>`).join('')}</tbody></table></div>${pharmacyMobileCards(rows)}` : empty('Belum ada aktivitas Farmasi pada periode ini.')}</div>
      <div class="section-head mgmt-subhead"><div><h2>Waktu Proses Farmasi</h2><p>Indikator proses keseluruhan, bukan peringkat kecepatan petugas.</p></div></div><div class="time-insight-grid single-row">${timeInsight(d.timeStats?.pharmacy,'Pendaftaran hingga Siap Diantar')}</div>`;
  }
  function courierPerformanceView(d) {
    const rows = d.couriers || [], inc = d.incidentSummary || {};
    return `<div class="kpi-grid">${metric('Kurir Aktif di Periode',n(rows.length),'Memiliki aktivitas pengantaran')}${metric('Pengantaran Selesai',n(Number(d.kpi?.delivered||0)+Number(d.kpi?.failed||0)),`${n(d.kpi?.delivered)} terkirim`)}${metric('Gagal Antar',n(d.kpi?.failed||0))}${metric('Kendala',n(inc.total),`${n(inc.active)} masih aktif`)}</div>
      <div class="content-card mgmt-table-card"><div class="mgmt-card-head"><div><h3>Kinerja Kurir</h3><p>Durasi dipengaruhi rute, jarak, lalu lintas, konsolidasi paket, Pending, dan keberadaan penerima.</p></div></div>${rows.length ? `<div class="mgmt-desktop-table table-scroll"><table class="data-table mgmt-table"><thead><tr><th>Kurir</th><th>Tugas Selesai</th><th>Terkirim</th><th>Gagal Antar</th><th>Tingkat Keberhasilan</th><th>Pending</th><th>Kendala</th><th>Durasi Penyelesaian</th></tr></thead><tbody>${rows.map(x => `<tr><td><strong>${esc(x.name)}</strong><small class="table-subtext">${esc(x.topRegion||'')}</small></td><td>${n(Number(x.delivered||0)+Number(x.failed||0))}</td><td>${n(x.delivered)}</td><td>${n(x.failed)}</td><td><strong>${pct(x.successRate)}</strong></td><td>${n(x.pendingDeliveries||0)}</td><td>${n(x.incidents)}</td><td>${performanceDurationCell(x.timeStats)}</td></tr>`).join('')}</tbody></table></div>${courierMobileCards(rows)}` : empty('Belum ada aktivitas Kurir pada periode ini.')}</div>`;
  }
  function performanceDurationCell(stats = {}) {
    const sample = Number(stats.sample || 0);
    if (!sample) return '—';
    if (sample < MIN_STATS_SAMPLE) return `<strong>Mean ${minutes(stats.average)}</strong><small class="table-subtext">${n(sample)} pengantaran • Median/P90 belum cukup data</small>`;
    return `<strong>Mean ${minutes(stats.average)}</strong><small class="table-subtext">Median ${minutes(stats.median)} • P90 ≤ ${minutes(stats.p90)}</small>`;
  }

  async function renderAreas() {
    setManagementPageMode();
    page().innerHTML = `${hero('Wilayah Pengantaran','Sebaran pendaftaran, pengantaran terkirim, dan alasan gagal berdasarkan wilayah.','WILAYAH')}<section class="section">${filterBar()}<div id="mgmtAreas" class="mgmt-loading">Memuat wilayah…</div></section>`;
    bindFilter(() => loadAreas(true));
    document.getElementById('mgmtRefresh').onclick = () => refreshCurrent(drawAreas, 'AREAS');
    await loadAreas(false);
  }
  async function loadAreas(force) { try { await ensureData(force, 'AREAS'); drawAreas(); } catch (error) { document.getElementById('mgmtAreas').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; } }
  function drawAreas() {
    const d = state.data || {}, root = document.getElementById('mgmtAreas'); if (!root) return;
    root.innerHTML = `<div class="mgmt-dashboard-grid"><div class="content-card mgmt-chart-card"><div class="mgmt-card-head"><div><h3>Wilayah Pendaftaran</h3><p>Asal pendaftaran terbanyak.</p></div></div>${barRanking(d.registrationRegions||[],12)}</div><div class="content-card mgmt-chart-card"><div class="mgmt-card-head"><div><h3>Wilayah Terkirim</h3><p>Tujuan pengantaran yang selesai.</p></div></div>${barRanking(d.deliveredRegions||[],12)}</div></div><div class="mgmt-dashboard-grid"><div class="content-card mgmt-chart-card"><div class="mgmt-card-head"><div><h3>Kecamatan</h3></div></div>${rankingTable(d.districts||[],'Kecamatan')}</div><div class="content-card mgmt-chart-card"><div class="mgmt-card-head"><div><h3>Alasan Gagal Antar</h3></div></div>${rankingTable(d.deliveryAnalytics?.failureReasons?.length ? d.deliveryAnalytics.failureReasons : d.failureReasons||[],'Alasan')}</div></div>`;
  }

  async function renderReports() {
    setManagementPageMode();
    page().innerHTML = `${hero('Laporan','Siapkan ringkasan periode untuk dicetak atau disimpan sebagai PDF.','LAPORAN')}<section class="section">${filterBar()}<div id="mgmtReports" class="mgmt-loading">Menyiapkan laporan…</div></section>`;
    bindFilter(() => loadReports(true));
    document.getElementById('mgmtRefresh').onclick = () => refreshCurrent(drawReports, 'REPORTS');
    await loadReports(false);
  }
  async function loadReports(force) { try { await ensureData(force, 'REPORTS'); drawReports(); } catch (error) { document.getElementById('mgmtReports').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; } }
  function drawReports() {
    const root = document.getElementById('mgmtReports'); if (!root) return;
    root.innerHTML = `<div class="report-actions"><button id="downloadManagementReport" class="primary-btn">Unduh PDF</button><button id="printManagementReport" class="secondary-btn">Cetak Laporan</button></div>${reportPreview(state.data||{})}`;
    document.getElementById('downloadManagementReport').onclick = e => downloadReport(state.data || {}, e.currentTarget);
    document.getElementById('printManagementReport').onclick = e => openReportPdf(state.data || {}, e.currentTarget);
  }

  function reportPreview(d) {
    const k = d.kpi || {}, v = d.verification || {}, inc = d.incidentSummary || {}, pharm = d.pharmacyPerformance || {staff:[]};
    return `<div class="content-card mgmt-report-preview"><div class="report-preview-head"><img src="./icons/logo-rsud.png" alt="Logo RSUD"><div><strong>RSUD Provinsi Nusa Tenggara Barat</strong><h2>Laporan MELESAT — Pengantaran Obat</h2><p>Periode ${fmtDate(d.meta?.start)}–${fmtDate(d.meta?.end)} • Hitung berdasarkan ${esc(d.meta?.basis === 'SELESAI' ? 'Tanggal Pengantaran Selesai' : 'Tanggal Pendaftaran')}</p></div></div>
      <div class="report-section"><h3>Key Performance Indicator (KPI)</h3><div class="report-summary-grid"><div><span>Total Pendaftaran</span><b>${n(k.total)}</b></div><div><span>Terkirim</span><b>${n(k.delivered)}</b></div><div><span>Gagal Antar</span><b>${n(k.failed)}</b></div><div><span>Tingkat Keberhasilan</span><b>${pct(k.successRate)}</b></div><div><span>Penerimaan Terverifikasi</span><b>${pct(v.rate)}</b></div><div><span>Kendala</span><b>${n(inc.total)}</b></div></div></div>
      <div class="report-section"><h3>Waktu Layanan</h3>${reportTimeStats(d.timeStats || {})}</div>
      ${d.activeIncidents?.length ? `<div class="report-section"><h3>Kendala Aktif</h3>${reportIncidentTable(d.activeIncidents)}</div>` : ''}
      <div class="report-section"><h3>Kinerja Farmasi</h3>${reportPharmacyTable(pharm.staff||[])}</div>
      <div class="report-section"><h3>Kinerja Kurir</h3>${reportCourierTable(d.couriers||[])}</div>
      <div class="report-section"><h3>Pengantaran Ulang</h3>${reportDeliverySummary(d.deliveryAnalytics||{})}</div>
      <div class="report-section"><h3>Wilayah dan Gagal Antar</h3><div class="grid grid-2">${rankingTable(d.deliveredRegions||[],'Kabupaten/Kota')}${rankingTable(d.deliveryAnalytics?.failureReasons||[],'Alasan Gagal Antar')}</div></div></div>`;
  }
  function reportTimeStats(stats = {}) {
    const entries = [
      ['Total Waktu Layanan',stats.total],['Pendaftaran hingga Siap Diantar',stats.pharmacy],['Menunggu Diambil Kurir',stats.consolidation],['Durasi Penyelesaian Pengantaran',stats.courier]
    ];
    return `<div class="report-time-grid">${entries.map(([label,x]) => { const sample=Number(x?.sample||0); if(!sample) return `<div><span>${esc(label)}</span><b>Belum ada data</b></div>`; if(sample<MIN_STATS_SAMPLE) return `<div><span>${esc(label)}</span><b>Mean (rata-rata) ${minutes(x.average)}</b><small>${n(sample)} pengantaran; Median/P90 belum cukup data</small></div>`; return `<div><span>${esc(label)}</span><b>Mean (rata-rata) ${minutes(x.average)}</b><small>Median (nilai tengah) ${minutes(x.median)} • P90 (90% selesai dalam) ≤ ${minutes(x.p90)}</small></div>`; }).join('')}</div>`;
  }
  function reportIncidentTable(rows = []) {
    if (!rows.length) return '<p>Tidak ada kendala aktif.</p>';
    return `<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>Kurir</th><th>Kendala</th><th>Perkiraan</th><th>Paket</th><th>Wilayah</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.courier||'—')}</td><td>${esc(x.type||'—')}${x.detail?`<br><small>${esc(x.detail)}</small>`:''}</td><td>${esc(x.delayEstimate||'—')}</td><td>${n(x.affectedCount||0)}</td><td>${esc((x.affectedAreas||[]).join(', ')||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function reportPharmacyTable(rows) {
    if (!rows.length) return '<p>Belum ada aktivitas Farmasi pada periode ini.</p>';
    return `<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>Petugas</th><th>Pendaftaran</th><th>Siap</th><th>Verifikasi</th><th>Tindak Lanjut</th><th>Pengantaran Ulang</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.name)}</td><td>${n(x.registrations)}</td><td>${n(x.ready)}</td><td>${n(x.verifications)}</td><td>${n(x.followUps)}</td><td>${n(x.redeliveries)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function reportCourierTable(rows) {
    if (!rows.length) return '<p>Belum ada aktivitas Kurir pada periode ini.</p>';
    return `<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>Kurir</th><th>Selesai</th><th>Terkirim</th><th>Gagal</th><th>Keberhasilan</th><th>Kendala</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.name)}</td><td>${n(Number(x.delivered||0)+Number(x.failed||0))}</td><td>${n(x.delivered)}</td><td>${n(x.failed)}</td><td>${pct(x.successRate)}</td><td>${n(x.incidents)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function reportDeliverySummary(a = {}) {
    return `<div class="report-summary-grid"><div><span>Total Pengantaran</span><b>${n(a.total)}</b></div><div><span>Berhasil Diantar</span><b>${n(a.delivered)}</b></div><div><span>Gagal Diantar</span><b>${n(a.failed)}</b></div><div><span>Kasus Pengantaran Ulang</span><b>${n(a.retriedCases)}</b></div><div><span>Pengantaran Ulang Berhasil</span><b>${n(a.retryDelivered)}</b></div><div><span>Ambil Mandiri</span><b>${n(a.selfPickup)}</b></div></div>`;
  }
  async function createReportBlob(d) {
    return buildManagementPdf(d,{logoUrl:new URL('./icons/logo-rsud.png',window.location.href).href,minimumStatsSample:MIN_STATS_SAMPLE});
  }

  async function downloadReport(d, button) {
    setBusy(button,true,'Menyiapkan PDF…');
    try {
      const blob = await createReportBlob(d);
      downloadPdfBlob(blob, reportFilename(d));
      ctx.showToast('PDF berhasil dibuat.', 'success');
    } catch (error) { ctx.showToast(error.message || 'PDF tidak dapat dibuat.', 'error'); }
    finally { setBusy(button,false); }
  }

  async function openReportPdf(d, button) {
    const preview = window.open('', '_blank');
    if (!preview) return ctx.showToast('Jendela laporan diblokir browser. Izinkan pop-up untuk aplikasi ini.', 'error');
    setBusy(button,true,'Menyiapkan PDF…');
    try {
      preview.document.write('<!doctype html><title>Menyiapkan laporan…</title><body style="font-family:Arial;padding:28px">Menyiapkan laporan PDF…</body>');
      const blob = await createReportBlob(d);
      const url = URL.createObjectURL(blob);
      preview.location.replace(url);
      setTimeout(()=>URL.revokeObjectURL(url),10*60*1000);
    } catch (error) { preview.close(); ctx.showToast(error.message || 'PDF tidak dapat dibuat.', 'error'); }
    finally { setBusy(button,false); }
  }


  function resetForLogout() {
    state.data = null;
    state.loading = null;
    state.lastLoadedKey = '';
    state.dataCache.clear();
    state.basis = 'DAFTAR';
    state.performanceTab = 'pharmacy';
    applyPreset('month');
  }

  return { renderHome, renderPerformance, renderAreas, renderReports, resetForLogout };
}
