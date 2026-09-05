import { APP_CONFIG } from './config.js?v=1.0.0';

export function createFarmasiModule(ctx) {
  const state = {
    master: { areas: [], manualVerificationMethods: [] },
    rows: [],
    pending: [],
    failedFollowUps: [],
    activeIncidents: [],
    lastCreated: null,
    loaded: false,
    loading: null,
    search: '',
    followUpFilter: 'all',
    followUpExpanded: {},
    followUpWaActions: {},
    timer: null,
    autoRefreshBusy: false
  };

  const esc = ctx.escapeHtml;
  const token = () => ctx.getToken();
  const api = () => ctx.getApi();
  const page = () => document.getElementById('pageContent');

  function syncFarmasiBadges() {
    if (typeof ctx.setNavBadge === 'function') {
      ctx.setNavBadge('verification', state.pending.length);
      ctx.setNavBadge('followup', state.failedFollowUps.length);
    }
  }

  function statusClass(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'MENUNGGU DIPROSES') return 'waiting';
    if (s === 'SIAP DIANTAR') return 'ready';
    if (s === 'DALAM PERJALANAN') return 'transit';
    if (s === 'TERKIRIM') return 'delivered';
    if (s === 'GAGAL ANTAR') return 'failed';
    return 'neutral';
  }

  function verificationClass(status) {
    const s = String(status || '').toUpperCase();
    if (!s) return 'neutral';
    if (s.includes('MENUNGGU')) return 'warning';
    if (s.includes('TERVERIFIKASI')) return 'success';
    if (s.includes('TIDAK')) return 'danger';
    return 'neutral';
  }

  function badge(text, kind = 'neutral') {
    if (!text) return '<span class="muted-text">Belum berlaku</span>';
    return `<span class="status-badge ${kind}">${esc(text)}</span>`;
  }

  function metric(label, value, note, icon = '', tone = '') {
    return `<div class="card metric-card ${tone}"><div class="metric-top"><span>${esc(label)}</span>${icon ? `<span class="metric-icon">${icon}</span>` : ''}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></div>`;
  }

  function buttonBusy(button, busy, busyText = 'Memproses…') {
    if (typeof ctx.setButtonBusy === 'function') return ctx.setButtonBusy(button,busy,busyText);
    if (!button) return;
    if (busy) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = busyText; }
    else { button.disabled = false; if (button.dataset.originalText) button.textContent = button.dataset.originalText; }
  }

  async function ensureData(force = false) {
    if (state.loaded && !force) return state;
    if (state.loading && !force) return state.loading;
    state.loading = (async () => {
      const res = await api().farmasiBootstrap(token());
      state.master = res.data?.master || state.master;
      state.rows = res.data?.rows || [];
      state.pending = res.data?.pending || [];
      state.failedFollowUps = res.data?.failedFollowUps || [];
      state.activeIncidents = res.data?.activeIncidents || [];
      state.loaded = true;
      syncFarmasiBadges();
      startAutoRefresh();
      return state;
    })();
    try { return await state.loading; }
    finally { state.loading = null; }
  }

  async function loadRows(search = state.search) {
    state.search = String(search || '');
    const res = await api().farmasiRows(token(), state.search);
    state.rows = res.data?.rows || [];
    return state.rows;
  }

  async function loadPending() {
    const res = await api().pendingReceiptVerifications(token());
    state.pending = res.data?.rows || [];
    syncFarmasiBadges();
    return state.pending;
  }

  async function loadFailedFollowUps() {
    const res = await api().failedDeliveryFollowUps(token());
    state.failedFollowUps = res.data?.rows || [];
    syncFarmasiBadges();
    return state.failedFollowUps;
  }

  async function loadActiveIncidents() {
    const res = await api().activeIncidents(token());
    state.activeIncidents = res.data?.rows || [];
    return state.activeIncidents;
  }

  async function loadSnapshot() {
    const res = await api().farmasiSnapshot(token());
    state.rows = res.data?.rows || [];
    state.pending = res.data?.pending || [];
    state.failedFollowUps = res.data?.failedFollowUps || [];
    state.activeIncidents = res.data?.activeIncidents || [];
    syncFarmasiBadges();
    return state;
  }

  function startAutoRefresh() {
    if (state.timer) return;
    state.timer = setInterval(() => refreshVisibleData({silent:true}).catch(() => {}), 30000);
  }

  async function refreshVisibleData({silent=true}={}) {
    if (!token() || state.autoRefreshBusy || document.hidden) return false;
    const view = typeof ctx.getView === 'function' ? ctx.getView() : '';
    if (!['home','registration','today','verification','followup'].includes(view)) return false;
    state.autoRefreshBusy = true;
    try {
      if (view === 'home') {
        await loadSnapshot();
        renderHomeData();
      } else if (view === 'registration') {
        await loadActiveIncidents();
        const banner=document.getElementById('farmasiRegistrationIncident');
        if (banner) banner.innerHTML=farmasiIncidentBanner();
      } else if (view === 'today') {
        await loadRows(state.search);
        renderTodayRows();
      } else if (view === 'verification') {
        await loadPending();
        renderVerificationRows();
      } else if (view === 'followup') {
        await loadFailedFollowUps();
        renderFollowUpData();
      }
      if (!silent) ctx.showToast('Data Farmasi diperbarui.','success');
      return true;
    } finally { state.autoRefreshBusy = false; }
  }

  async function refreshMaster() {
    const res = await api().refreshFarmasiMaster(token());
    state.master = res.data?.master || state.master;
    return state.master;
  }

  function rowById(id) {
    return state.rows.find(r => String(r['ID Sistem']) === String(id)) ||
      state.pending.find(r => String(r['ID Sistem']) === String(id)) || null;
  }

  function areaFromRecord(record = {}) {
    const village = String(record['Kelurahan'] || '').trim();
    const district = String(record['Kecamatan'] || '').trim();
    const region = String(record['Kabupaten/Kota'] || '').trim();
    return (state.master.areas || []).find(a => a.village === village && a.district === district && (!region || a.region === region)) || null;
  }

  function areaLabel(area) {
    return area ? `${area.village} — ${area.district} — ${area.region}` : '';
  }

  function renderDeliveryFields(record = {}, prefix = 'reg', options = {}) {
    const selected = areaFromRecord(record);
    const includeCourierNote = options.includeCourierNote !== false;
    const readonlyIdentity = options.readonlyIdentity === true;
    return `<div class="form-section">
      <div class="form-section-head"><span class="section-number">01</span><div><h3>Informasi Pasien</h3><p>Identitas minimum untuk proses pengantaran.</p></div></div>
      <div class="form-grid two">
        <div class="field"><label for="${prefix}-rm">No. RM <b>*</b></label><input id="${prefix}-rm" autocomplete="off" value="${esc(record['No RM'] || '')}" placeholder="Nomor rekam medis" ${readonlyIdentity?'readonly aria-readonly="true"':''}></div>
        <div class="field"><label for="${prefix}-name">Nama Pasien <b>*</b></label><input id="${prefix}-name" autocomplete="off" value="${esc(record['Nama Pasien'] || '')}" placeholder="Nama lengkap pasien" ${readonlyIdentity?'readonly aria-readonly="true"':''}></div>
        <div class="field"><label for="${prefix}-phone">No. WhatsApp <b>*</b></label><input id="${prefix}-phone" inputmode="tel" autocomplete="off" value="${esc(record['No WhatsApp'] || '')}" placeholder="08xxxxxxxxxx"></div>
        <div class="field"><label for="${prefix}-recipient">Nama Penerima <span>opsional</span></label><input id="${prefix}-recipient" autocomplete="off" value="${esc(record['Nama Penerima'] || '')}" placeholder="Kosongkan bila pasien sendiri"></div>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-head"><span class="section-number">02</span><div><h3>Alamat Pengantaran</h3><p>Pilih wilayah dari master agar kecamatan dan kabupaten/kota konsisten.</p></div></div>
      <div class="form-grid">
        <div class="field"><label for="${prefix}-address">Alamat Lengkap <b>*</b></label><textarea id="${prefix}-address" rows="3" placeholder="Nama jalan, nomor rumah, RT/RW bila ada">${esc(record['Alamat Lengkap'] || '')}</textarea></div>
        <div class="field area-field"><label for="${prefix}-area">Desa/Kelurahan <b>*</b></label><input id="${prefix}-area" autocomplete="off" value="${esc(areaLabel(selected))}" placeholder="Ketik desa, kecamatan, atau kabupaten…"><input id="${prefix}-areaKey" type="hidden" value="${esc(selected?.key || '')}"><div id="${prefix}-areaResults" class="area-results hidden"></div><div id="${prefix}-areaHint" class="field-hint"></div></div>
        <div class="field"><label for="${prefix}-landmark">Patokan Lokasi <b>*</b></label><textarea id="${prefix}-landmark" rows="2" placeholder="Contoh: rumah cat hijau di sebelah masjid">${esc(record['Patokan Lokasi'] || '')}</textarea></div>
        ${includeCourierNote ? `<div class="field"><label for="${prefix}-courierNote">Catatan untuk Kurir <span>opsional</span></label><textarea id="${prefix}-courierNote" rows="2" maxlength="600" placeholder="Contoh: titip di rumah sebelah sesuai konfirmasi pasien">${esc(record['Catatan Kurir'] || '')}</textarea><small class="field-help">Informasi tambahan untuk membantu lokasi atau penerima. Bukan untuk permintaan waktu pengantaran.</small></div>` : ''}
      </div>
    </div>`;
  }

  function formPayload(prefix = 'reg') {
    return {
      rm: document.getElementById(`${prefix}-rm`)?.value.trim() || '',
      name: document.getElementById(`${prefix}-name`)?.value.trim() || '',
      phone: document.getElementById(`${prefix}-phone`)?.value.trim() || '',
      recipient: document.getElementById(`${prefix}-recipient`)?.value.trim() || '',
      address: document.getElementById(`${prefix}-address`)?.value.trim() || '',
      areaKey: document.getElementById(`${prefix}-areaKey`)?.value.trim() || '',
      landmark: document.getElementById(`${prefix}-landmark`)?.value.trim() || '',
      courierNote: document.getElementById(`${prefix}-courierNote`)?.value.trim() || ''
    };
  }

  function validateForm(prefix = 'reg') {
    const required = [
      [`${prefix}-rm`, 'No. RM wajib diisi.'],
      [`${prefix}-name`, 'Nama pasien wajib diisi.'],
      [`${prefix}-phone`, 'Nomor WhatsApp wajib diisi.'],
      [`${prefix}-address`, 'Alamat lengkap wajib diisi.'],
      [`${prefix}-areaKey`, 'Pilih desa/kelurahan dari daftar pencarian.'],
      [`${prefix}-landmark`, 'Patokan lokasi wajib diisi.']
    ];
    for (const [id, message] of required) {
      const el = document.getElementById(id);
      if (!String(el?.value || '').trim()) {
        const focusId = id.endsWith('areaKey') ? `${prefix}-area` : id;
        document.getElementById(focusId)?.focus();
        ctx.showToast(message, 'error');
        return false;
      }
    }
    return true;
  }

  function updateAreaHint(prefix) {
    const key = document.getElementById(`${prefix}-areaKey`)?.value || '';
    const hint = document.getElementById(`${prefix}-areaHint`);
    if (!hint) return;
    const area = (state.master.areas || []).find(a => a.key === key);
    if (!area) {
      hint.className = 'field-hint';
      hint.textContent = 'Ketik lalu pilih wilayah dari daftar.';
      return;
    }
    const cls = String(area.status || '').toUpperCase() === 'AKTIF' ? 'active' : 'inactive';
    hint.className = `field-hint ${cls}`;
    hint.textContent = `${area.region} • Kecamatan ${area.district} • Cakupan ${area.status}${area.note ? ` • ${area.note}` : ''}`;
  }

  function filterAreas(prefix) {
    const input = document.getElementById(`${prefix}-area`);
    const hidden = document.getElementById(`${prefix}-areaKey`);
    const box = document.getElementById(`${prefix}-areaResults`);
    if (!input || !hidden || !box) return;

    const selected = (state.master.areas || []).find(a => a.key === hidden.value);
    if (selected && input.value !== areaLabel(selected)) hidden.value = '';

    const q = input.value.trim().toLowerCase();
    const all = state.master.areas || [];
    const score = a => {
      const v = a.village.toLowerCase(), d = a.district.toLowerCase(), r = a.region.toLowerCase();
      if (!q) return 6;
      if (v.startsWith(q)) return 0;
      if (d.startsWith(q)) return 1;
      if (r.startsWith(q)) return 2;
      if (v.includes(q)) return 3;
      if (d.includes(q)) return 4;
      if (r.includes(q)) return 5;
      return 99;
    };
    const results = all.filter(a => score(a) < 99).sort((a, b) => score(a) - score(b) || (a.status === 'AKTIF' ? -1 : 1) || a.village.localeCompare(b.village)).slice(0, 16);
    box.innerHTML = results.length ? results.map(a => `<button type="button" class="area-option" data-area-key="${esc(a.key)}"><strong>${esc(a.village)}</strong><span>Kecamatan ${esc(a.district)} • ${esc(a.region)}</span><em class="${String(a.status).toUpperCase() === 'AKTIF' ? 'ok' : 'off'}">${esc(a.status)}</em></button>`).join('') : '<div class="area-empty">Wilayah tidak ditemukan.</div>';
    box.classList.remove('hidden');
    box.querySelectorAll('[data-area-key]').forEach(btn => btn.addEventListener('mousedown', ev => {
      ev.preventDefault();
      const area = all.find(a => a.key === btn.dataset.areaKey);
      if (!area) return;
      input.value = areaLabel(area);
      hidden.value = area.key;
      box.classList.add('hidden');
      updateAreaHint(prefix);
      if (prefix === 'reg') saveDraft();
    }));
    updateAreaHint(prefix);
  }

  function bindAreaSearch(prefix) {
    const input = document.getElementById(`${prefix}-area`);
    const box = document.getElementById(`${prefix}-areaResults`);
    if (!input || !box) return;
    input.addEventListener('input', () => filterAreas(prefix));
    input.addEventListener('focus', () => filterAreas(prefix));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') box.classList.add('hidden'); });
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 120));
    updateAreaHint(prefix);
  }

  function saveDraft() {
    try { sessionStorage.setItem(APP_CONFIG.farmasiDraftKey, JSON.stringify(formPayload('reg'))); } catch (_) {}
  }

  function restoreDraft() {
    try {
      const raw = sessionStorage.getItem(APP_CONFIG.farmasiDraftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      ['rm','name','phone','recipient','address','landmark','courierNote'].forEach(k => {
        const el = document.getElementById(`reg-${k}`); if (el && d[k] != null) el.value = d[k];
      });
      const area = (state.master.areas || []).find(a => a.key === d.areaKey);
      if (area) {
        document.getElementById('reg-areaKey').value = area.key;
        document.getElementById('reg-area').value = areaLabel(area);
      }
      updateAreaHint('reg');
    } catch (_) { sessionStorage.removeItem(APP_CONFIG.farmasiDraftKey); }
  }

  function bindDraft() {
    ['rm','name','phone','recipient','address','area','landmark','courierNote'].forEach(k => {
      const el = document.getElementById(`reg-${k}`);
      if (!el) return;
      el.addEventListener('input', saveDraft);
      el.addEventListener('change', saveDraft);
    });
  }

  function clearRegistrationForm() {
    ['rm','name','phone','recipient','address','landmark','courierNote','area','areaKey'].forEach(k => {
      const el = document.getElementById(`reg-${k}`); if (el) el.value = '';
    });
    sessionStorage.removeItem(APP_CONFIG.farmasiDraftKey);
    updateAreaHint('reg');
  }

  function incidentTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return esc(String(value));
    return d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}).replace('.',':');
  }

  function farmasiIncidentBanner() {
    const incidents = state.activeIncidents || [];
    if (!incidents.length) return '';
    return `<div class="farmasi-incident-banner incident-stack"><div class="incident-stack-head"><div class="incident-icon">⚠</div><div><span>KENDALA KURIR AKTIF</span><strong>${incidents.length} kendala sedang berlangsung</strong><p>Pengantaran hari ini dapat mengalami keterlambatan.</p></div></div><div class="farmasi-incident-list">${incidents.map(item => {
      const areas = Array.isArray(item.affectedAreas) && item.affectedAreas.length ? item.affectedAreas.join(', ') : 'Wilayah terdampak belum terpetakan';
      return `<article><div class="farmasi-incident-name"><strong>${esc(item.courier || 'Kurir')}</strong><span>${esc(item.delayEstimate || 'Perkiraan belum diisi')}</span></div><b>${esc(item.type || 'Kendala operasional')}</b>${item.detail ? `<p>${esc(item.detail)}</p>` : ''}<small>Mulai ${incidentTime(item.startedAt)} • ${Number(item.affectedCount||0)} paket terdampak</small><small>${esc(areas)}</small></article>`;
    }).join('')}</div></div>`;
  }

  async function renderHome() {
    page().innerHTML = `<section class="hero compact brand-hero"><div><div class="eyebrow">FARMASI</div><h1>Ruang Kerja Farmasi</h1><p>Pendaftaran, kesiapan obat, label, dan verifikasi penerimaan dalam satu alur kerja.</p></div><img class="hero-brand-mascot" src="./icons/mascot-melesat.png" alt="" aria-hidden="true"><div class="hero-actions"><button id="homeRegister" class="primary-btn">＋ Daftarkan Pengantaran</button><button id="homeRefresh" class="secondary-btn">↻ Segarkan</button></div></section>
      <section class="section"><div id="farmasiIncidentBanner"></div><div id="farmasiHomeMetrics" class="grid grid-4">${metric('Memuat','—','Mengambil data hari ini')}</div></section>
      <section class="section"><div class="section-head"><div><h2>Perlu Tindakan</h2><p>Prioritas kerja yang membutuhkan perhatian petugas.</p></div></div><div id="farmasiAttention" class="grid grid-2"></div></section>`;
    document.getElementById('homeRegister')?.addEventListener('click', () => ctx.navigate('registration'));
    document.getElementById('homeRefresh')?.addEventListener('click', async e => {
      buttonBusy(e.currentTarget, true, 'Memuat…');
      try { await loadSnapshot(); renderHomeData(); ctx.showToast('Data Farmasi diperbarui.', 'success'); }
      catch (err) { ctx.showToast(err.message, 'error'); }
      finally { buttonBusy(e.currentTarget, false); }
    });
    try { await ensureData(); renderHomeData(); }
    catch (err) { document.getElementById('farmasiHomeMetrics').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  }

  function renderHomeData() {
    const counts = { waiting:0, ready:0, transit:0, delivered:0, failed:0 };
    state.rows.forEach(r => {
      const s = String(r['Status'] || '').toUpperCase();
      if (s === 'MENUNGGU DIPROSES') counts.waiting++;
      else if (s === 'SIAP DIANTAR') counts.ready++;
      else if (s === 'DALAM PERJALANAN') counts.transit++;
      else if (s === 'TERKIRIM') counts.delivered++;
      else if (s === 'GAGAL ANTAR') counts.failed++;
    });
    const incidentBanner = document.getElementById('farmasiIncidentBanner');
    if (incidentBanner) incidentBanner.innerHTML = farmasiIncidentBanner();
    const metrics = document.getElementById('farmasiHomeMetrics');
    if (metrics) metrics.innerHTML = [
      metric('Menunggu Diproses', counts.waiting, 'Belum ditandai siap', '◷'),
      metric('Siap Diantar', counts.ready, 'Menunggu diambil kurir', '▣', 'tone-ready'),
      metric('Dalam Perjalanan', counts.transit, 'Sedang diantar', '➜', 'tone-transit'),
      metric('Selesai Hari Ini', counts.delivered + counts.failed, `${counts.delivered} terkirim • ${counts.failed} gagal`, '✓', 'tone-success')
    ].join('');
    const attention = document.getElementById('farmasiAttention');
    if (attention) attention.innerHTML = `<button class="attention-card ${state.pending.length ? 'warn' : ''}" id="attentionVerification"><span class="attention-icon">✓</span><span><strong>${state.pending.length} menunggu verifikasi manual</strong><small>${state.pending.length ? 'Hubungi pasien/penerima dan selesaikan verifikasi.' : 'Tidak ada antrean verifikasi manual.'}</small></span><b>›</b></button>
      <button class="attention-card ${state.failedFollowUps.length ? 'danger-attention' : ''}" id="attentionFailed"><span class="attention-icon">↺</span><span><strong>${state.failedFollowUps.length} gagal antar perlu tindak lanjut</strong><small>${state.failedFollowUps.length ? 'Pantau pengembalian obat dan selesaikan tindak lanjut pelayanan.' : 'Tidak ada gagal antar yang menunggu Farmasi.'}</small></span><b>›</b></button>
      <button class="attention-card" id="attentionToday"><span class="attention-icon">▤</span><span><strong>${state.rows.length} pengantaran dipantau hari ini</strong><small>Lihat status dan aksi pengantaran pada menu Hari Ini.</small></span><b>›</b></button>`;
    document.getElementById('attentionVerification')?.addEventListener('click', () => ctx.navigate('verification'));
    document.getElementById('attentionFailed')?.addEventListener('click', () => ctx.navigate('followup'));
    document.getElementById('attentionToday')?.addEventListener('click', () => ctx.navigate('today'));
  }

  async function renderRegistration() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">PENDAFTARAN</div><h1>Daftarkan Pengantaran</h1><p>Isi data pengantaran dan pilih wilayah tujuan.</p></div><div class="hero-actions"><button id="registrationMasterRefresh" class="secondary-btn">↻ Muat Ulang Wilayah</button></div></section>
      <section class="section"><div id="farmasiRegistrationIncident"></div><div class="card form-card"><div id="registrationLoading" class="inline-loading">Memuat master wilayah…</div><form id="registrationForm" class="hidden">${renderDeliveryFields({}, 'reg')}<div class="form-actions"><label class="check-row"><input id="printAfterSave" type="checkbox" checked><span>Cetak label setelah simpan</span></label><div class="action-buttons"><button id="clearRegistration" class="secondary-btn" type="button">Bersihkan</button><button id="saveRegistration" class="primary-btn" type="submit">Simpan Pendaftaran</button></div></div></form></div></section>`;
    try {
      await ensureData();
      const incidentBanner = document.getElementById('farmasiRegistrationIncident');
      if (incidentBanner) incidentBanner.innerHTML = farmasiIncidentBanner();
      document.getElementById('registrationLoading')?.classList.add('hidden');
      document.getElementById('registrationForm')?.classList.remove('hidden');
      restoreDraft(); bindAreaSearch('reg'); bindDraft();
      document.getElementById('clearRegistration')?.addEventListener('click', clearRegistrationForm);
      document.getElementById('registrationMasterRefresh')?.addEventListener('click', async e => {
        buttonBusy(e.currentTarget, true, 'Memuat…');
        try { await refreshMaster(); ctx.showToast('Master wilayah diperbarui.', 'success'); filterAreas('reg'); }
        catch (err) { ctx.showToast(err.message, 'error'); }
        finally { buttonBusy(e.currentTarget, false); }
      });
      document.getElementById('registrationForm')?.addEventListener('submit', saveRegistration);
    } catch (err) {
      document.getElementById('registrationLoading').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  }

  async function saveRegistration(ev) {
    ev.preventDefault();
    if (!validateForm('reg')) return;
    const button = document.getElementById('saveRegistration');
    const shouldPrint = Boolean(document.getElementById('printAfterSave')?.checked);
    const printWindow = shouldPrint ? window.open('', '_blank', 'width=720,height=820') : null;
    buttonBusy(button, true, 'Menyimpan…');
    const payload = formPayload('reg');
    try {
      let res = await api().createDelivery(token(), payload);
      let data = res.data || {};
      if (data.requiresDuplicateConfirmation) {
        const d = data.duplicate || {};
        const proceed = await ctx.confirmAction({
          title: 'Pendaftaran dengan No. RM yang sama',
          message: `No. RM ${d.rm || payload.rm} sudah terdaftar hari ini dan prosesnya belum selesai.\n\nNama: ${d.name || '-'}\nWaktu daftar: ${d.registeredAt || '-'}\nStatus: ${d.status || '-'}\nWilayah: ${[d.village,d.district,d.region].filter(Boolean).join(', ') || '-'}\n\nTetap simpan sebagai pendaftaran baru?`,
          confirmLabel: 'Tetap Simpan',
          tone: 'warning'
        });
        if (!proceed) {
          if (printWindow) printWindow.close();
          ctx.showToast('Pendaftaran dibatalkan. Data sebelumnya tidak berubah.', 'info');
          return;
        }
        res = await api().createDelivery(token(), {...payload, confirmDuplicate:true});
        data = res.data || {};
      }
      if (!data.record) throw new Error('Respons penyimpanan tidak lengkap. Silakan coba kembali.');
      state.lastCreated = data.record;
      state.rows = [data.record, ...state.rows.filter(r => r['ID Sistem'] !== data.record['ID Sistem'])];
      clearRegistrationForm();
      if (shouldPrint) {
        if (printWindow) printLabelWindow(printWindow, data.record);
        else ctx.showToast('Jendela cetak diblokir browser. Gunakan menu Label.', 'error');
      }
      ctx.showToast(data.warning || (data.duplicateOverride ? 'Pendaftaran ulang berhasil disimpan setelah konfirmasi duplikasi.' : 'Pendaftaran berhasil disimpan.'), data.warning || data.duplicateOverride ? 'warning' : 'success', data.warning ? 7500 : 4200);
      if (data.waAction) openWhatsAppModal(data.waAction, data.record, { title:data.duplicateOverride ? 'Pendaftaran ulang berhasil' : 'Pendaftaran berhasil', allowPrint:true });
      setTimeout(() => loadRows('').catch(() => {}), 300);
    } catch (err) {
      if (printWindow) printWindow.close();
      ctx.showToast(err.message, 'error');
    } finally { buttonBusy(button, false); }
  }

  async function renderToday() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">HARI INI</div><h1>Pengantaran Hari Ini</h1><p>Pantau pendaftaran, kirim ulang kode penerimaan, cetak label, edit data yang masih menunggu, dan tandai obat siap.</p></div></section>
      <section class="section"><div class="toolbar-card"><div class="search-box"><span>⌕</span><input id="todaySearch" placeholder="Cari No. RM, nama, wilayah, atau status…" value="${esc(state.search)}"></div><button id="todayRefresh" class="secondary-btn">↻ Segarkan</button></div><div id="todayContent" class="content-card"><div class="inline-loading">Memuat data hari ini…</div></div></section>`;
    const search = document.getElementById('todaySearch');
    let timer;
    search?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => refreshToday(search.value), 280); });
    document.getElementById('todayRefresh')?.addEventListener('click', async e => {
      buttonBusy(e.currentTarget, true, 'Memuat…');
      try { await refreshToday(search?.value || ''); ctx.showToast('Data hari ini diperbarui.', 'success'); }
      catch (err) { ctx.showToast(err.message, 'error'); }
      finally { buttonBusy(e.currentTarget, false); }
    });
    try { await ensureData(); if (state.search) await loadRows(state.search); renderTodayRows(); }
    catch (err) { document.getElementById('todayContent').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  }

  async function refreshToday(search = '') {
    await loadRows(search);
    renderTodayRows();
  }

  function renderTodayRows() {
    const box = document.getElementById('todayContent');
    if (!box) return;
    if (!state.rows.length) {
      box.innerHTML = `<div class="empty-state"><div>▤</div><h3>Belum ada data</h3><p>Tidak ada pendaftaran yang sesuai dengan pencarian hari ini.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table class="responsive-table"><thead><tr><th>Jam</th><th>No. RM / Pasien</th><th>Wilayah</th><th>Status</th><th>Verifikasi</th><th>Aksi</th></tr></thead><tbody>${state.rows.map(r => `<tr class="status-row ${statusClass(r['Status'])}">
      <td data-label="Jam">${esc(String(r['Jam Daftar'] || '').slice(-5))}</td>
      <td data-label="Pasien"><strong>${esc(r['Nama Pasien'])}</strong>${r.__packageCode?`<span class="package-chip">${esc(r.__packageCode)}</span>`:''}${r.__isRetry?`<span class="retry-chip farmasi-retry-chip">PENGANTARAN KE-${Number(r.__attemptNo||2)}</span>`:''}<span class="cell-sub">No. RM ${esc(r['No RM'])}</span>${r.__courierNote?`<span class="cell-note"><b>Catatan Kurir:</b> ${esc(r.__courierNote)}</span>`:''}</td>
      <td data-label="Wilayah"><strong>${esc(r['Kelurahan'] || '-')}</strong><span class="cell-sub">${esc(r['Kecamatan'] || '')}${r['Kabupaten/Kota'] ? ` • ${esc(r['Kabupaten/Kota'])}` : ''}</span></td>
      <td data-label="Status">${badge(r['Status'], statusClass(r['Status']))}${r['Status Kendala'] ? `<div class="cell-gap">${badge(r['Status Kendala'], 'warning')}</div>` : ''}</td>
      <td data-label="Verifikasi">${badge(r['Status Verifikasi Penerimaan'], verificationClass(r['Status Verifikasi Penerimaan']))}</td>
      <td data-label="Aksi"><div class="row-actions"><button class="mini-btn" data-action="print" data-id="${esc(r['ID Sistem'])}">Cetak Label</button>${['MENUNGGU DIPROSES','SIAP DIANTAR','DALAM PERJALANAN'].includes(r['Status']) ? `<button class="mini-btn success" data-action="wa" data-id="${esc(r['ID Sistem'])}">WA Kode</button>` : ''}${r['Status'] === 'MENUNGGU DIPROSES' ? `<button class="mini-btn primary" data-action="ready" data-id="${esc(r['ID Sistem'])}">Siap Diantar</button><button class="mini-btn" data-action="edit" data-id="${esc(r['ID Sistem'])}">Edit</button>` : ''}</div></td>
    </tr>`).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => handleTodayAction(btn.dataset.action, btn.dataset.id, btn)));
  }

  async function handleTodayAction(action, id, button) {
    const record = rowById(id);
    if (action === 'print') return printRecord(record);
    if (action === 'edit') return openEdit(record);
    if (action === 'ready') return markReady(id, button);
    if (action === 'wa') return sendRegistrationWa(id, button);
  }

  async function sendRegistrationWa(id, button) {
    buttonBusy(button, true, 'Menyiapkan…');
    try {
      const res = await api().registrationWa(token(), id);
      openWhatsAppModal(res.data?.waAction, res.data?.record || rowById(id), {title:'Kirim kode penerimaan'});
    } catch (err) { ctx.showToast(err.message, 'error'); }
    finally { buttonBusy(button, false); }
  }

  async function markReady(id, button) {
    const record = rowById(id);
    const yes = await ctx.confirmAction({
      title:'Tandai obat siap diantar?',
      message:`Pastikan obat untuk ${record?.['Nama Pasien'] || 'pasien'} sudah selesai, benar, dan siap diserahkan kepada kurir.`,
      confirmLabel:'Ya, Siap Diantar'
    });
    if (!yes) return;
    buttonBusy(button, true, 'Menyimpan…');
    try {
      const res = await api().markReady(token(), id);
      const updated = res.data?.record;
      if (updated) state.rows = state.rows.map(r => r['ID Sistem'] === id ? updated : r);
      renderTodayRows();
      ctx.showToast('Obat ditandai SIAP DIANTAR.', 'success');
    } catch (err) { ctx.showToast(err.message, 'error'); }
    finally { buttonBusy(button, false); }
  }

  function openEdit(record) {
    if (!record) return ctx.showToast('Data tidak ditemukan. Segarkan halaman.', 'error');
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">KOREKSI PENDAFTARAN</div><h3>Edit Data</h3><p>${esc(record['Nama Pasien'])} • No. RM ${esc(record['No RM'])}</p></div><button class="modal-x" data-modal-close>×</button></div><form id="editForm">${renderDeliveryFields(record, 'edit')}<div class="modal-actions"><button type="button" class="secondary-btn" data-modal-close>Batal</button><button id="saveEdit" type="submit" class="primary-btn">Simpan Perubahan</button></div></form>`, {wide:true});
    bindAreaSearch('edit');
    document.getElementById('editForm')?.addEventListener('submit', async e => {
      e.preventDefault(); if (!validateForm('edit')) return;
      const btn = document.getElementById('saveEdit'); buttonBusy(btn, true, 'Menyimpan…');
      try {
        const res = await api().updateFarmasiRecord(token(), record['ID Sistem'], formPayload('edit'));
        const updated = res.data?.record;
        if (updated) state.rows = state.rows.map(r => r['ID Sistem'] === record['ID Sistem'] ? updated : r);
        ctx.closeModal(); renderTodayRows(); ctx.showToast('Data pendaftaran diperbarui.', 'success');
      } catch (err) { ctx.showToast(err.message, 'error'); }
      finally { buttonBusy(btn, false); }
    });
  }

  async function renderVerification() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">VERIFIKASI</div><h1>Verifikasi Penerimaan</h1><p>Penyerahan tanpa kode harus dikonfirmasi kembali sebelum dianggap terverifikasi manual.</p></div><div class="hero-actions"><button id="verificationRefresh" class="secondary-btn">↻ Segarkan</button></div></section><section class="section"><div id="verificationContent" class="content-card"><div class="inline-loading">Memuat antrean verifikasi…</div></div></section>`;
    document.getElementById('verificationRefresh')?.addEventListener('click', async e => {
      buttonBusy(e.currentTarget, true, 'Memuat…');
      try { await loadPending(); renderVerificationRows(); ctx.showToast('Antrean verifikasi diperbarui.', 'success'); }
      catch (err) { ctx.showToast(err.message, 'error'); }
      finally { buttonBusy(e.currentTarget, false); }
    });
    try { await ensureData(); await loadPending(); renderVerificationRows(); }
    catch (err) { document.getElementById('verificationContent').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  }

  function renderVerificationRows() {
    const box = document.getElementById('verificationContent'); if (!box) return;
    if (!state.pending.length) {
      box.innerHTML = `<div class="success-empty"><span>✓</span><div><strong>Tidak ada verifikasi tertunda</strong><p>Semua penyerahan tanpa kode yang masuk antrean sudah ditindaklanjuti.</p></div></div>`;
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table class="responsive-table"><thead><tr><th>Waktu Terkirim</th><th>Pasien</th><th>Kurir</th><th>Penerima Aktual</th><th>Alasan Tanpa Kode</th><th>Aksi</th></tr></thead><tbody>${state.pending.map(r => `<tr>
      <td data-label="Waktu">${esc(r['Waktu Terkirim'] || '-')}</td>
      <td data-label="Pasien"><strong>${esc(r['Nama Pasien'])}</strong>${r.__isRetry?`<span class="retry-chip farmasi-retry-chip">PENGANTARAN KE-${Number(r.__attemptNo||2)}</span>`:''}<span class="cell-sub">No. RM ${esc(r['No RM'])}</span>${r.__courierNote?`<span class="cell-note"><b>Catatan Kurir:</b> ${esc(r.__courierNote)}</span>`:''}</td>
      <td data-label="Kurir">${esc(r['Kurir'] || '-')}</td>
      <td data-label="Penerima">${esc(r['Nama Penerima Aktual'] || '-')}<span class="cell-sub">${esc(r['Hubungan Penerima'] || '')}</span></td>
      <td data-label="Alasan">${esc(r['Alasan Tanpa Kode'] || '-')}</td>
      <td data-label="Aksi"><div class="row-actions"><button class="mini-btn success" data-vaction="wa" data-id="${esc(r['ID Sistem'])}">💬 WA Konfirmasi</button>${r['Link Telepon'] ? `<a class="mini-btn" href="${esc(r['Link Telepon'])}">📞 Telepon</a>` : ''}<button class="mini-btn primary" data-vaction="verify" data-id="${esc(r['ID Sistem'])}">✓ Verifikasi</button></div></td>
    </tr>`).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-vaction]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.vaction === 'wa') sendManualWa(btn.dataset.id, btn);
      else openManualVerification(btn.dataset.id);
    }));
  }

  async function sendManualWa(id, button) {
    buttonBusy(button, true, 'Menyiapkan…');
    try {
      const res = await api().manualReceiptWa(token(), id);
      openWhatsAppModal(res.data?.waAction, res.data?.record || rowById(id), {title:'Konfirmasi penerimaan obat', description:'Setelah pasien/penerima membalas SUDAH DITERIMA, lanjutkan dengan tombol Verifikasi.'});
    } catch (err) { ctx.showToast(err.message, 'error'); }
    finally { buttonBusy(button, false); }
  }

  function openManualVerification(id) {
    const r = rowById(id); if (!r) return ctx.showToast('Data tidak ditemukan. Segarkan halaman.', 'error');
    const methods = state.master.manualVerificationMethods?.length ? state.master.manualVerificationMethods : ['TELEPON','WHATSAPP','KONFIRMASI LANGSUNG','LAINNYA'];
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">VERIFIKASI MANUAL</div><h3>Konfirmasi Penerimaan</h3><p>${esc(r['Nama Pasien'])} • No. RM ${esc(r['No RM'])}</p></div><button class="modal-x" data-modal-close>×</button></div>
      <div class="notice-box">Simpan hanya setelah pasien atau penerima menyatakan bahwa obat sudah diterima.</div>
      <button id="fillWaVerification" class="secondary-btn" style="margin-top:12px">💬 Isi: Sudah diterima via WA</button>
      <div class="form-grid" style="margin-top:16px"><div class="field"><label for="verifyMethod">Metode verifikasi <b>*</b></label><select id="verifyMethod"><option value="">Pilih metode</option>${methods.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select></div><div class="field"><label for="verifyNote">Catatan hasil verifikasi <b>*</b></label><textarea id="verifyNote" rows="3" placeholder="Contoh: Pasien mengonfirmasi melalui WhatsApp bahwa obat telah diterima."></textarea></div></div>
      <div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="saveManualVerify" class="primary-btn">Simpan Verifikasi</button></div>`);
    document.getElementById('fillWaVerification')?.addEventListener('click', () => {
      const method = document.getElementById('verifyMethod'); const note = document.getElementById('verifyNote');
      if ([...method.options].some(o => String(o.value).toUpperCase() === 'WHATSAPP')) method.value = 'WHATSAPP';
      note.value = 'Pasien/penerima mengonfirmasi melalui WhatsApp bahwa obat telah diterima.';
      note.focus();
    });
    document.getElementById('saveManualVerify')?.addEventListener('click', async e => {
      const method = document.getElementById('verifyMethod').value;
      const note = document.getElementById('verifyNote').value.trim();
      if (!method) return ctx.showToast('Pilih metode verifikasi.', 'error');
      if (!note) return ctx.showToast('Catatan hasil verifikasi wajib diisi.', 'error');
      buttonBusy(e.currentTarget, true, 'Menyimpan…');
      try {
        await api().manualVerifyReceipt(token(), id, method, note);
        state.pending = state.pending.filter(x => x['ID Sistem'] !== id);
        ctx.closeModal(); renderVerificationRows(); ctx.showToast('Verifikasi manual penerimaan disimpan.', 'success');
      } catch (err) { ctx.showToast(err.message, 'error'); }
      finally { buttonBusy(e.currentTarget, false); }
    });
  }

  async function renderLabels() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">LABEL A6</div><h1>Label Pengantaran</h1><p>Cetak atau cetak ulang label dari pendaftaran hari ini. Kode penerimaan tidak dicetak pada label.</p></div><div class="hero-actions"><button id="labelsRefresh" class="secondary-btn">↻ Segarkan</button></div></section><section class="section"><div id="labelsContent" class="label-grid"><div class="inline-loading">Memuat label hari ini…</div></div></section>`;
    document.getElementById('labelsRefresh')?.addEventListener('click', async e => {
      buttonBusy(e.currentTarget, true, 'Memuat…');
      try { await loadRows(''); renderLabelCards(); ctx.showToast('Daftar label diperbarui.', 'success'); }
      catch (err) { ctx.showToast(err.message, 'error'); }
      finally { buttonBusy(e.currentTarget, false); }
    });
    try { await ensureData(); if (state.search) await loadRows(''); renderLabelCards(); }
    catch (err) { document.getElementById('labelsContent').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  }

  function renderLabelCards() {
    const box = document.getElementById('labelsContent'); if (!box) return;
    if (!state.rows.length) return void (box.innerHTML = `<div class="empty-state"><div>▣</div><h3>Belum ada label</h3><p>Pendaftaran hari ini akan muncul di sini.</p></div>`);
    box.innerHTML = state.rows.map(r => `<article class="label-card ${statusClass(r['Status'])}"><div class="label-card-top"><strong class="package-code">${esc(r['Kode Paket'] || r.__packageCode || '—')}</strong>${badge(r['Status'], statusClass(r['Status']))}</div><h3>${esc(r['Nama Pasien'])}</h3><p>No. RM ${esc(r['No RM'])} • ${esc(String(r['Jam Daftar'] || '').slice(-5))}</p><div class="label-location"><strong>${esc(r['Kelurahan'] || '-')}</strong><span>${esc(r['Kecamatan'] || '')} • ${esc(r['Kabupaten/Kota'] || '')}</span></div><button class="secondary-btn wide" data-label-print="${esc(r['ID Sistem'])}">▣ Cetak Label A6</button></article>`).join('');
    box.querySelectorAll('[data-label-print]').forEach(btn => btn.addEventListener('click', () => printRecord(rowById(btn.dataset.labelPrint))));
  }

  function printRecord(record) {
    if (!record) return ctx.showToast('Data tidak ditemukan. Segarkan halaman.', 'error');
    printLabelWindow(window.open('', '_blank', 'width=720,height=820'), record);
  }

  function printLabelWindow(w, r) {
    if (!w) return ctx.showToast('Jendela cetak diblokir browser. Izinkan pop-up untuk aplikasi ini.', 'error');
    const phone = String(r['No WhatsApp'] || '');
    const phoneView = phone ? `+${phone}` : '';
    const time = String(r['Jam Daftar'] || '').slice(-5);
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Label ${esc(r['Nama Pasien'])}</title><style>@page{size:A6 portrait;margin:6mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#111}.label{border:2px solid #111;padding:6mm;min-height:132mm}.head{text-align:center;border-bottom:2px solid #111;padding-bottom:3mm;margin-bottom:4mm}.head h1{font-size:17px;margin:0}.head p{font-size:10px;margin:2mm 0 0}.package{display:flex;align-items:center;justify-content:space-between;border:2px solid #111;padding:3mm 4mm;margin:0 0 4mm}.package span{font-size:10px;font-weight:700;letter-spacing:.7px}.package strong{font-size:24px;letter-spacing:1px}.name{font-size:22px;font-weight:800;margin:0 0 3mm}.row{display:grid;grid-template-columns:30mm 1fr;gap:2mm;font-size:12px;line-height:1.35;margin:1.5mm 0}.key{font-weight:700}.address{border:1px solid #333;padding:3mm;margin-top:3mm;font-size:12px;line-height:1.4}.foot{border-top:1px solid #333;margin-top:4mm;padding-top:3mm;font-size:9px}.no-print{margin:12px;text-align:center}.no-print button{padding:10px 16px;font-weight:700}@media print{.no-print{display:none}.label{border:2px solid #111}}</style></head><body><div class="label"><div class="head"><h1>LAYANAN PENGANTARAN OBAT</h1><p>RSUD PROVINSI NUSA TENGGARA BARAT</p></div><div class="package"><span>KODE PAKET</span><strong>${esc(r['Kode Paket'] || r.__packageCode || 'BELUM TERSEDIA')}</strong></div><div class="name">${esc(r['Nama Pasien'])}</div><div class="row"><div class="key">No. RM</div><div>${esc(r['No RM'])}</div></div><div class="row"><div class="key">Penerima</div><div>${esc(r['Nama Penerima'] || r['Nama Pasien'])}</div></div><div class="row"><div class="key">No. WA</div><div>${esc(phoneView)}</div></div><div class="row"><div class="key">Wilayah</div><div>${esc(r['Kelurahan'])}, Kec. ${esc(r['Kecamatan'])}<br>${esc(r['Kabupaten/Kota'] || '')}</div></div><div class="address"><div class="key">ALAMAT</div><div>${esc(r['Alamat Lengkap'])}</div><div style="margin-top:2mm"><span class="key">Patokan:</span> ${esc(r['Patokan Lokasi'])}</div></div><div class="row"><div class="key">Daftar</div><div>${esc(r['Tanggal Daftar'])} ${esc(time)}</div></div><div class="row"><div class="key">ID Sistem</div><div style="font-size:9px">${esc(r['ID Sistem'])}</div></div><div class="foot">RAHASIA — hanya untuk proses pengantaran obat. Paket tidak boleh dibuka selama pengantaran.</div></div><div class="no-print"><button onclick="window.print()">Cetak</button></div><script>setTimeout(()=>window.print(),350)<\/script></body></html>`);
    w.document.close(); w.focus();
  }

  function openWhatsAppModal(waAction, record, options = {}) {
    if (!waAction) return ctx.showToast('Pesan WhatsApp tidak tersedia.', 'error');
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">WHATSAPP</div><h3>${esc(options.title || 'Kirim pesan')}</h3><p>${esc(options.description || 'Periksa pesan sebelum membuka WhatsApp.')}</p></div><button class="modal-x" data-modal-close>×</button></div>
      <div class="wa-meta"><span>Tujuan</span><strong>${esc(waAction.phoneDisplay || waAction.phone || '-')}</strong><span>Pasien</span><strong>${esc(record?.['Nama Pasien'] || '-')}</strong></div>
      <div class="wa-preview">${esc(waAction.message || '')}</div>
      <div class="modal-actions">${options.allowPrint ? '<button id="waPrintLabel" class="secondary-btn">Cetak Label</button>' : ''}<button class="secondary-btn" data-modal-close>Tutup</button><button id="openWhatsApp" class="whatsapp-btn" ${waAction.url ? '' : 'disabled'}>💬 Buka WhatsApp</button></div>`);
    document.getElementById('openWhatsApp')?.addEventListener('click', () => { if (waAction.url) window.open(waAction.url, '_blank', 'noopener'); });
    document.getElementById('waPrintLabel')?.addEventListener('click', () => printRecord(record));
  }


  function witaParts(date=new Date()){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const get=t=>parts.find(x=>x.type===t)?.value||'';
    return {y:get('year'),m:get('month'),d:get('day')};
  }
  function todayKey(){const p=witaParts();return `${p.y}-${p.m}-${p.d}`;}
  function addDaysKey(key,days){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key||''));if(!m)return '';const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])+Number(days||0),12));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;}
  function tomorrowKey(){return addDaysKey(todayKey(),1);}
  function normalizeDateKey(value){const text=String(value||'').trim();const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
  function isDateDue(value){const key=normalizeDateKey(value);return Boolean(key)&&key<=todayKey();}
  function formatDateId(value){const key=normalizeDateKey(value);if(!key)return String(value||'');const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(key);const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),12));return new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(d);}
  function safeDomId(value){return String(value||'').replace(/[^a-zA-Z0-9_-]/g,'_');}
  function followUpId(item){return String(item?.record?.['ID Sistem']||item?.attempt?.parentId||'');}
  function followUpPhase(item){
    const a=item?.attempt||{};
    const returned=String(a.returnStatus||'')==='SUDAH KEMBALI';
    const resolution=String(a.resolution||'');
    if(resolution==='MENUNGGU AMBIL MANDIRI'||a.waitingSelfPickup)return 'pickup';
    if(!returned)return 'return';
    if(Number(a.attemptNo||1)>=Number(a.maxAttempts||2))return 'contact';
    if(!String(a.followupWaAt||'').trim())return 'contact';
    if(normalizeDateKey(a.plannedDate))return 'retry';
    return 'decision';
  }

  async function renderFollowUp(){
    page().innerHTML=`<section class="hero compact"><div><div class="eyebrow">TINDAK LANJUT FARMASI</div><h1>Gagal Antar & Pengantaran Ulang</h1><p>Kelola pengembalian obat, konfirmasi pasien, pengantaran ulang, dan pengambilan mandiri.</p></div><div class="hero-actions"><button id="followUpRefresh" class="secondary-btn">↻ Segarkan</button></div></section>
      <section class="section"><div id="followUpMetrics" class="grid grid-5 followup-metrics"></div></section>
      <section class="section"><div class="toolbar-card followup-toolbar"><div class="followup-filter-group">
        <button class="filter-chip" data-follow-filter="all">Semua</button><button class="filter-chip" data-follow-filter="return">Menunggu Obat</button><button class="filter-chip" data-follow-filter="contact">Konfirmasi Pasien</button><button class="filter-chip" data-follow-filter="decision">Perlu Keputusan</button><button class="filter-chip" data-follow-filter="retry">Pengantaran Ulang</button><button class="filter-chip" data-follow-filter="pickup">Ambil Mandiri</button>
      </div><div class="followup-policy">Maksimal <b>2 kali pengantaran ke rumah</b>. Jika pengantaran ke-2 gagal, obat dilanjutkan melalui pengambilan mandiri di Loket Farmasi.</div></div></section>
      <section class="section"><div id="followUpContent" class="followup-worklist"><div class="inline-loading">Memuat tindak lanjut…</div></div></section>`;
    document.getElementById('followUpRefresh')?.addEventListener('click',async e=>{buttonBusy(e.currentTarget,true,'Memuat…');try{await loadFailedFollowUps();renderFollowUpData();ctx.showToast('Tindak lanjut diperbarui.','success');}catch(x){ctx.showToast(x.message,'error')}finally{buttonBusy(e.currentTarget,false)}});
    document.querySelectorAll('[data-follow-filter]').forEach(b=>b.addEventListener('click',()=>{state.followUpFilter=b.dataset.followFilter||'all';renderFollowUpData();}));
    try{await ensureData();await loadFailedFollowUps();renderFollowUpData();}catch(err){document.getElementById('followUpContent').innerHTML=`<div class="alert error">${esc(err.message)}</div>`;}
  }

  function renderFollowUpData(anchorId=''){
    const rows=state.failedFollowUps||[];
    const counts={return:0,contact:0,decision:0,retry:0,pickup:0};
    rows.forEach(item=>{const p=followUpPhase(item);if(counts[p]!==undefined)counts[p]++;});
    const metrics=document.getElementById('followUpMetrics');
    if(metrics)metrics.innerHTML=[
      metric('Perlu Tindakan',rows.length,'Total antrean aktif','↺'),
      metric('Menunggu Obat',counts.return,'Belum diterima kembali','▣'),
      metric('Konfirmasi Pasien',counts.contact,'Perlu WhatsApp','💬'),
      metric('Pengantaran Ulang',counts.retry,'Terjadwal / siap dibuat','➜'),
      metric('Ambil Mandiri',counts.pickup,'Menunggu di loket','●')
    ].join('');
    document.querySelectorAll('[data-follow-filter]').forEach(b=>b.classList.toggle('active',(b.dataset.followFilter||'all')===state.followUpFilter));
    const filtered=state.followUpFilter==='all'?rows:rows.filter(x=>followUpPhase(x)===state.followUpFilter);
    const content=document.getElementById('followUpContent');
    if(!content)return;
    content.innerHTML=filtered.length?filtered.map(failedFollowUpCard).join(''):`<div class="empty-state"><h3>${rows.length?'Tidak ada kasus pada filter ini':'Tidak ada tindak lanjut aktif'}</h3><p>${rows.length?'Pilih filter lain untuk melihat antrean.':'Semua gagal antar sudah selesai ditindaklanjuti.'}</p></div>`;
    bindFollowUpEvents();
    syncFarmasiBadges();
    if(anchorId)requestAnimationFrame(()=>document.getElementById(`follow-card-${safeDomId(anchorId)}`)?.scrollIntoView({block:'nearest',behavior:'auto'}));
  }

  function failedFollowUpCard(item){
    const a=item.attempt||{},r=item.record||{};const id=followUpId(item),dom=safeDomId(id);
    const returned=String(a.returnStatus||'')==='SUDAH KEMBALI';const provisional=String(a.status||'')==='GAGAL DILAPORKAN'&&!a.result;
    const contacted=Boolean(String(a.followupWaAt||'').trim());const planned=normalizeDateKey(a.plannedDate);const due=planned?isDateDue(planned):false;
    const attemptNo=Number(a.attemptNo||1),maxAttempts=Number(a.maxAttempts||2),maxReached=attemptNo>=maxAttempts;
    const resolution=String(a.resolution||'');const waitingPickup=resolution==='MENUNGGU AMBIL MANDIRI'||Boolean(a.waitingSelfPickup);
    const stateBadge='<span class="status-badge failed">GAGAL ANTAR</span>';
    let action='';
    if(!returned){
      action=`<div class="followup-action-zone"><div class="notice-box">Gagal Antar sudah ditetapkan untuk hari ini. Obat wajib dikembalikan ke Farmasi; setelah obat diterima kembali, Farmasi menentukan tindak lanjut pelayanan.</div><button class="primary-btn" data-confirm-return="${esc(id)}">✓ Konfirmasi Obat Sudah Kembali</button></div>`;
    }else if(waitingPickup){
      const wa=state.followUpWaActions[id];
      action=`<div class="followup-action-zone"><div class="pickup-wait-box"><span class="status-badge warning">MENUNGGU AMBIL MANDIRI</span><h5>Obat menunggu di Loket Farmasi</h5><p>Kasus baru selesai setelah obat benar-benar diserahkan kepada pasien/penerima.</p>${wa?.url?`<a class="mini-btn" href="${esc(wa.url)}" target="_blank" rel="noopener">💬 Buka ulang WhatsApp</a>`:''}</div><button class="primary-btn" data-open-follow-panel="pickupConfirm" data-id="${esc(id)}">✓ Konfirmasi Obat Telah Diambil</button></div>`;
    }else if(maxReached){
      action=`<div class="followup-action-zone"><div class="max-attempt-box"><span class="status-badge failed">BATAS PENGANTARAN TERCAPAI</span><h5>Pengantaran telah gagal ${maxAttempts} kali</h5><p>Tidak ada pengantaran ke-${attemptNo+1}. Setelah obat kembali, pasien wajib diberi tahu untuk mengambil obat secara mandiri di Loket Farmasi.</p></div><button class="whatsapp-btn" data-followup-wa="${esc(id)}">💬 WA Pasien — Ambil Mandiri</button></div>`;
    }else if(!contacted){
      action=`<div class="followup-action-zone"><div class="notice-box">Hubungi pasien terlebih dahulu. Pesan ini belum menetapkan tanggal pengantaran ulang.</div><button class="whatsapp-btn" data-followup-wa="${esc(id)}">💬 WA Konfirmasi Pasien</button></div>`;
    }else if(!planned){
      action=`<div class="followup-action-zone"><div class="followup-confirmed"><span class="status-badge success">✓ WA TINDAK LANJUT DISIAPKAN</span><small>WA disiapkan ${esc(a.followupWaAt||'')}</small></div><div class="row-actions"><button class="primary-btn" data-open-follow-panel="schedule" data-id="${esc(id)}">Jadwalkan Pengantaran Ulang</button><button class="secondary-btn" data-open-follow-panel="pickup" data-id="${esc(id)}">Ambil Mandiri</button><button class="danger-soft-btn" data-open-follow-panel="close" data-id="${esc(id)}">Tutup Layanan</button></div></div>`;
    }else{
      action=`<div class="followup-action-zone"><div class="followup-confirmed"><span class="status-badge success">✓ WA TINDAK LANJUT DISIAPKAN</span><small>WA disiapkan ${esc(a.followupWaAt||'')}</small></div><div class="retry-plan-box"><div><span>Rencana pengantaran ulang</span><b>${planned===todayKey()?'HARI INI • ':''}${esc(formatDateId(planned))}</b></div><button class="mini-btn" data-open-follow-panel="schedule" data-id="${esc(id)}">Edit Rencana</button></div><div class="row-actions">${due?`<button class="primary-btn" data-open-follow-panel="retry" data-id="${esc(id)}">Buat Pengantaran ke-${attemptNo+1}</button>`:`<button class="primary-btn" disabled title="Pengantaran baru aktif pada tanggal rencana">Belum Waktunya Pengantaran Ulang</button>`}<button class="secondary-btn" data-open-follow-panel="pickup" data-id="${esc(id)}">Ambil Mandiri</button><button class="danger-soft-btn" data-open-follow-panel="close" data-id="${esc(id)}">Tutup Layanan</button></div></div>`;
    }
    const expanded=state.followUpExpanded[id]||'';
    return `<article class="redelivery-card followup-page-card" id="follow-card-${dom}" data-followup-card="${esc(id)}"><div class="redelivery-head"><div>${stateBadge}${attemptNo>1?` <span class="status-badge warning">PENGANTARAN KE-${attemptNo}</span>`:''}<h4>${esc(r['Nama Pasien']||'-')}</h4><p>No. RM ${esc(r['No RM']||'-')} • ${esc([r['Kelurahan'],r['Kecamatan']].filter(Boolean).join(' • '))}</p></div><div class="return-state ${returned?'ok':'wait'}">${returned?'✓ Obat sudah kembali':'Menunggu obat kembali'}</div></div><div class="redelivery-detail"><div><span>Kurir</span><b>${esc(a.courier||r['Kurir']||'-')}</b></div><div><span>Alasan</span><b>${esc(a.failureReason||r['Alasan Gagal']||'-')}</b></div><div><span>Status obat</span><b>${returned?'Sudah diterima Farmasi':'Wajib dikembalikan ke Farmasi'}</b></div><div><span>Waktu laporan</span><b>${esc(a.failureReportedAt||a.completedAt||'-')}</b></div></div>${a.failureDetail?`<p class="redelivery-note">${esc(a.failureDetail)}</p>`:''}${action}${expanded?followUpInlinePanel(item,expanded):''}</article>`;
  }

  function followUpInlinePanel(item,panel){
    const a=item.attempt||{},r=item.record||{},id=followUpId(item),dom=safeDomId(id);const planned=normalizeDateKey(a.plannedDate);const today=todayKey(),tomorrow=tomorrowKey();
    if(panel==='schedule'){
      const selected=planned||tomorrow;const mode=planned===today?'today':(!planned||planned===tomorrow?'tomorrow':'other');
      return `<div class="followup-inline-panel"><div class="inline-panel-head"><div><span>JADWAL PENGANTARAN ULANG</span><h5>${planned?'Edit':'Tentukan'} rencana pengantaran ulang</h5></div><button class="mini-btn" data-close-follow-panel="${esc(id)}">Tutup</button></div><div class="notice-box">Pilihan utama adalah besok/hari operasional berikutnya. Hari ini hanya bila kondisi pelayanan dan Kurir masih memungkinkan.</div><form data-schedule-form="${esc(id)}"><div class="retry-date-options compact"><label class="retry-date-option"><input type="radio" name="retry-mode-${dom}" value="tomorrow" ${mode==='tomorrow'?'checked':''}><span><b>Besok / hari operasional berikutnya</b><small>${esc(formatDateId(tomorrow))}</small></span></label><label class="retry-date-option"><input type="radio" name="retry-mode-${dom}" value="today" ${mode==='today'?'checked':''}><span><b>Hari ini</b><small>${esc(formatDateId(today))} • pengecualian</small></span></label><label class="retry-date-option"><input type="radio" name="retry-mode-${dom}" value="other" ${mode==='other'?'checked':''}><span><b>Tanggal lain</b><small>Sesuai keputusan Farmasi / hari operasional.</small></span></label></div><div class="field ${mode==='other'?'':'hidden'}" data-custom-date-wrap="${dom}"><label>Tanggal pengantaran ulang *</label><input type="date" data-custom-date="${dom}" value="${esc(mode==='other'?selected:tomorrow)}" min="${esc(today)}"></div><label class="check-row same-day-confirm ${mode==='today'?'':'hidden'}" data-today-confirm-wrap="${dom}"><input type="checkbox" data-today-confirm="${dom}" ${mode==='today'?'':' '}><span>Saya sudah memastikan pengantaran ulang hari ini masih memungkinkan secara operasional.</span></label><div class="inline-actions"><button type="button" class="secondary-btn" data-close-follow-panel="${esc(id)}">Batal</button><button type="submit" class="primary-btn">Simpan Rencana</button></div></form></div>`;
    }
    if(panel==='retry'){
      const schedule=planned,prefix=`retry-${dom}`;
      if(!schedule)return '';
      return `<div class="followup-inline-panel retry-inline-panel"><div class="inline-panel-head"><div><span>PENGANTARAN ULANG</span><h5>Buat Pengantaran ke-${Number(a.attemptNo||1)+1}</h5><p>No. RM dan nama pasien otomatis dari pendaftaran awal.</p></div><button class="mini-btn" data-close-follow-panel="${esc(id)}">Tutup</button></div><form data-inline-retry="${esc(id)}" data-prefix="${prefix}">${renderDeliveryFields({...r,'Catatan Kurir':(a.courierNote||r['Catatan Kurir']||'')},prefix,{includeCourierNote:true,readonlyIdentity:true})}<div class="field"><label>Tanggal pengantaran ulang</label><div class="readonly-date-value">${esc(formatDateId(schedule))}${schedule===today?' • HARI INI':''}</div></div><div class="notice-box">Kode penerimaan lama tidak berlaku. Sistem membuat kode baru untuk Pengantaran ke-${Number(a.attemptNo||1)+1}. Setelah dibuat, kasus kembali masuk menu Hari Ini Farmasi.</div><div class="inline-actions"><button type="button" class="secondary-btn" data-close-follow-panel="${esc(id)}">Batal</button><button type="submit" class="primary-btn">Buat Pengantaran ke-${Number(a.attemptNo||1)+1}</button></div></form></div>`;
    }
    if(panel==='pickup')return `<div class="followup-inline-panel"><div class="inline-panel-head"><div><span>AMBIL MANDIRI</span><h5>Pasien memilih mengambil obat di Farmasi</h5></div><button class="mini-btn" data-close-follow-panel="${esc(id)}">Tutup</button></div><div class="notice-box">Simpan pilihan ini setelah pasien mengonfirmasi. Kasus tetap berada di Tindak Lanjut sampai obat benar-benar diambil.</div><div class="field"><label>Catatan <span>opsional</span></label><textarea data-pickup-note="${dom}" rows="2">Pasien/penerima memilih mengambil obat secara mandiri di Loket Farmasi.</textarea></div><div class="inline-actions"><button class="secondary-btn" data-close-follow-panel="${esc(id)}">Batal</button><button class="primary-btn" data-save-pickup="${esc(id)}">Simpan & Tunggu Pengambilan</button></div></div>`;
    if(panel==='pickupConfirm')return `<div class="followup-inline-panel"><div class="inline-panel-head"><div><span>KONFIRMASI LOKET</span><h5>Obat benar-benar sudah diambil?</h5></div><button class="mini-btn" data-close-follow-panel="${esc(id)}">Tutup</button></div><div class="field"><label>Catatan serah terima <span>opsional</span></label><textarea data-pickup-confirm-note="${dom}" rows="2">Obat telah diserahkan langsung di Loket Farmasi kepada pasien/penerima.</textarea></div><div class="inline-actions"><button class="secondary-btn" data-close-follow-panel="${esc(id)}">Batal</button><button class="primary-btn" data-confirm-pickup="${esc(id)}">✓ Konfirmasi Obat Telah Diambil</button></div></div>`;
    if(panel==='close')return `<div class="followup-inline-panel"><div class="inline-panel-head"><div><span>TUTUP LAYANAN</span><h5>Tidak dilakukan pengantaran ulang</h5></div><button class="mini-btn" data-close-follow-panel="${esc(id)}">Tutup</button></div><div class="field"><label>Alasan / keputusan Farmasi *</label><textarea data-close-note="${dom}" rows="3" placeholder="Tuliskan alasan penutupan layanan"></textarea></div><div class="inline-actions"><button class="secondary-btn" data-close-follow-panel="${esc(id)}">Batal</button><button class="danger-btn" data-save-close="${esc(id)}">Tutup Layanan</button></div></div>`;
    return '';
  }

  function patchFollowUpAttempt(id, attempt, {remove=false}={}){
    const key=String(id||'');
    if(remove){state.failedFollowUps=state.failedFollowUps.filter(item=>followUpId(item)!==key);syncFarmasiBadges();return;}
    if(!attempt)return;
    state.failedFollowUps=state.failedFollowUps.map(item=>followUpId(item)===key?Object.assign({},item,{attempt:Object.assign({},item.attempt||{},attempt)}):item);
    syncFarmasiBadges();
  }

  async function refreshFollowUp(anchorId=''){
    await loadFailedFollowUps();
    if(document.getElementById('followUpContent'))renderFollowUpData(anchorId);
  }

  function bindFollowUpEvents(){
    document.querySelectorAll('[data-open-follow-panel]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.id||'';state.followUpExpanded[id]=b.dataset.openFollowPanel||'';renderFollowUpData(id);}));
    document.querySelectorAll('[data-close-follow-panel]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.closeFollowPanel||'';delete state.followUpExpanded[id];renderFollowUpData(id);}));
    document.querySelectorAll('[data-confirm-return]').forEach(b=>b.addEventListener('click',async()=>{
      const id=b.dataset.confirmReturn;
      const w=reserveWhatsAppWindow();
      buttonBusy(b,true,'Menyimpan…');
      try{
        const returned=await api().confirmReturnedToFarmasi(token(),id);
        patchFollowUpAttempt(id,returned.data?.attempt);
        renderFollowUpData(id);
        ctx.showToast('Obat dikonfirmasi kembali ke Farmasi. Menyiapkan WhatsApp tindak lanjut…','success');
        try{
          const follow=await api().failedFollowupWa(token(),id);
          const wa=follow.data?.waAction||null;
          if(wa)state.followUpWaActions[id]=wa;
          patchFollowUpAttempt(id,follow.data?.attempt);
          renderFollowUpData(id);
          if(wa?.url){
            if(w)w.location.href=wa.url;
            else ctx.showToast('WhatsApp siap, tetapi browser memblokir tab baru. Gunakan tombol WhatsApp pada kartu.','warning',7000);
          }else{
            if(w)w.close();
            ctx.showToast('Pesan WhatsApp tindak lanjut belum tersedia.','warning');
          }
        }catch(waErr){
          if(w)w.close();
          ctx.showToast(`Obat sudah kembali, tetapi WhatsApp tindak lanjut belum dapat disiapkan: ${waErr.message}`,'warning',8000);
        }
        setTimeout(()=>loadFailedFollowUps().then(()=>renderFollowUpData(id)).catch(()=>{}),160);
      }catch(e){
        if(w)w.close();
        ctx.showToast(e.message,'error');
      }finally{buttonBusy(b,false)}
    }));
    document.querySelectorAll('[data-followup-wa]').forEach(b=>b.addEventListener('click',()=>openFollowupWaDirect(b.dataset.followupWa,b)));
    document.querySelectorAll('[data-schedule-form]').forEach(form=>{const id=form.dataset.scheduleForm,dom=safeDomId(id),radios=form.querySelectorAll(`input[name="retry-mode-${dom}"]`),wrap=form.querySelector(`[data-custom-date-wrap="${dom}"]`),todayWrap=form.querySelector(`[data-today-confirm-wrap="${dom}"]`);radios.forEach(el=>el.addEventListener('change',()=>{if(!el.checked)return;wrap?.classList.toggle('hidden',el.value!=='other');todayWrap?.classList.toggle('hidden',el.value!=='today');}));form.addEventListener('submit',e=>saveScheduleInline(e,id,dom));});
    document.querySelectorAll('[data-inline-retry]').forEach(form=>{const prefix=form.dataset.prefix;const id=form.dataset.inlineRetry;const rm=document.getElementById(`${prefix}-rm`),nm=document.getElementById(`${prefix}-name`);[rm,nm].forEach(el=>{if(el){el.readOnly=true;el.classList.add('locked-input');el.tabIndex=-1;}});bindAreaSearch(prefix);form.addEventListener('submit',e=>createRetryInline(e,id,prefix));});
    document.querySelectorAll('[data-save-pickup]').forEach(b=>b.addEventListener('click',()=>saveSelfPickupInline(b.dataset.savePickup,b)));
    document.querySelectorAll('[data-confirm-pickup]').forEach(b=>b.addEventListener('click',()=>confirmSelfPickupInline(b.dataset.confirmPickup,b)));
    document.querySelectorAll('[data-save-close]').forEach(b=>b.addEventListener('click',()=>closeFailedInline(b.dataset.saveClose,b)));
  }

  function reserveWhatsAppWindow(){
    const w=window.open('about:blank','_blank');
    if(w){try{w.document.write('<!doctype html><title>Menyiapkan WhatsApp…</title><body style="font-family:Arial;padding:24px">Menyiapkan WhatsApp…</body>');w.document.close();}catch(_){}}
    return w;
  }

  async function openFollowupWaDirect(id,button){
    const w=reserveWhatsAppWindow();buttonBusy(button,true,'Menyiapkan WA…');
    try{const res=await api().failedFollowupWa(token(),id);const wa=res.data?.waAction||null;if(wa)state.followUpWaActions[id]=wa;patchFollowUpAttempt(id,res.data?.attempt);renderFollowUpData(id);if(wa?.url){if(w)w.location.href=wa.url;else{ctx.showToast('Browser memblokir tab WhatsApp. Gunakan tombol Buka ulang WhatsApp pada kartu.','warning',7000);}}else{if(w)w.close();ctx.showToast('Pesan WhatsApp tidak tersedia.','error');}setTimeout(()=>loadFailedFollowUps().then(()=>renderFollowUpData(id)).catch(()=>{}),160);}
    catch(e){if(w)w.close();ctx.showToast(e.message,'error')}finally{buttonBusy(button,false)}
  }

  async function saveScheduleInline(ev,id,dom){
    ev.preventDefault();const form=ev.currentTarget,btn=form.querySelector('button[type="submit"]');const choice=form.querySelector(`input[name="retry-mode-${dom}"]:checked`)?.value||'tomorrow';const today=todayKey(),tomorrow=tomorrowKey();const custom=form.querySelector(`[data-custom-date="${dom}"]`)?.value||'';const selected=choice==='today'?today:choice==='tomorrow'?tomorrow:custom;if(!selected)return ctx.showToast('Pilih tanggal pengantaran ulang.','error');if(choice==='today'&&!form.querySelector(`[data-today-confirm="${dom}"]`)?.checked)return ctx.showToast('Konfirmasi dulu bahwa pengantaran ulang hari ini masih memungkinkan secara operasional.','warning',6500);buttonBusy(btn,true,'Menyimpan…');try{const res=await api().planRedelivery(token(),id,{scheduleDate:selected});patchFollowUpAttempt(id,res.data?.attempt);delete state.followUpExpanded[id];renderFollowUpData(id);ctx.showToast(`Rencana pengantaran ulang disimpan: ${formatDateId(selected)}.`,'success');setTimeout(()=>loadFailedFollowUps().then(()=>renderFollowUpData(id)).catch(()=>{}),160);}catch(e){ctx.showToast(e.message,'error')}finally{buttonBusy(btn,false)}
  }

  async function createRetryInline(ev,id,prefix){
    ev.preventDefault();if(!validateForm(prefix))return;const item=state.failedFollowUps.find(x=>followUpId(x)===String(id));if(!item)return ctx.showToast('Data tidak ditemukan. Segarkan halaman.','error');const a=item.attempt||{},r=item.record||{};const schedule=normalizeDateKey(a.plannedDate);if(!schedule||!isDateDue(schedule))return ctx.showToast('Tanggal pengantaran ulang belum tiba.','warning');const btn=ev.currentTarget.querySelector('button[type="submit"]');const w=reserveWhatsAppWindow();buttonBusy(btn,true,'Membuat…');try{const payload=formPayload(prefix);payload.scheduleDate=schedule;const res=await api().rescheduleDelivery(token(),id,payload);delete state.followUpExpanded[id];ctx.showToast(res.message||'Pengantaran ulang dibuat.','success');const wa=res.data?.waAction||null;if(wa?.url){if(w)w.location.href=wa.url;else ctx.showToast('Pengantaran ulang dibuat, tetapi browser memblokir WhatsApp. Kode dapat dikirim ulang dari menu Hari Ini.','warning',8000);}else if(w)w.close();setTimeout(()=>Promise.all([loadFailedFollowUps(),loadRows('')]).then(()=>renderFollowUpData()).catch(()=>{}),120);}catch(e){if(w)w.close();ctx.showToast(e.message,'error')}finally{buttonBusy(btn,false)}
  }

  async function saveSelfPickupInline(id,button){
    const note=document.querySelector(`#follow-card-${safeDomId(id)} [data-pickup-note="${safeDomId(id)}"]`)?.value.trim()||'';buttonBusy(button,true,'Menyimpan…');try{const res=await api().markSelfPickup(token(),id,note);patchFollowUpAttempt(id,res.data?.attempt);delete state.followUpExpanded[id];renderFollowUpData(id);ctx.showToast('Kasus menunggu pasien mengambil obat di Loket Farmasi.','success');setTimeout(()=>loadFailedFollowUps().then(()=>renderFollowUpData(id)).catch(()=>{}),160);}catch(e){ctx.showToast(e.message,'error')}finally{buttonBusy(button,false)}
  }

  async function confirmSelfPickupInline(id,button){
    const note=document.querySelector(`#follow-card-${safeDomId(id)} [data-pickup-confirm-note="${safeDomId(id)}"]`)?.value.trim()||'';buttonBusy(button,true,'Menyimpan…');try{await api().confirmSelfPickup(token(),id,note);patchFollowUpAttempt(id,null,{remove:true});delete state.followUpExpanded[id];renderFollowUpData();ctx.showToast('Obat dikonfirmasi telah diambil. Tindak lanjut selesai.','success');setTimeout(()=>loadFailedFollowUps().then(()=>renderFollowUpData()).catch(()=>{}),160);}catch(e){ctx.showToast(e.message,'error')}finally{buttonBusy(button,false)}
  }

  async function closeFailedInline(id,button){
    const note=document.querySelector(`#follow-card-${safeDomId(id)} [data-close-note="${safeDomId(id)}"]`)?.value.trim()||'';if(!note)return ctx.showToast('Alasan penutupan layanan wajib diisi.','error');buttonBusy(button,true,'Menyimpan…');try{await api().closeFailedDelivery(token(),id,note);patchFollowUpAttempt(id,null,{remove:true});delete state.followUpExpanded[id];renderFollowUpData();ctx.showToast('Layanan ditutup. Riwayat gagal antar tetap tersimpan.','success');setTimeout(()=>loadFailedFollowUps().then(()=>renderFollowUpData()).catch(()=>{}),160);}catch(e){ctx.showToast(e.message,'error')}finally{buttonBusy(button,false)}
  }

  function resetForLogout() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.autoRefreshBusy = false;
    state.master = {areas:[],manualVerificationMethods:[]}; state.rows = []; state.pending = []; state.failedFollowUps = []; state.activeIncidents = []; state.lastCreated = null; state.loaded = false; state.loading = null; state.search = ''; state.followUpFilter='all'; state.followUpExpanded={}; state.followUpWaActions={};
    try { sessionStorage.removeItem(APP_CONFIG.farmasiDraftKey); } catch (_) {}
  }

  return { renderHome, renderRegistration, renderToday, renderVerification, renderFollowUp, renderLabels, refreshVisibleData, resetForLogout };
}
