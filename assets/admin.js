export function createAdminModule(ctx) {
  const state = {loaded:false,summary:{},archive:null,resilience:null,fidelity:null,master:{},accounts:{accounts:[]},audit:[],metadata:null,rows:[],search:''};
  let archiveFocusHandler = null;
  let archiveVisibilityHandler = null;
  let archiveRefreshBusy = false;
  let archiveLastAutoCheckAt = 0;
  const esc = ctx.escapeHtml;
  const api = () => ctx.getApi();
  const token = () => ctx.getToken();
  const page = () => document.getElementById('pageContent');
  const setBusy = (button,busy,label='Memproses…') => {
    if (typeof ctx.setButtonBusy === 'function') return ctx.setButtonBusy(button,busy,label);
    if (!button) return;
    if (busy) { button.dataset.oldLabel=button.textContent; button.disabled=true; button.textContent=label; }
    else { button.disabled=false; if(button.dataset.oldLabel) button.textContent=button.dataset.oldLabel; }
  };
  const statusOptions = ['MENUNGGU DIPROSES','SIAP DIANTAR','DALAM PERJALANAN','TERKIRIM','GAGAL ANTAR'];

  function resetForLogout() {
    Object.assign(state,{loaded:false,summary:{},archive:null,resilience:null,fidelity:null,master:{},accounts:{accounts:[]},audit:[],metadata:null,rows:[],search:''});
    detachArchiveAutoHealth_();
  }

  function fmt(value) { return esc(value || '-'); }
  function packageCode(record) { return record?.['Kode Paket'] || record?.__packageCode || record?.['ID Sistem'] || '-'; }
  function statusClass(status) {
    if (status === 'TERKIRIM') return 'delivered';
    if (status === 'GAGAL ANTAR') return 'failed';
    if (status === 'DALAM PERJALANAN') return 'transit';
    if (status === 'SIAP DIANTAR') return 'ready';
    if (status === 'MENUNGGU DIPROSES') return 'waiting';
    return 'neutral';
  }
  function badge(text,kind='neutral') { return `<span class="status-badge ${kind}">${esc(text || '-')}</span>`; }
  function metric(label,value,note='') { return `<div class="card metric-card"><div class="metric-top"><span>${esc(label)}</span></div><div class="metric-value">${esc(value)}</div>${note?`<div class="metric-note">${esc(note)}</div>`:''}</div>`; }
  function countArray(value) { return Array.isArray(value) ? value.length : 0; }
  function fmtDateTime(value) { if (!value) return '-'; const d = new Date(value); return Number.isNaN(d.getTime()) ? esc(value) : esc(new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(d)); }
  function backupKindLabel(kind) { return ({DAILY:'Harian',MONTHLY:'Bulanan',PRECHANGE:'Sebelum Perubahan',RECOVERY:'Pemulihan'})[kind] || kind || '-'; }

  function archiveMounted_() { return Boolean(document.getElementById('archiveBody')); }
  function restoreScroll_(x,y) { requestAnimationFrame(() => window.scrollTo(x,y)); }
  function detachArchiveAutoHealth_() {
    if (archiveFocusHandler) window.removeEventListener('focus',archiveFocusHandler);
    if (archiveVisibilityHandler) document.removeEventListener('visibilitychange',archiveVisibilityHandler);
    archiveFocusHandler = null;
    archiveVisibilityHandler = null;
  }
  function attachArchiveAutoHealth_() {
    detachArchiveAutoHealth_();
    const run = () => {
      if (!archiveMounted_() || document.hidden) return;
      const now = Date.now();
      if (now - archiveLastAutoCheckAt < 1500) return;
      archiveLastAutoCheckAt = now;
      refreshResilienceState_({silent:true,preserveScroll:true}).catch(() => {});
    };
    archiveFocusHandler = run;
    archiveVisibilityHandler = run;
    window.addEventListener('focus',archiveFocusHandler);
    document.addEventListener('visibilitychange',archiveVisibilityHandler);
  }


  function masterSheetLabel(name) {
    const map = {'MASTER_DATA':'Master Data','AKSES':'Akun & PIN','MASTER_WILAYAH':'Wilayah Layanan'};
    return map[name] || name || '-';
  }
  function systemSheetLabel(name) {
    const map = {'MASTER_DATA':'Master Data','AKSES':'Akun & PIN','MASTER_WILAYAH':'Wilayah Layanan','KENDALA':'Kendala Kurir','KENDALA_KURIR':'Kendala Kurir','LOG_AKTIVITAS':'Audit Aktivitas','DELIVERY_META':'Metadata Pengantaran','DATABASE':'Database Transaksi','DELIVERY_ATTEMPTS':'Riwayat Pengantaran'};
    return map[name] || name || '-';
  }

  function requestAdminPin_({title='Konfirmasi tindakan sensitif',message='Masukkan PIN Admin untuk memastikan tindakan ini memang Anda kehendaki.',confirmLabel='Ya, Lanjutkan'}={}) {
    return new Promise(resolve => {
      ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">KONFIRMASI ADMIN</div><h3>${esc(title)}</h3><p>${esc(message)}</p></div><button class="modal-x" id="sensitivePinClose">×</button></div>
        <div class="system-alert warning compact-alert"><strong>Data sensitif</strong><span>Gunakan PIN Admin yang sama dengan saat login. PIN hanya diminta ulang sebagai pengingat sebelum tindakan penting.</span></div>
        <div class="field"><label for="sensitiveAdminPin">PIN Admin <b>*</b></label><input id="sensitiveAdminPin" type="password" inputmode="numeric" autocomplete="off" placeholder="Masukkan PIN Admin"></div>
        <div id="sensitivePinMsg"></div><div class="modal-actions"><button id="sensitivePinCancel" class="secondary-btn">Batal</button><button id="sensitivePinOk" class="warning-btn">${esc(confirmLabel)}</button></div>`);
      let done = false;
      const finish = value => { if (done) return; done = true; ctx.closeModal(); resolve(value); };
      document.getElementById('sensitivePinClose')?.addEventListener('click',() => finish(null));
      document.getElementById('sensitivePinCancel')?.addEventListener('click',() => finish(null));
      const submit = () => {
        const pin = String(document.getElementById('sensitiveAdminPin')?.value || '').trim();
        if (!pin) { document.getElementById('sensitivePinMsg').innerHTML = '<div class="alert error">PIN Admin wajib diisi.</div>'; return; }
        finish(pin);
      };
      document.getElementById('sensitivePinOk')?.addEventListener('click',submit);
      document.getElementById('sensitiveAdminPin')?.addEventListener('keydown',event => { if (event.key === 'Enter') submit(); });
      setTimeout(() => document.getElementById('sensitiveAdminPin')?.focus(),30);
    });
  }

  async function bootstrap(force=false) {
    if (state.loaded && !force) return state;
    const response = await api().adminBootstrap(token());
    const data = response.data || {};
    state.summary = data.summary || {};
    state.archive = data.archive || null;
    state.resilience = data.resilience || null;
    state.master = data.master || {};
    state.audit = data.audit || [];
    state.metadata = data.metadata || null;
    state.loaded = true;
    return state;
  }

  async function renderHome() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">ADMIN DATA</div><h1>Pusat Pemeliharaan Data</h1><p>Koreksi data, arsip, master, dan audit dalam satu tempat.</p></div><div class="hero-actions"><button id="adminHomeRefresh" class="secondary-btn">↻ Segarkan</button></div></section><section class="section" id="adminHomeBody"><div class="inline-loading">Memuat…</div></section>`;
    document.getElementById('adminHomeRefresh')?.addEventListener('click',async event => {
      setBusy(event.currentTarget,true,'Memuat…');
      try { await bootstrap(true); drawHome(); ctx.showToast('Data Admin diperbarui.','success'); }
      catch (error) { ctx.showToast(error.message,'error'); }
      finally { setBusy(event.currentTarget,false); }
    });
    try { await bootstrap(true); drawHome(); }
    catch (error) { document.getElementById('adminHomeBody').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; }
  }

  function drawHome() {
    const root = document.getElementById('adminHomeBody');
    if (!root) return;
    const currentUser = typeof ctx.getUser === 'function' ? ctx.getUser() : null;
    if (currentUser?.recoveryOnly) {
      root.innerHTML = `<div class="system-alert warning"><strong>Mode Pemulihan Akses aktif</strong><span>Akun & PIN tidak dapat digunakan untuk autentikasi normal. Sesi ini hanya untuk pemulihan. Pulihkan <b>Akun & PIN</b> dari Backup Sehat Terakhir.</span></div><div class="admin-action-grid clean-admin-actions"><button id="goRecoveryArchive" class="admin-action-card"><b>▣ Buka Backup & Pemulihan</b><span>Masuk ke Arsip, pilih backup sehat, lalu Pulihkan Master → Akun & PIN.</span></button></div>`;
      document.getElementById('goRecoveryArchive')?.addEventListener('click',()=>ctx.navigate('archive'));
      return;
    }
    const s = state.summary || {};
    const missing = Number(s.missingMetadata || 0);
    root.innerHTML = `<div class="grid grid-4">${metric('Data Aktif',Number(s.activeRecords||0),'Masih dalam proses')}${metric('Metadata',Number(s.metadataRecords||0),missing?`${missing} perlu perhatian`:'Sinkron')}${metric('Riwayat Pengantaran',Number(s.deliveryHistoryRecords||0),'Catatan perjalanan pengiriman')}${metric('Audit',Number(s.auditRecords||0),'Aktivitas tercatat')}</div>
      ${missing?`<div class="system-alert warning"><strong>Metadata perlu perhatian</strong><span>${missing} data belum lengkap. Jalankan pemeriksaan metadata sebelum melakukan perubahan besar.</span></div>`:''}
      ${drawBackupHomeAlert_()}
      <div class="admin-action-grid clean-admin-actions">
        <button data-go="corrections" class="admin-action-card"><b>✎ Koreksi Data</b><span>Cari data dan perbaiki status bila terjadi salah input.</span></button>
        <button data-go="archive" class="admin-action-card"><b>▣ Arsip</b><span>Periksa kesehatan arsip dan antrean pemeliharaan.</span></button>
        <button data-go="master" class="admin-action-card"><b>◆ Master</b><span>Lihat ringkasan konfigurasi aktif.</span></button>
        <button data-go="audit" class="admin-action-card"><b>≡ Audit</b><span>Telusuri jejak perubahan dan aktivitas.</span></button>
      </div>`;
    root.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click',() => ctx.navigate(button.dataset.go)));
  }

  function drawBackupHomeAlert_() {
    const r = state.resilience || {};
    if (!r || !Object.keys(r).length) return `<div class="system-alert warning"><strong>Backup Master belum dikonfigurasi</strong><span>Buka menu Arsip untuk mengaktifkan backup otomatis.</span></div>`;
    const missing = Array.isArray(r.structure?.missing) ? r.structure.missing.length : 0;
    const dataIssues = Array.isArray(r.dataHealth?.issues) ? r.dataHealth.issues.length : 0;
    const safe = String(r.status || '') === 'AMAN' && missing === 0 && dataIssues === 0;
    const last = r.lastDaily ? fmtDateTime(r.lastDaily.createdAt) : 'Belum tersedia';
    if (!safe) {
      const parts = [];
      if (missing) parts.push(`${missing} sheet sistem perlu dipulihkan`);
      if (dataIssues) parts.push(`${dataIssues} data perlu diperiksa`);
      if (!parts.length) parts.push('backup atau proteksi perlu perhatian');
      return `<div class="system-alert warning"><strong>Ketahanan Data perlu perhatian</strong><span>${esc(parts.join(' • '))}. Buka menu Arsip untuk langkah pemulihan. Backup harian terakhir: ${last}.</span></div>`;
    }
    return `<div class="system-alert success"><strong>Ketahanan Data: AMAN</strong><span>Struktur, data, dan backup otomatis dalam kondisi baik. Backup harian terakhir: ${last}.</span></div>`;
  }

  async function renderCorrections() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">KOREKSI DATA</div><h1>Temukan Data yang Perlu Diperbaiki</h1><p>Gunakan Kode Paket, No. RM, nama pasien, ID Sistem, status, atau nama Kurir.</p></div></section>
      <section class="section"><div class="toolbar-card"><div class="search-box"><span>⌕</span><input id="adminSearch" placeholder="Contoh: A00025, No. RM, nama pasien…" value="${esc(state.search)}"></div><button id="adminSearchBtn" class="secondary-btn">Cari</button></div><div id="adminRowsBox" class="content-card"><div class="inline-loading">Memuat data…</div></div></section>`;
    document.getElementById('adminSearchBtn')?.addEventListener('click',loadRows);
    document.getElementById('adminSearch')?.addEventListener('keydown',event => { if (event.key === 'Enter') loadRows(); });
    await loadRows();
  }

  async function loadRows() {
    state.search = document.getElementById('adminSearch')?.value || state.search || '';
    const box = document.getElementById('adminRowsBox');
    if (box) box.innerHTML = '<div class="inline-loading">Memuat data…</div>';
    try {
      const response = await api().adminRows(token(),state.search);
      state.rows = response.data?.rows || [];
      drawRows();
    } catch (error) {
      if (box) box.innerHTML = `<div class="alert error">${esc(error.message)}</div>`;
    }
  }

  function drawRows() {
    const box = document.getElementById('adminRowsBox');
    if (!box) return;
    if (!state.rows.length) {
      box.innerHTML = '<div class="empty-state"><h3>Data tidak ditemukan</h3><p>Periksa kata pencarian lalu coba kembali.</p></div>';
      return;
    }
    box.innerHTML = `<div class="table-scroll"><table class="data-table responsive-table admin-correction-table"><thead><tr><th>Kode Paket</th><th>Pasien</th><th>Status</th><th>Kurir</th><th>Aksi</th></tr></thead><tbody>${state.rows.map(record => `<tr><td data-label="Kode Paket"><strong class="package-code">${esc(packageCode(record))}</strong><span class="cell-sub">${fmt(record['ID Sistem'])}</span></td><td data-label="Pasien"><strong>${fmt(record['Nama Pasien'])}</strong><span class="cell-sub">RM ${fmt(record['No RM'])} • ${fmt(record['Kelurahan'])}</span></td><td data-label="Status">${badge(record['Status'],statusClass(record['Status']))}</td><td data-label="Kurir">${fmt(record['Kurir'])}</td><td data-label="Aksi"><div class="row-actions"><button class="mini-btn" data-history="${esc(record['ID Sistem'])}">Riwayat</button><button class="mini-btn primary-soft" data-correct="${esc(record['ID Sistem'])}">Koreksi</button></div></td></tr>`).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-history]').forEach(button => button.addEventListener('click',() => openHistory(button.dataset.history)));
    box.querySelectorAll('[data-correct]').forEach(button => button.addEventListener('click',() => openCorrection(button.dataset.correct)));
  }

  async function openHistory(id) {
    try {
      const response = await api().deliveryHistory(token(),id);
      const rows = response.data?.rows || [];
      ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">RIWAYAT PENGANTARAN</div><h3>${esc(state.rows.find(item => item['ID Sistem'] === id)?.['Nama Pasien'] || packageCode(state.rows.find(item => item['ID Sistem'] === id)))}</h3></div><button class="modal-x" data-modal-close>×</button></div><div class="attempt-timeline">${rows.length?rows.map(item => `<article><span class="attempt-no">${Number(item.attemptNo||1)}</span><div><div>${badge(item.result || item.status || '-',item.result==='TERKIRIM'?'delivered':item.result==='GAGAL ANTAR'?'failed':'neutral')}</div><h4>Pengantaran ke-${Number(item.attemptNo||1)}${item.courier?` • ${esc(item.courier)}`:''}</h4><p>${esc(item.claimedAt || item.readyAt || '-')} → ${esc(item.completedAt || 'Belum selesai')}</p>${item.failureReason?`<small>Alasan gagal: ${esc(item.failureReason)}</small>`:''}${item.returnStatus?`<small>Pengembalian obat: ${esc(item.returnStatus)}</small>`:''}</div></article>`).join(''):'<div class="empty-state"><p>Belum ada riwayat pengantaran.</p></div>'}</div><div class="modal-actions"><button class="primary-btn" data-modal-close>Tutup</button></div>`,{wide:true});
    } catch (error) { ctx.showToast(error.message,'error'); }
  }

  function openCorrection(id) {
    const record = state.rows.find(item => item['ID Sistem'] === id);
    if (!record) return;
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">KOREKSI DATA</div><h3>${fmt(record['Nama Pasien'])}</h3><p>${esc(packageCode(record))}</p></div><button class="modal-x" data-modal-close>×</button></div>
      <div class="correction-compare"><div><span>Status Saat Ini</span><strong>${esc(record['Status'] || '-')}</strong></div><div class="correction-arrow">→</div><div><span>Status Baru</span><select id="adminNewStatus">${statusOptions.map(status => `<option value="${status}" ${status===record['Status']?'selected':''}>${status}</option>`).join('')}</select></div></div>
      <div class="field"><label for="adminCorrectionNote">Alasan koreksi <b>*</b></label><textarea id="adminCorrectionNote" rows="3" placeholder="Jelaskan mengapa data perlu dikoreksi"></textarea></div>
      <div class="system-alert warning compact-alert"><strong>Konfirmasi tindakan sensitif</strong><span>Koreksi akan mengubah data pelayanan dan tercatat permanen pada Audit. Masukkan PIN Admin yang sama dengan saat login.</span></div>
      <div class="field"><label for="adminCorrectionPin">PIN Admin <b>*</b></label><input id="adminCorrectionPin" type="password" inputmode="numeric" autocomplete="off" placeholder="Masukkan PIN Admin"></div>
      <div id="adminCorrectionMsg"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="adminCorrectionSave" class="warning-btn">Simpan Koreksi</button></div>`);
    document.getElementById('adminCorrectionSave')?.addEventListener('click',async() => {
      const button = document.getElementById('adminCorrectionSave');
      const status = document.getElementById('adminNewStatus').value;
      const note = document.getElementById('adminCorrectionNote').value.trim();
      const pin = document.getElementById('adminCorrectionPin').value.trim();
      if (!note) { document.getElementById('adminCorrectionMsg').innerHTML = '<div class="alert error">Alasan koreksi wajib diisi.</div>'; return; }
      if (!pin) { document.getElementById('adminCorrectionMsg').innerHTML = '<div class="alert error">Masukkan PIN Admin untuk melanjutkan.</div>'; return; }
      setBusy(button,true,'Menyimpan…');
      try {
        await api().adminUpdateStatus(token(),id,status,note,pin);
        ctx.closeModal();
        ctx.showToast('Koreksi data berhasil disimpan dan dicatat pada Audit.','success');
        await loadRows();
      } catch (error) {
        document.getElementById('adminCorrectionMsg').innerHTML = `<div class="alert error">${esc(error.message)}</div>`;
        setBusy(button,false);
      }
    });
  }

  async function renderArchive() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">ARSIP & BACKUP</div><h1>Ketahanan Data</h1><p>Pantau arsip, backup otomatis, dan siapkan salinan pemulihan tanpa mengubah Master aktif.</p></div><div class="hero-actions"><button id="archiveRefresh" class="secondary-btn">↻ Segarkan</button></div></section><section class="section" id="archiveBody"><div class="inline-loading">Memuat…</div></section>`;
    const load = async() => {
      try {
        const resilienceResponse = await api().adminResilienceHealth(token());
        state.resilience = resilienceResponse.data?.health || null;
        state.archive = {unavailable:true,error:'Informasi arsip sedang dimuat. Bagian Backup & Pemulihan sudah dapat digunakan.'};
        drawArchive();
        try {
          const archiveResponse = await api().adminArchiveHealth(token());
          state.archive = archiveResponse.data?.health || null;
        } catch (archiveError) {
          state.archive = {unavailable:true,error:String(archiveError?.message || 'Informasi arsip sementara tidak tersedia.')};
        }
        drawArchive();
      } catch (error) { document.getElementById('archiveBody').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; }
    };
    document.getElementById('archiveRefresh')?.addEventListener('click',async event=>{const button=event.currentTarget;setBusy(button,true,'Memuat…');try{await load();}finally{setBusy(button,false);}});
    await load();
    attachArchiveAutoHealth_();
  }

  function drawArchive() {
    const root = document.getElementById('archiveBody');
    if (!root) return;
    const a = state.archive || {};
    const queue = a.queue || {};
    const config = a.config || {};
    const archiveUnavailable = a.unavailable === true;
    const r = state.resilience || {};
    const emergencyAccess = r.emergencyAccess || {};
    const counts = r.counts || {};
    const trigger = r.trigger || {};
    const checkpoint = r.checkpoint || {};
    const lastDaily = r.lastDaily || null;
    const lastMonthly = r.lastMonthly || null;
    const backupStatus = String(r.status || 'BELUM SIAP');
    const recent = Array.isArray(r.recent) ? r.recent : [];
    const recoveryRecent = Array.isArray(r.recoveryRecent) ? r.recoveryRecent : [];
    const warnings = Array.isArray(r.warnings) ? r.warnings : [];
    const secondary = r.secondary || {};
    const protection = r.protection || {};
    const structure = r.structure || {};
    const missingSheets = Array.isArray(structure.missing) ? structure.missing : [];
    const damagedSheets = Array.isArray(structure.damaged) ? structure.damaged : [];
    const duplicateSheets = Array.isArray(structure.duplicates) ? structure.duplicates : [];
    const structureIssues = [...missingSheets,...damagedSheets,...duplicateSheets];
    const structureIssueNames = new Set(structureIssues.map(item=>String(item.name||'')));
    const dataHealth = r.dataHealth || {};
    const dataIssues = Array.isArray(dataHealth.issues) ? dataHealth.issues : [];
    const lastRecovery = r.lastRecovery || null;
    const lastRestore = r.lastMasterRestore || null;
    const lastSystemRestore = r.lastSystemRestore || null;
    const lastStructureRestore = r.lastStructureRestore || null;
    const lastCellRestore = r.lastCellRestore || null;
    const lastContentRestore = r.lastContentRestore || null;
    const lastTransactionRestore = r.lastTransactionRestore || null;
    const maintenanceMode = r.maintenanceMode || {};
    const recoverableSheets = Array.isArray(r.recoverableMasterSheets) ? r.recoverableMasterSheets : [];
    const masterFile = structure.file || {};

    const recoverySummary = lastRecovery ? `<div class="content-card recovery-status-card"><div class="card-head-row"><div><span class="eyebrow">SALINAN PEMULIHAN TERAKHIR</span><h3>✓ Siap diperiksa</h3><p>Salinan ini tidak mengubah Master aktif.</p></div>${lastRecovery.recoveryUrl?`<button class="mini-btn" id="openLastRecovery">Buka Salinan</button>`:''}</div><div class="recovery-facts"><div><span>Sumber</span><strong>${esc(lastRecovery.sourceName || '-')}</strong></div><div><span>Dibuat</span><strong>${fmtDateTime(lastRecovery.at)}</strong></div><div><span>Oleh</span><strong>${esc(lastRecovery.actor || '-')}</strong></div><div><span>Nama salinan</span><strong class="backup-file-name">${esc(lastRecovery.recoveryName || '-')}</strong></div></div></div>` : '';
    const restoreSummary = [
      lastRestore ? `<div class="system-alert success"><strong>Pemulihan Master terakhir berhasil</strong><span>${fmtDateTime(lastRestore.at)} • ${esc((lastRestore.sheets || []).map(masterSheetLabel).join(', ') || '-')}</span></div>` : '',
      lastSystemRestore ? `<div class="system-alert success"><strong>Pemulihan sheet sistem terakhir berhasil</strong><span>${fmtDateTime(lastSystemRestore.at)} • ${esc((lastSystemRestore.sheet || (lastSystemRestore.sheets||[]).join(', ')) || '-')}</span></div>` : '',
      lastStructureRestore ? `<div class="system-alert success"><strong>Pemulihan struktur sheet terakhir berhasil</strong><span>${fmtDateTime(lastStructureRestore.at)} • ${esc(systemSheetLabel(lastStructureRestore.sheet || '-'))}${lastStructureRestore.mode==='FULL_SHEET_FROM_HEALTHY_BACKUP'?` • header dan isi dipulihkan`:''}</span></div>` : '',
      lastCellRestore ? `<div class="system-alert success"><strong>Pemulihan cell terakhir berhasil</strong><span>${fmtDateTime(lastCellRestore.at)} • ${esc(lastCellRestore.sheet || '-')} • ${esc((lastCellRestore.cells||[]).join(', '))}</span></div>` : '',
      lastContentRestore ? `<div class="system-alert success"><strong>Pemulihan isi sheet terakhir berhasil</strong><span>${fmtDateTime(lastContentRestore.at)} • ${esc(systemSheetLabel(lastContentRestore.sheet || '-'))} • ${Number(lastContentRestore.restoredRows||0)} data dikembalikan</span></div>` : '',
      lastTransactionRestore ? `<div class="system-alert success"><strong>Pemulihan transaksi terakhir berhasil</strong><span>${fmtDateTime(lastTransactionRestore.at)} • ${lastTransactionRestore.mode==='MISSING_RECORD_MERGE'?`${Number(lastTransactionRestore.restoredRows||0)} record hilang dikembalikan`:'bundle transaksi dipulihkan'}${lastTransactionRestore.consistency?` • konsistensi ${lastTransactionRestore.consistency.ok?'AMAN':'PERLU PERHATIAN'}`:''}</span></div>` : ''
    ].join('');

    const fileStateBlock = masterFile.trashed ? `<div class="content-card structure-health-card warning-card"><div class="card-head-row"><div><span class="eyebrow">FILE MASTER</span><h3>⚠ File Master berada di Sampah Drive</h3><p>Pulihkan file asli terlebih dahulu. Ini lebih aman daripada membuat Master baru dari backup.</p></div><button id="restoreProductionTrash" class="warning-btn">Pulihkan File Asli</button></div></div>` : '';
    const emergencyAccessBlock = emergencyAccess.recoveryRequired ? `<div class="content-card emergency-recovery-card danger-card"><div class="card-head-row"><div><span class="eyebrow">PEMULIHAN AKSES DARURAT</span><h3>${emergencyAccess.ready?'🚨 Mode Pemulihan Akses siap digunakan':'🚨 Akun & PIN rusak dan kredensial pemulihan belum siap'}</h3><p>${emergencyAccess.ready?'Akun Admin normal tidak dapat digunakan. Gunakan PIN Admin terakhir yang sah hanya untuk memulihkan <b>Akun & PIN</b> dari Backup Sehat Terakhir.':'Jangan lanjutkan perubahan pada Master. Hash PIN pemulihan belum tersedia di Script Properties sehingga pemulihan otomatis Akun & PIN tidak dapat diotorisasi.'}</p></div></div><div class="system-alert warning compact-alert"><strong>${emergencyAccess.ready?'Akses dibatasi hanya untuk pemulihan.':'Intervensi teknis diperlukan.'}</strong><span>${emergencyAccess.ready?`Alasan: ${esc(emergencyAccess.accessReason||'AKSES tidak sehat')} • Hash darurat tersedia: ${Number(emergencyAccess.storedCredentials||0)}.`:'Pulihkan AKSES dari backup secara administratif, lalu jalankan setupDataResilience() saat Admin aktif kembali untuk menyiapkan perlindungan darurat.'}</span></div></div>` : '';
    const structureCard = `<div class="content-card structure-health-card ${structureIssues.length?'warning-card':''}"><div class="card-head-row"><div><span class="eyebrow">KESEHATAN STRUKTUR</span><h3>${structureIssues.length?`⚠ ${structureIssues.length} masalah struktur perlu ditangani`:'✓ Struktur sistem lengkap'}</h3><p>${structureIssues.length?'Sheet hilang, header hilang/duplikat, atau kolom legacy harus ditangani sebelum struktur dinyatakan bersih.':'Semua sheet sistem kritis tersedia dan struktur/header yang diperiksa sesuai.'}</p></div><button id="refreshStructureHealth" class="mini-btn">Periksa Ulang</button></div><div class="protection-summary"><div><span>Status</span><strong>${structureIssues.length?'PERLU PENANGANAN':'AMAN'}</strong></div><div><span>Sheet wajib</span><strong>${Number(structure.found||0)} / ${Number(structure.total||0)}</strong></div><div><span>Masalah struktur</span><strong>${structureIssues.length}</strong></div></div>${structureIssues.length?`<div class="structure-issue-list">${structureIssues.map(item=>{
      const source=item.recommendedSource||item.recommendedStructureSource||null;
      const critical=String(item.severity||'')==='CRITICAL';
      const isMissing=!item.exists;
      const isMaster=String(item.severity||'')==='MASTER';
      const legacyCleanup=String(item.issueType||'')==='LEGACY_DATABASE_COLUMNS';
      let action=legacyCleanup?`<button class="mini-btn warning-soft" data-cleanup-legacy="1">Bersihkan Kolom Legacy</button>`:'<span class="status-badge failed">Backup sehat tidak ditemukan</span>';
      if(source&&!legacyCleanup){
        if(critical) action=`<button class="mini-btn danger-soft" data-emergency-restore="${esc(source.id)}" data-structure-issue="${esc(item.name)}">Buka Pemulihan Darurat</button>`;
        else if(isMaster) action=`<button class="mini-btn warning-soft" data-restore-master="${esc(source.id)}" data-restore-name="${esc(source.name||'Backup Sehat Terakhir')}">Pulihkan Master</button>`;
        else if(isMissing) action=`<button class="mini-btn warning-soft" data-restore-missing="${esc(item.name)}" data-source-id="${esc(source.id)}">Pulihkan Sheet Sistem</button>`;
        else action=`<button class="mini-btn warning-soft" data-restore-structure="${esc(item.name)}" data-source-id="${esc(source.id)}">Pulihkan Struktur Sheet</button>`;
      }
      const legacyCols=(item.legacyHeaders||[]).map(x=>`${x.header} (kolom ${Number(x.column||0)})`).join(', ');
      const duplicateNames=(item.duplicateNonLegacy||item.duplicateHeaders||[]).map(x=>x.header?`${x.header} ×${Number(x.count||2)}`:String(x)).join(', ');
      const detail=legacyCleanup
        ? `Kolom metadata legacy masih berada di DATABASE${legacyCols?` • ${esc(legacyCols)}`:''}. Data akan diverifikasi/migrasikan ke DELIVERY_META sebelum kolom dihapus.`
        : isMissing?'Sheet tidak ditemukan.':`Header/struktur tidak sesuai${(item.missingHeaders||[]).length?` • header hilang: ${esc(item.missingHeaders.join(', '))}`:''}${duplicateNames?` • header duplikat: ${esc(duplicateNames)}`:''}.`;
      return `<div class="structure-issue"><div><strong>${esc(systemSheetLabel(item.name))}</strong><span>${esc(item.name)} • ${detail}${source&&!legacyCleanup?` • sumber: ${esc(source.name)}`:''}</span></div>${action}</div>`;
    }).join('')}</div>`:''}</div>`;

    const dataHealthCard = `<div class="content-card data-health-card ${dataIssues.length?'warning-card':''}"><div class="card-head-row"><div><span class="eyebrow">KESEHATAN DATA</span><h3>${dataIssues.length?`⚠ ${dataIssues.length} data perlu diperiksa`:'✓ Data tidak menunjukkan kehilangan yang terdeteksi'}</h3><p>${dataIssues.length?'Sistem membandingkan kondisi aktif dengan cadangan sebelumnya untuk mendeteksi kehilangan data yang tidak wajar.':'Tidak ada penurunan data tidak wajar yang terdeteksi dari pemeriksaan otomatis.'}</p></div><button id="refreshDataHealth" class="mini-btn">Periksa Ulang</button></div>${dataIssues.length?`<div class="structure-issue-list">${dataIssues.map(item=>{
      const source=item.recommendedSource||null;
      const critical=String(item.severity||'')==='CRITICAL';
      const hasStructureIssue=structureIssueNames.has(String(item.name||''));
      let action='<span class="status-badge failed">Backup Sehat Terakhir tidak ditemukan</span>';
      if (hasStructureIssue) action='<span class="status-badge warning">Pulihkan struktur lebih dulu</span>';
      else if (source && critical) action=`<button class="mini-btn warning-soft" data-restore-transactions="${esc(source.id)}" data-data-issue="${esc(item.name)}">Pulihkan Transaksi Hilang</button>`;
      else if (source) action=`<button class="mini-btn warning-soft" data-restore-content="${esc(item.name)}" data-source-id="${esc(source.id)}">Pulihkan Isi</button>`;
      const missingNote=Number(item.missingCount||0)>0?` • Hilang: ${Number(item.missingCount||0)}${Array.isArray(item.missingKeys)&&item.missingKeys.length?` • contoh ID: ${esc(item.missingKeys.slice(0,5).join(', '))}`:''}`:'';
      return `<div class="structure-issue"><div><strong>${esc(systemSheetLabel(item.name))}</strong><span>Data sekarang: ${Number(item.currentRows||0)} • Backup Sehat Terakhir: ${Number(item.backupRows||0)}${missingNote}${source?` • ${esc(source.name)}`:''}</span><small>${esc(item.message||'Data perlu diperiksa.')}</small></div>${action}</div>`;
    }).join('')}</div>`:''}</div>`;

    const fidelity = state.fidelity || null;
    const fidelityRows = Array.isArray(fidelity?.rows) ? fidelity.rows : [];
    const fidelityIssues = Array.isArray(fidelity?.issues) ? fidelity.issues : [];
    const fidelityChecked = Boolean(fidelity);
    const lastFidelityRepair = fidelity?.lastRepair || r.lastFidelityRepair || null;
    const fidelityCard = `<div class="content-card fidelity-health-card ${fidelityChecked&&fidelityIssues.length?'warning-card':''}"><div class="card-head-row"><div><span class="eyebrow">INTEGRITAS FORMAT DATA</span><h3>${!fidelityChecked?'Periksa tipe data, validasi, dan zona waktu sistem':fidelityIssues.length?`⚠ ${fidelityIssues.length} masalah integritas perlu diperbaiki`:'✓ Tipe data dan zona waktu terdeteksi sehat'}</h3><p>${!fidelityChecked?'Pemeriksaan berfokus pada tipe nilai sebenarnya dan memastikan zona waktu Spreadsheet sama dengan zona operasional aplikasi.':fidelityIssues.length?'Ada tipe data atau konfigurasi waktu yang tidak lagi sesuai schema aplikasi.':'Tanggal/waktu, PIN, validasi kritis, dan zona waktu sesuai schema aplikasi.'}</p></div><button id="checkDataFidelity" class="secondary-btn">${fidelityChecked?'Periksa Lagi':'Periksa Format Data'}</button></div>${fidelityChecked?`<div class="protection-summary"><div><span>Status</span><strong>${esc(fidelity.status||'-')}</strong></div><div><span>Sheet diperiksa</span><strong>${fidelityRows.length}</strong></div><div><span>Perlu perbaikan</span><strong>${fidelityIssues.length}</strong></div></div>${fidelityIssues.length?`<div class="structure-issue-list">${fidelityIssues.map(item=>{const examples=(item.samples||[]).slice(0,3);const isTimezone=String(item.name||'')==='__TIMEZONE__';return `<div class="structure-issue"><div><strong>${isTimezone?'Zona Waktu Spreadsheet':esc(systemSheetLabel(item.name))}</strong><span>${isTimezone?`Saat ini: ${esc(fidelity.timezone?.current||'-')} • target operasional: ${esc(fidelity.timezone?.target||'-')} • akan diselaraskan tanpa mengubah wall-clock transaksi`:`${esc(item.name)} • tipe tanggal/waktu: ${Number(item.dateIssues||0)}${Number(item.driftIssues||0)?` • drift waktu: ${Number(item.driftIssues||0)}`:''} • PIN: ${Number(item.pinIssues||0)} • validasi: ${Number(item.validationIssues||0)} • acuan: schema aplikasi${item.source?.name?` • template validasi: ${esc(item.source.name)}`:''}`}</span>${examples.length?`<span>Contoh: ${examples.map(x=>`${esc(x.cell)} ${esc(x.field)} = ${esc(x.display||'(kosong)')}${x.expected?` → seharusnya ${esc(x.expected)}`:''} [${esc(x.valueType||'-')}]`).join(' • ')}</span>`:''}</div></div>`;}).join('')}</div><div class="fidelity-actions"><button id="repairDataFidelity" class="warning-btn">Perbaiki Format Data</button></div>`:`<div class="system-alert success compact-alert"><strong>Tidak ditemukan kerusakan tipe data kritis.</strong><span>Zona waktu Spreadsheet juga sesuai zona operasional. Perbedaan gaya tampilan tanggal tidak dianggap kerusakan bila tipe internalnya sehat.</span></div>`}${lastFidelityRepair?`<div class="fidelity-last">Perbaikan terakhir: <strong>${fmtDateTime(lastFidelityRepair.at)}</strong> • ${lastFidelityRepair.ok===false?'masih perlu pemeriksaan':'selesai'}</div>`:''}`:`<div class="system-alert info compact-alert"><strong>Pemeriksaan manual saat diperlukan</strong><span>Jalankan setelah pemulihan besar atau bila tanggal/waktu berubah menjadi angka, teks, atau bergeser jamnya.</span></div>`}</div>`;

    const criticalStructureIssues = structureIssues.filter(item=>String(item.severity||'')==='CRITICAL');
    const criticalDataIssues = dataIssues.filter(item=>String(item.severity||'')==='CRITICAL');
    const emergencyNeeded = criticalStructureIssues.length || criticalDataIssues.length;
    const fullEmergencyNeeded = criticalStructureIssues.length > 0;
    const partialCriticalNeeded = !fullEmergencyNeeded && criticalDataIssues.length > 0;
    const emergencyCard = `<div class="content-card emergency-recovery-card ${fullEmergencyNeeded?'danger-card':partialCriticalNeeded?'warning-card':''}"><div class="card-head-row"><div><span class="eyebrow">PEMULIHAN DARURAT</span><h3>${fullEmergencyNeeded?'🚨 Struktur transaksi kritis perlu pemulihan':partialCriticalNeeded?'⚠ Integritas transaksi perlu diperiksa':'✓ Tidak ada kondisi darurat'}</h3><p>${fullEmergencyNeeded?'DATABASE atau komponen transaksi kritis rusak/hilang. Gunakan Pemulihan Darurat Bundle dari satu checkpoint agar relasi data tetap konsisten.':partialCriticalNeeded?'Beberapa record transaksi tidak ditemukan. Gunakan Pulihkan Transaksi Hilang agar hanya record yang hilang dikembalikan tanpa rollback data baru.':'DATABASE dan komponen transaksi kritis terdeteksi dalam kondisi tersedia.'}</p></div></div>${emergencyNeeded?`<div class="system-alert warning compact-alert"><strong>Mode pemulihan ${maintenanceMode.active?'aktif':'disiapkan'}.</strong><span>${fullEmergencyNeeded?'Jangan lanjutkan transaksi. Pulihkan bundle dan pastikan verifikasi integritas AMAN sebelum operasional dibuka kembali.':'Pulihkan record yang hilang berdasarkan ID. Jika verifikasi gagal, lanjutkan melalui Pemulihan Darurat Bundle.'}</span></div>`:''}</div>`;

    const sourceOptions = recent.map(item=>`<option value="${esc(item.id)}">${esc(backupKindLabel(item.kind))} • ${esc(item.name)}</option>`).join('');

    root.innerHTML = `
      <div class="admin-section-title"><div><span class="eyebrow">ARSIP TRANSAKSI</span><h2>Retensi & Arsip Tahunan</h2></div></div>
      ${archiveUnavailable?`<div class="system-alert warning"><strong>Informasi arsip sementara tidak tersedia</strong><span>${esc(a.error || 'Pemulihan data mungkin sedang diperlukan. Bagian Backup & Pemulihan di bawah tetap dapat digunakan.')}</span></div>`:''}
      <div class="grid grid-4">${metric('Retensi',`${Number(config.retentionDays||120)} hari`,'Data aktif')}${metric('Menunggu Arsip',Number(queue.waiting||0),'Antrean')}${metric('Gagal Arsip',Number(queue.failed||0),'Perlu perhatian')}${metric('Tahun Arsip',Number(a.registry?.length||a.years?.length||0),'Terdeteksi')}</div>
      <div class="content-card technical-panel"><h3>Informasi Arsip</h3><pre>${esc(JSON.stringify({config:a.config||{},queue:a.queue||{},lastRun:a.lastRun||a.lastArchiveRun||null},null,2))}</pre></div>

      <div class="admin-section-title resilience-heading"><div><span class="eyebrow">BACKUP & PEMULIHAN</span><h2>Ketahanan Data</h2><p>30 backup harian, 12 backup bulanan, dan checkpoint transaksi setiap ${Number(r.config?.checkpointEveryHours||2)} jam dengan ${Number(r.config?.checkpointKeep||12)} salinan terbaru.</p></div><div class="admin-section-actions"><button id="backupNow" class="primary-btn">Backup Master Sekarang</button>${trigger.installed&&checkpoint.trigger?.installed?'':`<button id="backupSchedule" class="secondary-btn">Aktifkan Jadwal Otomatis</button>`}</div></div>
      <div class="grid grid-4">
        ${metric('Status Backup',backupStatus,trigger.installed?'Otomatis aktif':'Trigger belum aktif')}
        ${metric('Backup Harian',Number(counts.daily||0),lastDaily?`Terakhir ${fmtDateTime(lastDaily.createdAt)}`:'Belum tersedia')}
        ${metric('Backup Bulanan',Number(counts.monthly||0),lastMonthly?`Terakhir ${fmtDateTime(lastMonthly.createdAt)}`:'Belum tersedia')}
        ${metric('Checkpoint Transaksi',Number(counts.checkpoint||0),checkpoint.last?`Terakhir ${fmtDateTime(checkpoint.last.createdAt)}`:'Belum tersedia')}
      </div>
      ${warnings.length?`<div class="system-alert warning"><strong>Ketahanan data perlu perhatian</strong><span>${warnings.map(esc).join(' • ')}</span></div>`:`<div class="system-alert success"><strong>Backup dan checkpoint aman</strong><span>Cadangan otomatis tersedia dan struktur sistem lengkap.</span></div>`}
      <div class="content-card resilience-config-card"><div class="resilience-config-row"><div><span>Backup penuh</span><strong>${esc(trigger.schedule || '-')}</strong></div><div><span>Checkpoint transaksi</span><strong>${esc(checkpoint.trigger?.schedule || '-')}</strong></div><div><span>Retensi</span><strong>${Number(r.config?.dailyKeep||30)} harian • ${Number(r.config?.monthlyKeep||12)} bulanan • ${Number(r.config?.checkpointKeep||12)} checkpoint</strong></div><div><span>Cadangan lokasi kedua</span><strong>${secondary.configured?(secondary.error?'Perlu perhatian':'Aktif'):'Belum dikonfigurasi'}</strong></div>${r.folders?.root?.url?`<button id="openBackupFolder" class="mini-btn">Buka Folder Backup</button>`:''}</div></div>

      <div class="content-card protection-card"><div class="card-head-row"><div><span class="eyebrow">KEAMANAN MASTER</span><h3>Proteksi Edit Manual</h3><p>Proteksi membatasi perubahan langsung pada sheet sistem. Backup dan pemulihan tetap menjadi perlindungan utama bila terjadi salah hapus.</p></div><button id="applyMasterProtection" class="secondary-btn">${String(protection.status||'')==='AMAN'?'Periksa / Terapkan Ulang':'Perbaiki Proteksi'}</button></div><div class="protection-summary"><div><span>Status</span><strong>${esc(protection.status || 'BELUM DIPERIKSA')}</strong></div><div><span>Sheet terlindungi</span><strong>${Number(protection.protected||0)} / ${Number(protection.total||0)}</strong></div><div><span>Perlu perhatian</span><strong>${Number((protection.unprotected||[]).length + (protection.missing||[]).length)}</strong></div></div>${(protection.unprotected||[]).length?`<div class="alert warning">Belum terlindungi: ${esc(protection.unprotected.join(', '))}</div>`:''}</div>

      ${fileStateBlock}
      ${emergencyAccessBlock}
      ${structureCard}
      ${dataHealthCard}
      ${fidelityCard}
      ${emergencyCard}
      ${recoverySummary}
      ${restoreSummary}

      <div class="content-card cell-recovery-card"><div class="card-head-row"><div><span class="eyebrow">PEMULIHAN CELL / FIELD</span><h3>Bandingkan Master dengan Backup</h3><p>Gunakan bila satu nilai di Master tidak sengaja terhapus. Sistem hanya menawarkan cell yang sekarang kosong tetapi pada backup berisi data.</p></div></div>${recent.length?`<div class="cell-recovery-controls"><select id="cellRecoverySource">${sourceOptions}</select><select id="cellRecoverySheet">${recoverableSheets.map(name=>`<option value="${esc(name)}">${esc(masterSheetLabel(name))}</option>`).join('')}</select><button id="compareMasterCells" class="secondary-btn">Bandingkan</button></div>`:`<div class="empty-state"><p>Belum ada backup untuk dibandingkan.</p></div>`}</div>

      <div class="content-card"><div class="card-head-row"><div><h3>Backup Terbaru</h3><p>Maksimal 12 backup terbaru ditampilkan.</p></div></div>${recent.length?`<div class="table-scroll"><table class="data-table responsive-table"><thead><tr><th>Jenis</th><th>Nama File</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>${recent.map(item=>`<tr><td data-label="Jenis"><strong>${esc(backupKindLabel(item.kind))}</strong></td><td data-label="Nama File"><span class="backup-file-name">${esc(item.name)}</span></td><td data-label="Dibuat">${fmtDateTime(item.createdAt)}</td><td data-label="Aksi"><div class="row-actions">${item.url?`<button class="mini-btn" data-open-backup="${esc(item.url)}">Buka</button>`:''}<button class="mini-btn primary-soft" data-recovery="${esc(item.id)}" data-recovery-name="${esc(item.name)}">Siapkan Salinan</button><button class="mini-btn warning-soft" data-restore-master="${esc(item.id)}" data-restore-name="${esc(item.name)}">Pulihkan Master</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><h3>Belum ada backup</h3></div>'}</div>

      ${recoveryRecent.length?`<div class="content-card"><div class="card-head-row"><div><h3>Salinan Pemulihan Terbaru</h3><p>Salinan pemeriksaan terpisah dari Master aktif.</p></div></div><div class="recovery-list">${recoveryRecent.map(item=>`<div class="recovery-list-item"><div><strong class="backup-file-name">${esc(item.name)}</strong><span>${fmtDateTime(item.createdAt)}</span></div>${item.url?`<button class="mini-btn" data-open-recovery="${esc(item.url)}">Buka</button>`:''}</div>`).join('')}</div></div>`:''}


      <div class="content-card recovery-guide-card"><div class="card-head-row"><div><span class="eyebrow">PANDUAN PEMULIHAN CEPAT</span><h3>Apa masalah yang terjadi?</h3><p>Pilih situasi yang paling sesuai. Dashboard ini menjadi panduan utama Admin Data saat terjadi masalah.</p></div></div><div class="recovery-guide-grid">
        <details open><summary>Satu cell/field Master terhapus</summary><ol><li>Jangan melakukan perubahan lain pada cell tersebut.</li><li>Buka <b>Bandingkan Master dengan Backup</b>.</li><li>Pilih backup sebelum kesalahan.</li><li>Klik <b>Bandingkan</b> dan centang hanya cell yang ingin dikembalikan.</li><li>Masukkan PIN Admin. Sistem membuat backup pengaman sebelum pemulihan.</li><li>Ulangi <b>Bandingkan Master dengan Backup</b> untuk memastikan cell yang dipulihkan tidak lagi ditawarkan.</li></ol></details>
        <details><summary>Satu sheet sistem seperti KENDALA_KURIR terhapus</summary><ol><li>Jangan membuat sheet pengganti manual.</li><li>Lihat bagian <b>Kesehatan Struktur</b>.</li><li>Klik <b>Pulihkan Sheet Sistem</b> pada sheet yang hilang.</li><li>Masukkan PIN Admin.</li><li>Setelah selesai, periksa kembali <b>Kesehatan Struktur</b> dan <b>Proteksi Edit Manual</b>.</li></ol></details>
        <details><summary>Header/struktur sheet terhapus atau sheet kosong total</summary><ol><li>Lihat bagian <b>Kesehatan Struktur</b>.</li><li>Pastikan nama sheet masih ada tetapi header/struktur terdeteksi rusak.</li><li>Klik <b>Pulihkan Struktur Sheet</b>.</li><li>Masukkan PIN Admin.</li><li>Jika sheet kosong total, sistem mengembalikan header, format, dan isi dari <b>Backup Sehat Terakhir</b>. Jika data masih ada, sistem memulihkan struktur tanpa menimpa data yang masih tersisa.</li><li>Periksa kembali <b>Kesehatan Struktur</b> dan <b>Kesehatan Data</b>.</li></ol></details>
        <details><summary>Seluruh Akun & PIN terhapus sehingga PIN Admin tidak bisa dipakai</summary><ol><li>Jangan membuat akun baru secara manual dan jangan panik bila login biasa gagal.</li><li>Sistem otomatis masuk <b>Mode Pemulihan Akses</b> bila sheet Akun & PIN rusak, kosong, atau tidak memiliki Admin aktif.</li><li>Masuk menggunakan <b>PIN Admin terakhir yang sah</b>. Sistem memverifikasi hash darurat yang disimpan di luar Spreadsheet; PIN asli tidak disimpan sebagai teks.</li><li>Buka <b>Arsip → Pemulihan Master</b>, pilih <b>Akun & PIN</b>, lalu pulihkan dari <b>Backup Sehat Terakhir</b>.</li><li>Setelah Akun & PIN kembali sehat, autentikasi normal aktif kembali otomatis.</li></ol></details>
        <details><summary>Sheet ada, header masih utuh, tetapi isi datanya hilang/kosong</summary><ol><li>Lihat bagian <b>Kesehatan Data</b>.</li><li>Pastikan <b>Kesehatan Struktur</b> berstatus aman untuk sheet tersebut.</li><li>Periksa jumlah data sekarang dan <b>Backup Sehat Terakhir</b>.</li><li>Klik <b>Pulihkan Isi</b>.</li><li>Masukkan PIN Admin.</li><li>Sistem menggabungkan data lama berdasarkan ID tanpa menghapus data baru.</li><li>Periksa kembali <b>Kesehatan Data</b>.</li></ol></details>
        <details><summary>Beberapa baris DATABASE / transaksi terhapus</summary><ol><li>Lihat bagian <b>Kesehatan Data</b>.</li><li>Sistem membandingkan <b>ID Sistem</b>, <b>ATTEMPT_ID</b>, dan <b>PARENT_ID</b> dengan <b>Backup Sehat Terakhir</b>.</li><li>Jika record hilang terdeteksi, klik <b>Pulihkan Transaksi Hilang</b>.</li><li>Masukkan PIN Admin.</li><li>Sistem hanya menambahkan record yang hilang dan tidak me-rollback transaksi baru.</li><li>Pastikan hasil verifikasi integritas berstatus <b>AMAN</b>.</li></ol></details>
        <details><summary>DATABASE kosong total, header rusak, atau sheet DATABASE hilang</summary><ol><li>Hentikan operasional transaksi.</li><li>Buka bagian <b>Pemulihan Darurat</b>.</li><li>Gunakan sumber checkpoint/backup yang direkomendasikan sistem.</li><li>Jalankan <b>Pemulihan Darurat</b>.</li><li>Sistem mengembalikan DATABASE dan komponen transaksi terkait sebagai satu bundle.</li><li>Operasional hanya dianggap aman setelah verifikasi header, ID, duplikasi, dan relasi transaksi berstatus <b>AMAN</b>.</li></ol></details>
        <details><summary>Data masih ada tetapi tanggal/waktu berubah menjadi angka</summary><ol><li>Jangan mengubah angka serial tersebut secara manual.</li><li>Buka bagian <b>Integritas Format Data</b>.</li><li>Klik <b>Periksa Format Data</b>.</li><li>Jika ada temuan, klik <b>Perbaiki Format Data</b> dan masukkan PIN Admin.</li><li>Sistem membuat backup pengaman, memeriksa seluruh sheet dengan schema aplikasi, lalu mengembalikan tipe/format tanggal-waktu dan PIN; backup sehat hanya dipakai sebagai acuan validasi bila diperlukan.</li><li>Periksa kembali Dashboard Manajemen dan <b>Integritas Format Data</b>.</li></ol></details>
        <details><summary>DATABASE menampilkan Kode Paket/Catatan Kurir berulang</summary><ol><li>Jangan menghapus kolom secara manual.</li><li>Buka <b>Kesehatan Struktur</b>.</li><li>Pada Database Transaksi pilih <b>Bersihkan Kolom Legacy</b>.</li><li>Masukkan PIN Admin. Sistem membuat backup pengaman terlebih dahulu.</li><li>Sistem memeriksa seluruh nilai Kode Paket/Catatan Kurir lama dan memastikan nilainya sudah tersimpan konsisten di <b>DELIVERY_META</b>.</li><li>Kolom legacy hanya dihapus bila verifikasi tidak menemukan konflik. Bila ada konflik, tidak ada kolom yang dihapus dan Admin mendapat peringatan untuk pemeriksaan.</li><li>Setelah berhasil, jalankan <b>Periksa Ulang</b> pada Kesehatan Struktur.</li></ol></details>
        <details><summary>File Master masuk Sampah Drive</summary><ol><li>Buka bagian <b>Kesehatan Struktur</b> dan pastikan status file terdeteksi.</li><li>Jika tombol <b>Pulihkan File Asli</b> tersedia, gunakan tombol tersebut dan masukkan PIN Admin.</li><li>Jika file belum dapat diakses dari Dashboard, buka Google Drive → Sampah dan pulihkan file asli.</li><li>Kembali ke Dashboard lalu periksa <b>Kesehatan Struktur</b> dan <b>Kesehatan Data</b>.</li></ol></details>
        <details><summary>File Master hilang permanen</summary><ol><li>Gunakan backup sehat untuk membuat salinan pemulihan.</li><li>Periksa seluruh sheet dan konsistensi data.</li><li>Siapkan file pengganti dari backup sehat.</li><li>Relink backend hanya dilakukan pengelola sistem/IT. Jangan mengubah koneksi produksi tanpa pemeriksaan.</li></ol></details>
      </div><div class="system-alert info"><strong>Prinsip aman</strong><span>Pulihkan sekecil mungkin: cell untuk salah hapus cell, satu sheet untuk sheet sistem, dan bundle transaksi hanya untuk keadaan darurat.</span></div></div>`;

    document.getElementById('backupNow')?.addEventListener('click',openBackupModal_);
    document.getElementById('backupSchedule')?.addEventListener('click',event=>ensureBackupSchedule_(event.currentTarget));
    document.getElementById('openBackupFolder')?.addEventListener('click',() => window.open(r.folders.root.url,'_blank','noopener'));
    document.getElementById('openLastRecovery')?.addEventListener('click',() => { if (lastRecovery?.recoveryUrl) window.open(lastRecovery.recoveryUrl,'_blank','noopener'); });
    document.getElementById('applyMasterProtection')?.addEventListener('click',event=>applyMasterProtections_(event.currentTarget));
    document.getElementById('refreshStructureHealth')?.addEventListener('click',() => refreshResilienceState_({silent:false,preserveScroll:true}));
    document.getElementById('refreshDataHealth')?.addEventListener('click',() => refreshResilienceState_({silent:false,preserveScroll:true}));
    document.getElementById('checkDataFidelity')?.addEventListener('click',event=>checkDataFidelity_(event.currentTarget));
    document.getElementById('repairDataFidelity')?.addEventListener('click',event=>repairDataFidelity_(event.currentTarget));
    root.querySelectorAll('[data-cleanup-legacy]').forEach(button=>button.addEventListener('click',()=>cleanupLegacyDatabase_(button)));
    document.getElementById('restoreProductionTrash')?.addEventListener('click',restoreProductionFromTrash_);
    document.getElementById('compareMasterCells')?.addEventListener('click',async event => { const button=event.currentTarget; setBusy(button,true,'Membandingkan…'); try { await openCellComparison_(document.getElementById('cellRecoverySource')?.value,document.getElementById('cellRecoverySheet')?.value); } finally { setBusy(button,false); } });
    root.querySelectorAll('[data-open-backup]').forEach(button => button.addEventListener('click',() => window.open(button.dataset.openBackup,'_blank','noopener')));
    root.querySelectorAll('[data-open-recovery]').forEach(button => button.addEventListener('click',() => window.open(button.dataset.openRecovery,'_blank','noopener')));
    root.querySelectorAll('[data-recovery]').forEach(button => button.addEventListener('click',() => prepareRecovery_(button.dataset.recovery,button.dataset.recoveryName,button)));
    root.querySelectorAll('[data-restore-master]').forEach(button => button.addEventListener('click',() => openRestoreMaster_(button.dataset.restoreMaster,button.dataset.restoreName,recoverableSheets)));
    root.querySelectorAll('[data-restore-missing]').forEach(button=>button.addEventListener('click',()=>restoreMissingProductionSheet_(button.dataset.restoreMissing,button.dataset.sourceId,button)));
    root.querySelectorAll('[data-restore-structure]').forEach(button=>button.addEventListener('click',()=>restoreProductionSheetStructure_(button.dataset.restoreStructure,button.dataset.sourceId,button)));
    root.querySelectorAll('[data-restore-content]').forEach(button=>button.addEventListener('click',()=>restoreProductionSheetContent_(button.dataset.restoreContent,button.dataset.sourceId,button)));
    root.querySelectorAll('[data-restore-transactions]').forEach(button=>button.addEventListener('click',()=>restoreMissingTransactionsProduction_(button.dataset.restoreTransactions,button)));
    root.querySelectorAll('[data-emergency-restore]').forEach(button=>button.addEventListener('click',()=>emergencyRestoreProduction_(button.dataset.emergencyRestore,button)));
  }

  async function cleanupLegacyDatabase_(triggerButton=null) {
    const pin=await requestAdminPin_({
      title:'Bersihkan kolom legacy DATABASE?',
      message:'Sistem akan membuat backup pengaman, memeriksa seluruh Kode Paket dan Catatan Kurir lama, memastikan nilainya sudah tersimpan konsisten di DELIVERY_META, lalu menghapus hanya kolom metadata legacy dari DATABASE. Jika ditemukan konflik, pembersihan dibatalkan dan tidak ada kolom yang dihapus.',
      confirmLabel:'Ya, Verifikasi & Bersihkan'
    });
    if(!pin)return;
    setBusy(triggerButton,true,'Memverifikasi…');
    const x=window.scrollX,y=window.scrollY;
    try{
      const response=await api().adminCleanupLegacyDatabase(token(),pin);
      const cleanup=response.data?.cleanup||{};
      if(cleanup.resilienceSnapshot)state.resilience=cleanup.resilienceSnapshot;
      else await refreshResilienceState_({silent:true,preserveScroll:true});
      state.fidelity=null;
      if(archiveMounted_()){drawArchive();restoreScroll_(x,y);}
      ctx.showToast(cleanup.noChanges?'DATABASE sudah bersih dari kolom metadata legacy.':`${Number(cleanup.removedColumns||0)} kolom legacy dihapus. DELIVERY_META diverifikasi: ${Number(cleanup.migratedCreated||0)} dibuat, ${Number(cleanup.migratedUpdated||0)} diperbarui.`,'success',9000);
    }catch(error){ctx.showToast(error.message,'error',10000);}
    finally{setBusy(triggerButton,false);}
  }

  async function checkDataFidelity_(triggerButton=null) {
    setBusy(triggerButton,true,'Memeriksa…');
    const x=window.scrollX,y=window.scrollY;
    try {
      const response=await api().adminDataFidelityHealth(token());
      state.fidelity=response.data?.health || null;
      if (archiveMounted_()) drawArchive();
      restoreScroll_(x,y);
      const count=Array.isArray(state.fidelity?.issues)?state.fidelity.issues.length:0;
      const seconds=Math.max(0,Number(state.fidelity?.durationMs||0)/1000);
      ctx.showToast(count?`${count} masalah integritas memerlukan perbaikan. Pemeriksaan ${seconds.toFixed(1)} detik.`:`Integritas format data terdeteksi sehat. Pemeriksaan ${seconds.toFixed(1)} detik.`,count?'warning':'success',7000);
    } catch(error) { ctx.showToast(error.message,'error',8000); }
    finally { setBusy(triggerButton,false); }
  }

  async function repairDataFidelity_(triggerButton=null) {
    const pin=await requestAdminPin_({title:'Perbaiki integritas format data?',message:'Sistem akan membuat backup pengaman, menyelaraskan zona waktu Spreadsheet ke zona operasional bila perlu, lalu memperbaiki hanya nilai yang benar-benar bermasalah. Serial tanggal dipertahankan sebagai wall-clock agar jam tidak bergeser.',confirmLabel:'Ya, Perbaiki Format'});
    if(!pin)return;
    setBusy(triggerButton,true,'Memperbaiki…');
    const x=window.scrollX,y=window.scrollY;
    try {
      const response=await api().adminRepairDataFidelity(token(),pin);
      state.fidelity=response.data?.repair?.health || null;
      await refreshResilienceState_({silent:true,preserveScroll:true});
      if(state.fidelity && archiveMounted_()) { drawArchive(); restoreScroll_(x,y); }
      const ok=response.data?.repair?.ok===true;
      ctx.showToast(ok?'Integritas format data berhasil diperbaiki dan diverifikasi.':'Perbaikan selesai tetapi masih ada format yang perlu diperiksa.',ok?'success':'warning',9000);
    } catch(error) { ctx.showToast(error.message,'error',9000); }
    finally { setBusy(triggerButton,false); }
  }

  async function refreshResilienceState_({silent=false,preserveScroll=true}={}) {
    if (archiveRefreshBusy) {
      for (let i=0;i<20 && archiveRefreshBusy;i++) await new Promise(resolve => setTimeout(resolve,100));
      if (archiveRefreshBusy) return false;
    }
    archiveRefreshBusy = true;
    const x = window.scrollX;
    const y = window.scrollY;
    try {
      const [archiveResult,resilienceResult] = await Promise.allSettled([
        api().adminArchiveHealth(token()),
        api().adminResilienceHealth(token())
      ]);
      if (resilienceResult.status !== 'fulfilled') throw resilienceResult.reason;
      state.resilience = resilienceResult.value.data?.health || null;
      state.archive = archiveResult.status === 'fulfilled'
        ? (archiveResult.value.data?.health || null)
        : {unavailable:true,error:String(archiveResult.reason?.message || 'Informasi arsip sementara tidak tersedia.')};
      if (archiveMounted_()) drawArchive();
      if (preserveScroll) restoreScroll_(x,y);
      if (!silent) ctx.showToast('Kesehatan data diperbarui.','success');
      return true;
    } catch (error) {
      if (!silent) ctx.showToast(error.message,'error',7000);
      throw error;
    } finally {
      archiveRefreshBusy = false;
    }
  }

  function applyPostState_(restore) {
    const snapshot = restore?.resilienceSnapshot || null;
    if (snapshot) {
      state.resilience = snapshot;
      if (archiveMounted_()) drawArchive();
      return true;
    }
    const post = restore?.postState || null;
    if (!post || !state.resilience) return false;
    if (post.structure) state.resilience.structure = post.structure;
    if (post.dataHealth) state.resilience.dataHealth = post.dataHealth;
    if (post.maintenanceMode) state.resilience.maintenanceMode = post.maintenanceMode;
    if (post.protection) state.resilience.protection = post.protection;
    ['lastMasterRestore','lastSystemRestore','lastStructureRestore','lastCellRestore','lastContentRestore','lastTransactionRestore','emergencyAccess'].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(post,key)) state.resilience[key] = post[key];
    });
    if (archiveMounted_()) drawArchive();
    return true;
  }

  function scheduleRecoveryVerification_() {
    setTimeout(() => refreshResilienceState_({silent:true,preserveScroll:true}).catch(() => {}), 900);
  }

  async function refreshAfterRecovery_(restore=null) {
    const applied = applyPostState_(restore);
    if (!applied) await refreshResilienceState_({silent:true,preserveScroll:true});
    scheduleRecoveryVerification_();
  }

  async function restoreMissingProductionSheet_(sheetName,sourceId,triggerButton=null) {
    const pin = await requestAdminPin_({title:`Pulihkan ${systemSheetLabel(sheetName)}?`,message:`Sheet ${sheetName} akan dibuat kembali dari backup sehat yang dipilih sistem. Data lain tidak disentuh.`,confirmLabel:'Ya, Pulihkan Sheet'});
    if (!pin) return;
    setBusy(triggerButton,true,'Memulihkan…');
    try {
      const response=await api().adminRestoreMissingSheet(token(),sourceId,sheetName,pin);
      const restore=response.data?.restore||{};
      ctx.showToast(`${systemSheetLabel(sheetName)} berhasil dipulihkan.`,'success',6000);
      await refreshAfterRecovery_(restore);
    } catch (error) { ctx.showToast(error.message,'error',7000); }
    finally { setBusy(triggerButton,false); }
  }

  async function restoreProductionSheetStructure_(sheetName,sourceId,triggerButton=null) {
    const issue = (state.resilience?.structure?.damaged || []).find(item=>String(item.name||'')===String(sheetName||''));
    const pin = await requestAdminPin_({title:`Pulihkan struktur ${systemSheetLabel(sheetName)}?`,message:`Header/struktur ${sheetName} akan dipulihkan dari Backup Sehat Terakhir${issue?.recommendedSource?.name?` (${issue.recommendedSource.name})`:''}. Jika sheet kosong total, header, format, dan isi dari backup sehat akan dikembalikan.`,confirmLabel:'Ya, Pulihkan Struktur'});
    if (!pin) return;
    setBusy(triggerButton,true,'Memulihkan…');
    try {
      const response = await api().adminRestoreSheetStructure(token(),sourceId,sheetName,pin);
      const restore = response.data?.restore || {};
      const message = restore.mode === 'FULL_SHEET_FROM_HEALTHY_BACKUP'
        ? `${systemSheetLabel(sheetName)} berhasil dipulihkan lengkap termasuk ${Number(restore.restoredRows||0)} data.`
        : `Struktur ${systemSheetLabel(sheetName)} berhasil dipulihkan tanpa menimpa data yang masih ada.`;
      ctx.showToast(message,'success',8000);
      await refreshAfterRecovery_(restore);
    } catch (error) { ctx.showToast(error.message,'error',8000); }
    finally { setBusy(triggerButton,false); }
  }

  async function restoreProductionSheetContent_(sheetName,sourceId,triggerButton=null) {
    const issue = (state.resilience?.dataHealth?.issues || []).find(item=>String(item.name||'')===String(sheetName||''));
    const pin = await requestAdminPin_({title:`Pulihkan isi ${systemSheetLabel(sheetName)}?`,message:`Data yang hilang akan dikembalikan dari Backup Sehat Terakhir${issue?.recommendedSource?.name?` (${issue.recommendedSource.name})`:''}. Data baru yang sudah ada tidak akan dihapus.`,confirmLabel:'Ya, Pulihkan Isi'});
    if (!pin) return;
    setBusy(triggerButton,true,'Memulihkan…');
    try {
      const response = await api().adminRestoreSheetContent(token(),sourceId,sheetName,pin);
      const restore = response.data?.restore || {};
      ctx.showToast(`${Number(restore.restoredRows||0)} data ${systemSheetLabel(sheetName)} berhasil dipulihkan tanpa menghapus data baru.`,'success',8000);
      await refreshAfterRecovery_(restore);
    } catch (error) { ctx.showToast(error.message,'error',8000); }
    finally { setBusy(triggerButton,false); }
  }

  async function restoreMissingTransactionsProduction_(sourceId,triggerButton=null) {
    const pin=await requestAdminPin_({title:'Pulihkan transaksi yang hilang?',message:'Sistem hanya akan menambahkan record transaksi yang hilang berdasarkan ID dari checkpoint sehat. Data transaksi baru yang sudah ada tidak dihapus atau di-rollback.',confirmLabel:'Ya, Pulihkan Transaksi'});
    if(!pin)return;
    setBusy(triggerButton,true,'Memulihkan…');
    try{
      const response=await api().adminRestoreMissingTransactions(token(),sourceId,pin,true);
      const restore=response.data?.restore||{};
      const consistency=restore.consistency||{};
      ctx.showToast(`${Number(restore.restoredRows||0)} record transaksi berhasil dipulihkan. Konsistensi: ${consistency.ok?'AMAN':'PERLU PEMERIKSAAN'}.`,consistency.ok?'success':'warning',9000);
      await refreshAfterRecovery_(restore);
    }catch(error){ctx.showToast(error.message,'error',9000);}
    finally{setBusy(triggerButton,false);}
  }

  async function emergencyRestoreProduction_(sourceId,triggerButton=null) {
    const pin = await requestAdminPin_({title:'Pemulihan darurat data transaksi?',message:'DATABASE dan sheet transaksi terkait akan dikembalikan bersama-sama dari satu checkpoint/backup agar konsisten. Data setelah waktu sumber pemulihan mungkin perlu diverifikasi.',confirmLabel:'Saya Paham, Pulihkan'});
    if (!pin) return;
    setBusy(triggerButton,true,'Memulihkan…');
    try {
      const response = await api().adminEmergencyRestore(token(),sourceId,pin,true);
      const restore = response.data?.restore || {};
      const consistency = restore.consistency || {};
      const sourceNote = restore.sourceFallbackUsed ? ` Sumber awal tidak sehat; sistem otomatis memakai ${restore.sourceName || 'Backup Transaksi Sehat Terakhir'}.` : '';
      ctx.showToast(`Pemulihan darurat selesai. Konsistensi: ${consistency.ok?'AMAN':'PERLU PEMERIKSAAN'}.${sourceNote}`,consistency.ok?'success':'warning',10000);
      await refreshAfterRecovery_(restore);
    } catch (error) { ctx.showToast(error.message,'error',8000); }
    finally { setBusy(triggerButton,false); }
  }

  async function openCellComparison_(sourceId,sheetName) {
    if (!sheetName) return;
    try {
      const response = await api().adminCompareMasterCells(token(),sourceId,sheetName);
      const comparison = response.data?.comparison || {};
      const rows = Array.isArray(comparison.candidates) ? comparison.candidates : [];
      if (!rows.length) { ctx.showToast('Tidak ditemukan cell kosong yang berbeda dari backup.','success'); return; }
      ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">PEMULIHAN CELL</div><h3>${esc(masterSheetLabel(sheetName))}</h3><p>Sumber: ${esc(comparison.sourceName||'-')}</p></div><button class="modal-x" data-modal-close>×</button></div>
        <div class="system-alert info"><strong>Pilih hanya cell yang memang tidak sengaja terhapus.</strong><span>Cell yang sengaja dikosongkan tidak perlu dipulihkan.</span></div>
        <div class="cell-diff-list">${rows.map(item=>`<label class="cell-diff-row"><input type="checkbox" value="${esc(item.a1)}" data-cell-restore><span><strong>${esc(item.a1)}</strong><small>Backup: ${esc(item.backupValue||'-')}</small></span></label>`).join('')}</div>
        <div class="field"><label for="cellRestorePin">PIN Admin <b>*</b></label><input id="cellRestorePin" type="password" inputmode="numeric" autocomplete="off" placeholder="Masukkan PIN Admin"></div><div id="cellRestoreMsg"></div>
        <div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="cellRestoreSave" class="warning-btn">Pulihkan Cell Terpilih</button></div>`,{wide:true});
      document.getElementById('cellRestoreSave')?.addEventListener('click',async()=>{
        const cells=[...document.querySelectorAll('[data-cell-restore]:checked')].map(el=>el.value);
        const pin=String(document.getElementById('cellRestorePin')?.value||'').trim();
        const msg=document.getElementById('cellRestoreMsg');
        if(!cells.length){msg.innerHTML='<div class="alert error">Pilih minimal satu cell.</div>';return;}
        if(!pin){msg.innerHTML='<div class="alert error">PIN Admin wajib diisi.</div>';return;}
        const button=document.getElementById('cellRestoreSave');setBusy(button,true,'Memulihkan…');
        try{
          const response = await api().adminRestoreMasterCells(token(),sourceId,sheetName,cells,pin);
          const restore = response.data?.restore || {};
          const verification = restore.verification || {};
          const restored = Array.isArray(restore.restoredCells) ? restore.restoredCells : [];
          const failed = Array.isArray(restore.failedCells) ? restore.failedCells : [];
          ctx.closeModal();
          if (failed.length) {
            ctx.showToast(`${restored.length} cell berhasil dipulihkan; ${failed.length} cell belum lolos verifikasi: ${failed.map(item=>item.a1 + (item.field?` (${item.field})`:'' )).join(', ')}.`,'warning',9000);
          } else {
            ctx.showToast(`${restored.length || cells.length} cell berhasil dipulihkan dan diverifikasi.`,'success',6500);
          }
          await refreshAfterRecovery_(restore);
        }catch(error){msg.innerHTML=`<div class="alert error">${esc(error.message)}</div>`;setBusy(button,false);}
      });
    } catch (error) { ctx.showToast(error.message,'error',7000); }
  }

  async function restoreProductionFromTrash_() {
    const pin=await requestAdminPin_({title:'Pulihkan file Master dari Sampah?',message:'Sistem akan mengembalikan file Master produksi yang sama dari Sampah Google Drive. ID file tidak berubah.',confirmLabel:'Pulihkan File Asli'});
    if(!pin)return;
    try{await api().adminRestoreActiveFromTrash(token(),pin);ctx.showToast('File Master produksi kembali aktif.','success',6000);await refreshResilienceState_({silent:true,preserveScroll:true});}catch(error){ctx.showToast(error.message,'error',7000);}
  }

  function openBackupModal_() {
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">BACKUP MASTER</div><h3>Buat Backup Sekarang</h3><p>Gunakan sebelum perubahan penting pada Master Spreadsheet.</p></div><button class="modal-x" data-modal-close>×</button></div><div class="field"><label for="backupNote">Catatan <span class="optional">opsional</span></label><textarea id="backupNote" rows="3" placeholder="Contoh: sebelum menambah pegawai atau mengganti PIN"></textarea></div><div id="backupModalMsg"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="backupSave" class="primary-btn">Buat Backup</button></div>`);
    document.getElementById('backupSave')?.addEventListener('click',async() => {
      const button = document.getElementById('backupSave');
      setBusy(button,true,'Membuat Backup…');
      try {
        const response=await api().adminBackupNow(token(),document.getElementById('backupNote')?.value || '');
        const backup=response.data?.backup||null;
        if(backup && state.resilience){
          const recent=Array.isArray(state.resilience.recent)?state.resilience.recent.slice():[];
          state.resilience.recent=[backup,...recent.filter(item=>String(item.id||'')!==String(backup.id||''))].slice(0,12);
          state.resilience.lastManual={ok:true,at:backup.createdAt||new Date().toISOString(),id:backup.id,name:backup.name};
        }
        ctx.closeModal();
        if(archiveMounted_())drawArchive();
        ctx.showToast('Backup Master berhasil dibuat. Daftar backup diperbarui.','success');
        setTimeout(()=>refreshResilienceState_({silent:true,preserveScroll:true}).catch(()=>{}),700);
      } catch (error) { document.getElementById('backupModalMsg').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; setBusy(button,false); }
    });
  }

  async function ensureBackupSchedule_(triggerButton=null) {
    const pin = await requestAdminPin_({title:'Aktifkan backup otomatis?',message:'Sistem akan memastikan jadwal backup otomatis aktif. Tidak ada data transaksi yang diubah.',confirmLabel:'Aktifkan'});
    if (!pin) return;
    setBusy(triggerButton,true,'Mengaktifkan…');
    try {
      await api().adminEnsureBackupSchedule(token(),pin);
      await refreshResilienceState_({silent:true,preserveScroll:true});
      ctx.showToast('Backup otomatis aktif.','success');
    } catch (error) { ctx.showToast(error.message,'error'); }
    finally { setBusy(triggerButton,false); }
  }

  async function prepareRecovery_(backupId,backupName,triggerButton=null) {
    const pin = await requestAdminPin_({title:'Siapkan salinan pemulihan?',message:`Sistem akan menyalin ${backupName || 'backup terpilih'} ke folder RECOVERY. Master aktif tidak akan diubah.`,confirmLabel:'Siapkan Salinan'});
    if (!pin) return;
    setBusy(triggerButton,true,'Menyiapkan…');
    try {
      const response = await api().adminPrepareRecovery(token(),backupId,pin);
      const recovery = response.data?.recovery || null;
      ctx.showToast('Salinan pemulihan berhasil dibuat.','success');
      if (recovery?.url) window.open(recovery.url,'_blank','noopener');
      await refreshResilienceState_({silent:true,preserveScroll:true});
    } catch (error) { ctx.showToast(error.message,'error'); }
  }

  function openRestoreMaster_(backupId,backupName,availableSheets) {
    const sheets = Array.isArray(availableSheets) && availableSheets.length ? availableSheets : ['MASTER_DATA','AKSES','MASTER_WILAYAH'];
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">PEMULIHAN MASTER</div><h3>Pulihkan dari Backup</h3><p>${esc(backupName || 'Backup terpilih')}</p></div><button class="modal-x" data-modal-close>×</button></div>
      <div class="system-alert warning"><strong>Hanya bagian Master yang dipilih akan dipulihkan.</strong><span>DATABASE transaksi pasien tidak dikembalikan ke masa lalu. Sistem otomatis membuat backup pengaman sebelum pemulihan.</span></div>
      <div class="field"><label>Pilih bagian yang akan dipulihkan <b>*</b></label><div class="master-restore-options">${sheets.map(name=>`<label class="check-row"><input type="checkbox" value="${esc(name)}" data-master-sheet><span><strong>${esc(masterSheetLabel(name))}</strong><small>${esc(name)}</small></span></label>`).join('')}</div></div>
      <div class="field"><label for="restoreAdminPin">PIN Admin <b>*</b></label><input id="restoreAdminPin" type="password" inputmode="numeric" autocomplete="off" placeholder="Masukkan PIN Admin"></div>
      <div id="restoreMasterMsg"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="restoreMasterSave" class="danger-btn">Ya, Pulihkan Master</button></div>` ,{wide:true});
    document.getElementById('restoreMasterSave')?.addEventListener('click',async() => {
      const button = document.getElementById('restoreMasterSave');
      const selected = [...document.querySelectorAll('[data-master-sheet]:checked')].map(input => input.value);
      const pin = String(document.getElementById('restoreAdminPin')?.value || '').trim();
      const msg = document.getElementById('restoreMasterMsg');
      if (!selected.length) { msg.innerHTML = '<div class="alert error">Pilih minimal satu bagian Master.</div>'; return; }
      if (!pin) { msg.innerHTML = '<div class="alert error">PIN Admin wajib diisi.</div>'; return; }
      setBusy(button,true,'Memulihkan…');
      try {
        const response = await api().adminRestoreMaster(token(),backupId,selected,pin);
        const restore = response.data?.restore || {};
        ctx.closeModal();
        ctx.showToast(`Pemulihan Master selesai: ${(restore.sheets||[]).map(masterSheetLabel).join(', ')}.`,'success',6000);
        await refreshAfterRecovery_(restore);
        if ((restore.sheets||[]).includes('AKSES') && typeof ctx.refreshSession === 'function') await ctx.refreshSession();
      } catch (error) { msg.innerHTML = `<div class="alert error">${esc(error.message)}</div>`; setBusy(button,false); }
    });
  }

  async function applyMasterProtections_(triggerButton=null) {
    const pin = await requestAdminPin_({title:'Perbaiki proteksi Master?',message:'Sistem akan menerapkan ulang proteksi edit manual pada sheet kritis. Operasional aplikasi tetap dapat berjalan melalui backend.',confirmLabel:'Terapkan Proteksi'});
    if (!pin) return;
    setBusy(triggerButton,true,'Memperbaiki…');
    try {
      await api().adminApplyProtections(token(),pin);
      await refreshResilienceState_({silent:true,preserveScroll:true});
      ctx.showToast('Proteksi Master diperbarui.','success');
    } catch (error) { ctx.showToast(error.message,'error'); }
    finally { setBusy(triggerButton,false); }
  }

  async function renderMaster() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">MASTER</div><h1>Master Data & Akun</h1><p>Kelola akun petugas dan konfigurasi inti dari Dashboard Admin. Spreadsheet tidak perlu menjadi tempat kerja harian.</p></div><div class="hero-actions"><button id="masterRefresh" class="secondary-btn">↻ Segarkan</button></div></section><section class="section" id="masterBody"><div class="inline-loading">Memuat…</div></section>`;
    const load = async() => {
      try {
        const response = await api().adminRefreshMaster(token());
        state.master = response.data?.master || {};
        state.accounts = response.data?.accounts || {accounts:[]};
        drawMaster();
      } catch (error) { document.getElementById('masterBody').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; }
    };
    document.getElementById('masterRefresh')?.addEventListener('click',async event=>{const button=event.currentTarget;setBusy(button,true,'Memuat…');try{await load();}finally{setBusy(button,false);}});
    await load();
  }

  function accountRoleLabel_(role) {
    return ({ADMIN:'Admin Data',FARMASI:'Farmasi',KURIR:'Kurir',MANAJEMEN:'Manajemen'})[String(role||'').toUpperCase()] || role || '-';
  }

  function accountByEmail_(email) {
    const rows=Array.isArray(state.accounts?.accounts)?state.accounts.accounts:[];
    return rows.find(item=>String(item.email||'').toLowerCase()===String(email||'').toLowerCase()) || null;
  }

  function drawMaster() {
    const m = state.master || {};
    const accountState = state.accounts || {accounts:[]};
    const accounts = Array.isArray(accountState.accounts) ? accountState.accounts : [];
    const admin = accounts.find(item=>item.isAdmin) || null;
    const operational = accounts.filter(item=>!item.isAdmin);
    const items = [
      ['Wilayah',countArray(m.areas)],
      ['Alasan Gagal/Pending',countArray(m.failureReasons)],
      ['Jenis Kendala',countArray(m.incidentTypes)],
      ['Estimasi Keterlambatan',countArray(m.delayEstimates)],
      ['Metode Verifikasi',countArray(m.manualVerificationMethods)],
      ['Hubungan Penerima',countArray(m.receiptRelationships)]
    ];
    const adminWarning = accountState.singleAdminOk===false
      ? `<div class="system-alert warning"><strong>Konfigurasi Admin perlu diperiksa.</strong><span>Produksi V1 menggunakan tepat satu Admin aktif. Saat ini terdeteksi ${Number(accountState.adminCount||0)} akun Admin dan ${Number(accountState.activeAdminCount||0)} Admin aktif.</span></div>` : '';
    const adminCard = admin ? `<div class="account-admin-card"><div><span class="eyebrow">ADMIN TUNGGAL</span><h3>${esc(admin.name||'Administrator Sistem')}</h3><p>${esc(admin.email||'-')} • ADMIN • ${admin.active?'AKTIF':'NONAKTIF'}</p><small>PIN tersimpan: ${admin.pinConfigured?'Ya':'Tidak'} • Credential pemulihan darurat tersinkron otomatis saat PIN Admin diganti dari Dashboard.</small></div><div class="account-actions"><button class="mini-btn" data-account-edit="${esc(admin.email)}">Ubah Profil</button><button class="mini-btn warning-soft" data-account-pin="${esc(admin.email)}">Ganti PIN</button></div></div>` : `<div class="system-alert error"><strong>Akun Admin tidak ditemukan.</strong><span>Gunakan Arsip → Pemulihan Master untuk mengembalikan Akun & PIN.</span></div>`;
    const operationalRows = operational.length ? operational.map(item=>`<tr><td data-label="Nama"><strong>${esc(item.name||'-')}</strong><small class="table-sub">${esc(item.email||'-')}</small></td><td data-label="Role">${esc(accountRoleLabel_(item.role))}</td><td data-label="Status"><span class="status-badge ${item.active?'delivered':'neutral'}">${item.active?'AKTIF':'NONAKTIF'}</span></td><td data-label="PIN">${item.pinConfigured?'Tersimpan':'Belum ada'}</td><td data-label="Aksi"><div class="row-actions"><button class="mini-btn" data-account-edit="${esc(item.email)}">Edit</button><button class="mini-btn" data-account-pin="${esc(item.email)}">Ganti PIN</button><button class="mini-btn ${item.active?'danger-soft':'primary-soft'}" data-account-active="${esc(item.email)}" data-next-active="${item.active?'0':'1'}">${item.active?'Nonaktifkan':'Aktifkan'}</button></div></td></tr>`).join('') : '';
    document.getElementById('masterBody').innerHTML = `
      ${adminWarning}
      <div class="content-card account-management-card"><div class="card-head-row"><div><span class="eyebrow">AKUN & PIN</span><h3>Pengelolaan Akses Petugas</h3><p>Tambah petugas, ubah role, ganti PIN, dan aktif/nonaktifkan akun langsung dari Dashboard. Akun tidak dihapus agar jejak aktivitas tetap terjaga.</p></div><button id="addOperationalAccount" class="primary-btn">+ Tambah Akun</button></div>
        ${adminCard}
        <div class="account-table-head"><div><h3>Akun Operasional</h3><p>${operational.length} akun terdaftar</p></div></div>
        ${operational.length?`<div class="table-scroll"><table class="data-table responsive-table"><thead><tr><th>Nama</th><th>Role</th><th>Status</th><th>PIN</th><th>Aksi</th></tr></thead><tbody>${operationalRows}</tbody></table></div>`:`<div class="empty-state"><p>Belum ada akun Farmasi, Kurir, atau Manajemen.</p></div>`}
      </div>
      <div class="grid grid-3">${items.map(([label,value]) => metric(label,value,'Item aktif')).join('')}</div>
      <div class="system-alert info"><strong>Spreadsheet adalah database belakang layar.</strong><span>Perubahan akun normal dilakukan melalui Dashboard Admin. Spreadsheet hanya dibuka untuk pemeriksaan teknis atau pemulihan khusus.</span></div>`;
    bindAccountActions_();
  }

  function bindAccountActions_() {
    document.getElementById('addOperationalAccount')?.addEventListener('click',openAddAccount_);
    document.querySelectorAll('[data-account-edit]').forEach(button=>button.addEventListener('click',()=>openEditAccount_(button.dataset.accountEdit)));
    document.querySelectorAll('[data-account-pin]').forEach(button=>button.addEventListener('click',()=>openChangeAccountPin_(button.dataset.accountPin)));
    document.querySelectorAll('[data-account-active]').forEach(button=>button.addEventListener('click',()=>toggleAccountActive_(button.dataset.accountActive,button.dataset.nextActive==='1',button)));
  }

  async function applyAccountsResponse_(response) {
    const payload=response?.data?.accounts || null;
    if(payload) state.accounts=payload;
    else {
      const refreshed=await api().adminRefreshMaster(token());
      state.master=refreshed.data?.master||state.master;
      state.accounts=refreshed.data?.accounts||state.accounts;
    }
    drawMaster();
  }

  function openAddAccount_() {
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">AKUN BARU</div><h3>Tambah Akun Operasional</h3><p>Produksi V1 hanya memiliki satu Admin. Akun baru dapat dibuat untuk Farmasi, Kurir, atau Manajemen.</p></div><button class="modal-x" data-modal-close>×</button></div>
      <div class="grid grid-2"><div class="field"><label>Email / ID akun <b>*</b></label><input id="accountEmail" type="email" autocomplete="off" placeholder="contoh: kurir4@rsudntb.local"></div><div class="field"><label>Nama petugas <b>*</b></label><input id="accountName" autocomplete="off" placeholder="Nama lengkap"></div><div class="field"><label>Role <b>*</b></label><select id="accountRole"><option value="FARMASI">Farmasi</option><option value="KURIR">Kurir</option><option value="MANAJEMEN">Manajemen</option></select></div><div class="field"><label>PIN awal <b>*</b></label><input id="accountPin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="4–8 angka"></div></div>
      <div class="field"><label>Catatan <span class="optional">opsional</span></label><input id="accountNote" placeholder="Contoh: Kurir wilayah A"></div><div class="field"><label>PIN Admin <b>*</b></label><input id="accountAdminPin" type="password" inputmode="numeric" autocomplete="off" placeholder="Konfirmasi PIN Admin"></div>
      <div class="system-alert info compact-alert"><strong>Akun dibuat aktif.</strong><span>PIN dapat diganti kapan saja dari Dashboard Admin.</span></div><div id="accountModalMsg"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="accountCreateSave" class="primary-btn">Tambah Akun</button></div>`,{wide:true});
    document.getElementById('accountCreateSave')?.addEventListener('click',async()=>{
      const button=document.getElementById('accountCreateSave');
      const payload={email:document.getElementById('accountEmail')?.value||'',name:document.getElementById('accountName')?.value||'',role:document.getElementById('accountRole')?.value||'',pin:document.getElementById('accountPin')?.value||'',note:document.getElementById('accountNote')?.value||''};
      const adminPin=String(document.getElementById('accountAdminPin')?.value||'').trim();
      if(!adminPin){document.getElementById('accountModalMsg').innerHTML='<div class="alert error">PIN Admin wajib diisi.</div>';return;}
      setBusy(button,true,'Menambahkan…');
      try{const response=await api().adminAccountCreate(token(),payload,adminPin);ctx.closeModal();await applyAccountsResponse_(response);ctx.showToast('Akun operasional berhasil ditambahkan.','success',6000);}catch(error){document.getElementById('accountModalMsg').innerHTML=`<div class="alert error">${esc(error.message)}</div>`;setBusy(button,false);}
    });
  }

  function openEditAccount_(email) {
    const item=accountByEmail_(email);if(!item)return ctx.showToast('Akun tidak ditemukan. Segarkan Master.','error');
    const isAdmin=item.isAdmin===true;
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">${isAdmin?'ADMIN TUNGGAL':'EDIT AKUN'}</div><h3>${isAdmin?'Ubah Profil Admin':'Ubah Akun Petugas'}</h3><p>${isAdmin?'Role ADMIN dan status AKTIF dikunci pada Produksi V1.':'Perubahan disimpan ke Akun & PIN dan dicatat pada Audit.'}</p></div><button class="modal-x" data-modal-close>×</button></div>
      <div class="grid grid-2"><div class="field"><label>Email / ID akun <b>*</b></label><input id="editAccountEmail" type="email" value="${esc(item.email||'')}" ${isAdmin?'disabled':''}></div><div class="field"><label>Nama petugas <b>*</b></label><input id="editAccountName" value="${esc(item.name||'')}"></div><div class="field"><label>Role</label>${isAdmin?`<input value="Admin Data" disabled>`:`<select id="editAccountRole"><option value="FARMASI" ${item.role==='FARMASI'?'selected':''}>Farmasi</option><option value="KURIR" ${item.role==='KURIR'?'selected':''}>Kurir</option><option value="MANAJEMEN" ${item.role==='MANAJEMEN'?'selected':''}>Manajemen</option></select>`}</div><div class="field"><label>Status</label><input value="${isAdmin?'AKTIF — dikunci':(item.active?'AKTIF':'NONAKTIF')}" disabled></div></div>
      <div class="field"><label>Catatan <span class="optional">opsional</span></label><input id="editAccountNote" value="${esc(item.note||'')}"></div><div class="field"><label>PIN Admin <b>*</b></label><input id="editAccountAdminPin" type="password" inputmode="numeric" autocomplete="off" placeholder="Konfirmasi PIN Admin"></div><div id="editAccountMsg"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="editAccountSave" class="primary-btn">Simpan Perubahan</button></div>`,{wide:true});
    document.getElementById('editAccountSave')?.addEventListener('click',async()=>{
      const button=document.getElementById('editAccountSave');
      const payload={email:document.getElementById('editAccountEmail')?.value||'',name:document.getElementById('editAccountName')?.value||'',role:isAdmin?'ADMIN':document.getElementById('editAccountRole')?.value||'',active:isAdmin?true:item.active,note:document.getElementById('editAccountNote')?.value||''};
      const adminPin=String(document.getElementById('editAccountAdminPin')?.value||'').trim();if(!adminPin){document.getElementById('editAccountMsg').innerHTML='<div class="alert error">PIN Admin wajib diisi.</div>';return;}
      setBusy(button,true,'Menyimpan…');
      try{const response=await api().adminAccountUpdate(token(),item.email,payload,adminPin);ctx.closeModal();await applyAccountsResponse_(response);ctx.showToast(isAdmin?'Profil Admin berhasil diperbarui.':'Akun berhasil diperbarui.','success',6000);}catch(error){document.getElementById('editAccountMsg').innerHTML=`<div class="alert error">${esc(error.message)}</div>`;setBusy(button,false);}
    });
  }

  function openChangeAccountPin_(email) {
    const item=accountByEmail_(email);if(!item)return ctx.showToast('Akun tidak ditemukan. Segarkan Master.','error');
    ctx.openModal(`<div class="modal-head"><div><div class="eyebrow">GANTI PIN</div><h3>${esc(item.name||item.email)}</h3><p>${item.isAdmin?'PIN Admin baru akan langsung disinkronkan dengan credential Pemulihan Akses Darurat.':'PIN lama akan diganti dan tidak ditampilkan kembali.'}</p></div><button class="modal-x" data-modal-close>×</button></div>
      <div class="field"><label>PIN baru <b>*</b></label><input id="newAccountPin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="4–8 angka"></div><div class="field"><label>Ulangi PIN baru <b>*</b></label><input id="repeatAccountPin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="Ulangi PIN"></div><div class="field"><label>PIN Admin saat ini <b>*</b></label><input id="changePinAdminConfirm" type="password" inputmode="numeric" autocomplete="off" placeholder="Konfirmasi PIN Admin"></div><div id="changePinMsg"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Batal</button><button id="changePinSave" class="warning-btn">Ganti PIN</button></div>`);
    document.getElementById('changePinSave')?.addEventListener('click',async()=>{
      const button=document.getElementById('changePinSave');const p1=String(document.getElementById('newAccountPin')?.value||'').trim(),p2=String(document.getElementById('repeatAccountPin')?.value||'').trim();const msg=document.getElementById('changePinMsg');
      if(p1!==p2){msg.innerHTML='<div class="alert error">PIN baru dan konfirmasi PIN tidak sama.</div>';return;}
      if(!/^\d{4,8}$/.test(p1)){msg.innerHTML='<div class="alert error">PIN harus terdiri dari 4–8 angka.</div>';return;}
      const adminPin=String(document.getElementById('changePinAdminConfirm')?.value||'').trim();if(!adminPin){msg.innerHTML='<div class="alert error">PIN Admin saat ini wajib diisi.</div>';return;}
      setBusy(button,true,'Mengganti PIN…');
      try{const response=await api().adminAccountChangePin(token(),item.email,p1,adminPin);ctx.closeModal();await applyAccountsResponse_(response);ctx.showToast(item.isAdmin?'PIN Admin dan Pemulihan Darurat berhasil disinkronkan.':'PIN petugas berhasil diganti.','success',7000);if(item.isAdmin&&typeof ctx.refreshSession==='function')await ctx.refreshSession();}catch(error){msg.innerHTML=`<div class="alert error">${esc(error.message)}</div>`;setBusy(button,false);}
    });
  }

  async function toggleAccountActive_(email,nextActive,triggerButton=null) {
    const item=accountByEmail_(email);if(!item)return;
    if(item.isAdmin){ctx.showToast('Akun Admin tunggal tidak dapat dinonaktifkan.','error');return;}
    const pin=await requestAdminPin_({title:nextActive?'Aktifkan akun?':'Nonaktifkan akun?',message:`${item.name||item.email} akan ${nextActive?'dapat':'tidak dapat'} login ke aplikasi. Data dan riwayat akun tetap disimpan.`,confirmLabel:nextActive?'Ya, Aktifkan':'Ya, Nonaktifkan'});if(!pin)return;
    setBusy(triggerButton,true,nextActive?'Mengaktifkan…':'Menonaktifkan…');
    try{const response=await api().adminAccountSetActive(token(),item.email,nextActive,pin);await applyAccountsResponse_(response);ctx.showToast(nextActive?'Akun berhasil diaktifkan.':'Akun berhasil dinonaktifkan.','success',6000);}catch(error){ctx.showToast(error.message,'error',7000);}finally{setBusy(triggerButton,false);}
  }

  async function renderAudit() {
    page().innerHTML = `<section class="hero compact"><div><div class="eyebrow">AUDIT</div><h1>Jejak Aktivitas</h1><p>Perubahan data dan aktivitas penting tercatat untuk penelusuran.</p></div><div class="hero-actions"><button id="auditRefresh" class="secondary-btn">↻ Segarkan</button></div></section><section class="section"><div class="toolbar-card audit-toolbar"><div class="search-box"><span>⌕</span><input id="auditSearch" placeholder="Cari Kode/ID, petugas, role, atau aksi…"></div><select id="auditRole"><option value="">Semua Role</option><option>FARMASI</option><option>KURIR</option><option>ADMIN</option><option>MANAJEMEN</option></select></div><div id="auditBody" class="content-card"><div class="inline-loading">Memuat…</div></div></section>`;
    document.getElementById('auditSearch')?.addEventListener('input',drawAudit);
    document.getElementById('auditRole')?.addEventListener('change',drawAudit);
    document.getElementById('auditRefresh')?.addEventListener('click',async event => { const button=event.currentTarget; setBusy(button,true,'Memuat…'); try { await loadAudit(); ctx.showToast('Audit diperbarui.','success'); } finally { setBusy(button,false); } });
    await loadAudit();
  }

  async function loadAudit() {
    try { const response = await api().adminAuditRows(token(),200); state.audit = response.data?.rows || []; drawAudit(); }
    catch (error) { document.getElementById('auditBody').innerHTML = `<div class="alert error">${esc(error.message)}</div>`; }
  }

  function drawAudit() {
    const root = document.getElementById('auditBody');
    if (!root) return;
    const query = String(document.getElementById('auditSearch')?.value || '').toLowerCase();
    const role = String(document.getElementById('auditRole')?.value || '').toUpperCase();
    const rows = state.audit.filter(item => {
      if (role && String(item.role||'').toUpperCase() !== role) return false;
      if (!query) return true;
      return [item.id,item.name,item.role,item.action,item.oldStatus,item.newStatus,item.note].some(value => String(value||'').toLowerCase().includes(query));
    });
    if (!rows.length) { root.innerHTML = '<div class="empty-state"><h3>Tidak ada audit sesuai filter</h3></div>'; return; }
    root.innerHTML = `<div class="table-scroll"><table class="data-table responsive-table"><thead><tr><th>Waktu</th><th>Petugas</th><th>Aksi</th><th>Perubahan</th><th>Catatan</th></tr></thead><tbody>${rows.map(item => `<tr><td data-label="Waktu">${fmt(item.time)}</td><td data-label="Petugas"><strong>${fmt(item.name)}</strong><span class="cell-sub">${fmt(item.role)}</span></td><td data-label="Aksi">${fmt(item.action)}<span class="cell-sub">${fmt(item.id)}</span></td><td data-label="Perubahan">${item.oldStatus||item.newStatus?`${badge(item.oldStatus||'-','neutral')} <span class="audit-arrow">→</span> ${badge(item.newStatus||'-',statusClass(item.newStatus))}`:'-'}</td><td data-label="Catatan">${fmt(item.note)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  return {renderHome,renderCorrections,renderArchive,renderMaster,renderAudit,resetForLogout};
}
