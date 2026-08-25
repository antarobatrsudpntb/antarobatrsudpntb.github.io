function trustedResponseOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com');
  } catch (_) { return false; }
}

function apiError(message, code = 'API_ERROR') {
  const error = new Error(String(message || 'Terjadi kesalahan pada server.'));
  error.code = String(code || 'API_ERROR');
  return error;
}

function stableKey(method, args) {
  let raw = '';
  try { raw = JSON.stringify(args); } catch (_) { raw = String(args); }
  return `${method}:${raw}`;
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export class AppsScriptTransport {
  constructor({ endpoint, timeoutMs = 25000, expectedContract = '', onState = () => {}, onAuthError = () => {}, onRequestState = () => {} }) {
    this.endpoint = String(endpoint || '').trim();
    this.timeoutMs = timeoutMs;
    this.expectedContract = String(expectedContract || '');
    this.onState = onState;
    this.onAuthError = onAuthError;
    this.onRequestState = onRequestState;
    this.pending = new Map();
    this.nonce = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    this.boundMessage = this.handleMessage.bind(this);
    window.addEventListener('message', this.boundMessage);
  }

  destroy() {
    window.removeEventListener('message', this.boundMessage);
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.cleanup();
      request.reject(apiError('Koneksi dihentikan.', 'TRANSPORT_STOPPED'));
      this.onRequestState({ active: false, method: request.method });
    }
    this.pending.clear();
  }

  async connect() {
    this.onState({ ready: false, message: 'Menghubungkan layanan…' });
    const result = await this.call('system.ping');
    const version = String(result?.data?.version || '');
    const contract = String(result?.data?.apiContract || '');
    if (this.expectedContract && contract !== this.expectedContract) {
      throw apiError(`Versi aplikasi dan server belum cocok. Server ${version || 'tidak diketahui'} menggunakan kontrak ${contract || '-'}, sedangkan aplikasi memerlukan ${this.expectedContract}.`, 'VERSION_MISMATCH');
    }
    const degraded = result?.data?.degraded === true;
    this.onState({ ready: true, message: degraded ? 'Layanan terhubung • pemulihan diperlukan' : 'Layanan terhubung' });
    return result;
  }

  handleMessage(event) {
    const message = event.data || {};
    if (message.type !== 'ANTAROBAT_RPC_RESPONSE' || message.nonce !== this.nonce || !message.id) return;
    const request = this.pending.get(message.id);
    if (!request) return;

    if (!trustedResponseOrigin(event.origin)) {
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      request.cleanup();
      this.onRequestState({ active: false, method: request.method });
      request.reject(apiError('Respons server berasal dari sumber yang tidak dipercaya.', 'UNTRUSTED_RESPONSE_ORIGIN'));
      return;
    }

    clearTimeout(request.timer);
    this.pending.delete(message.id);
    request.cleanup();
    this.onRequestState({ active: false, method: request.method });
    if (message.ok) return request.resolve(message.result);

    const error = apiError(message.error?.message, message.error?.code);
    if (error.code === 'SESSION_EXPIRED') {
      try { this.onAuthError(error); } catch (_) {}
    }
    request.reject(error);
  }

  call(method, ...args) { return this._call(method, args, ''); }
  callMutation(method, mutationId, ...args) { return this._call(method, args, String(mutationId || '')); }

  _call(method, args, mutationId) {
    if (!navigator.onLine) return Promise.reject(apiError('Perangkat sedang offline. Periksa koneksi internet lalu coba kembali.', 'OFFLINE'));
    const resilienceLongMethods = new Set([
      'admin.bootstrap','admin.archiveHealth','admin.resilienceHealth',
      'admin.backupNow','admin.prepareRecovery','admin.restoreMaster','admin.restoreMissingSheet','admin.restoreSheetStructure','admin.restoreSheetContent',
      'admin.restoreMasterCells','admin.restoreMissingTransactions','admin.emergencyRestore','admin.restoreActiveFromTrash','admin.applyProtections','admin.ensureBackupSchedule',
      'admin.accountCreate','admin.accountUpdate','admin.accountChangePin','admin.accountSetActive','admin.dataFidelityHealth','admin.repairDataFidelity','admin.cleanupLegacyDatabase'
    ]);
    const methodName=String(method||'');
    const requestTimeoutMs = methodName === 'admin.emergencyRestore'
      ? Math.max(this.timeoutMs, 240000)
      : methodName === 'admin.repairDataFidelity' || methodName === 'admin.cleanupLegacyDatabase'
        ? Math.max(this.timeoutMs, 180000)
        : methodName === 'admin.dataFidelityHealth'
          ? Math.max(this.timeoutMs, 60000)
      : methodName === 'admin.restoreMissingTransactions'
        ? Math.max(this.timeoutMs, 120000)
        : methodName === 'auth.login'
          ? Math.max(this.timeoutMs, 45000)
          : resilienceLongMethods.has(methodName) ? Math.max(this.timeoutMs, 90000) : this.timeoutMs;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(this.endpoint)) {
      return Promise.reject(apiError('Alamat layanan belum dikonfigurasi dengan benar.', 'INVALID_BACKEND_URL'));
    }

    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const frameName = `antarobat_rpc_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    this.onRequestState({ active: true, method });

    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.name = frameName;
      frame.title = 'Server Pengantaran Obat';
      frame.style.display = 'none';
      frame.setAttribute('aria-hidden', 'true');
      document.body.appendChild(frame);

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = this.endpoint;
      form.target = frameName;
      form.acceptCharset = 'UTF-8';
      form.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'rpc';
      input.value = JSON.stringify({ type:'ANTAROBAT_RPC_REQUEST', id, nonce:this.nonce, method, args, mutationId, origin:location.origin });
      form.appendChild(input);
      document.body.appendChild(form);

      const cleanup = () => { try { form.remove(); } catch (_) {} try { frame.remove(); } catch (_) {} };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanup();
        this.onRequestState({ active:false, method });
        const timeoutMessage = methodName === 'auth.login'
          ? `Proses masuk membutuhkan waktu lebih lama dari biasanya dan server belum memberi jawaban setelah ${requestTimeoutMs / 1000} detik. Silakan coba kembali.`
          : methodName === 'admin.dataFidelityHealth'
            ? `Pemeriksaan format membutuhkan waktu lebih lama dari biasanya dan belum selesai setelah ${requestTimeoutMs / 1000} detik. Tidak ada perubahan data yang dilakukan.`
            : `Respons server belum diterima setelah ${requestTimeoutMs / 1000} detik. Loading sudah dihentikan pada layar ini. Silakan coba kembali bila diperlukan.`;
        reject(apiError(timeoutMessage, 'REQUEST_TIMEOUT'));
      }, requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer, cleanup, method });
      try {
        form.submit();
        setTimeout(() => { try { form.remove(); } catch (_) {} }, 0);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        cleanup();
        this.onRequestState({ active:false, method });
        reject(apiError(error?.message || 'Gagal mengirim permintaan ke server.', 'REQUEST_SUBMIT_FAILED'));
      }
    });
  }
}

export class PengantaranApi {
  constructor(transport, options = {}) {
    this.transport = transport;
    this.mutations = new Map();
    this.recentMutationIds = new Map();
    this.readRetryCount = Number(options.readRetryCount || 0);
    this.readRetryDelayMs = Number(options.readRetryDelayMs || 700);
    this.mutationReplayWindowMs = Number(options.mutationReplayWindowMs || 120000);
    this.mutationBusyRetryCount = Number(options.mutationBusyRetryCount || 2);
    this.mutationBusyRetryDelayMs = Number(options.mutationBusyRetryDelayMs || 700);
    this.loginRetryCount = Math.max(0, Number(options.loginRetryCount ?? 1));
    this.loginRetryDelayMs = Math.max(0, Number(options.loginRetryDelayMs ?? 650));
  }

  async _read(method, ...args) {
    let attempt = 0;
    while (true) {
      try { return await this.transport.call(method, ...args); }
      catch (error) {
        const retryable = ['REQUEST_TIMEOUT','REQUEST_SUBMIT_FAILED'].includes(String(error?.code || ''));
        if (!retryable || attempt >= this.readRetryCount || !navigator.onLine) throw error;
        attempt += 1;
        await wait(this.readRetryDelayMs * attempt);
      }
    }
  }

  _mutationIdFor(key) {
    const now = Date.now();
    const old = this.recentMutationIds.get(key);
    if (old && old.expiresAt > now) return old.id;
    const id = crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}`;
    this.recentMutationIds.set(key, { id, expiresAt: now + this.mutationReplayWindowMs });
    for (const [itemKey,value] of this.recentMutationIds) if (value.expiresAt <= now) this.recentMutationIds.delete(itemKey);
    return id;
  }

  _mutate(method, ...args) {
    const key = stableKey(method, args);
    if (this.mutations.has(key)) return this.mutations.get(key);
    const mutationId = this._mutationIdFor(key);
    const run = async () => {
      let busyAttempts = 0;
      const operational = /^(pharmacy|courier)\./.test(String(method || ''));
      const retryLimit = operational ? Math.max(5, this.mutationBusyRetryCount) : this.mutationBusyRetryCount;
      while (true) {
        try { return await this.transport.callMutation(method, mutationId, ...args); }
        catch (error) {
          const code = String(error?.code || '');
          const retryable = code === 'REQUEST_IN_PROGRESS' || code === 'SERVER_BUSY';
          if (!retryable || busyAttempts >= retryLimit || !navigator.onLine) throw error;
          busyAttempts += 1;
          const base = code === 'SERVER_BUSY' ? Math.min(900, 320 + (busyAttempts * 110)) : this.mutationBusyRetryDelayMs;
          await wait(base + Math.floor(Math.random() * 120));
        }
      }
    };
    const promise = run().finally(() => this.mutations.delete(key));
    this.mutations.set(key, promise);
    return promise;
  }

  ping() { return this._read('system.ping'); }
  async login(pin, clientInfo) {
    let attempt = 0;
    while (true) {
      try { return await this.transport.call('auth.login', String(pin || ''), clientInfo || {}); }
      catch (error) {
        const retryable = ['REQUEST_TIMEOUT','REQUEST_SUBMIT_FAILED'].includes(String(error?.code || ''));
        if (!retryable || attempt >= this.loginRetryCount || !navigator.onLine) throw error;
        attempt += 1;
        await wait(this.loginRetryDelayMs * attempt);
      }
    }
  }
  session(token) { return this._read('auth.session', String(token || '')); }
  logout(token) { return this._mutate('auth.logout', String(token || '')); }

  farmasiBootstrap(token) { return this._read('pharmacy.bootstrap', String(token || '')); }
  farmasiRows(token, searchText = '') { return this._read('pharmacy.today', String(token || ''), String(searchText || '')); }
  farmasiSnapshot(token) { return this._read('pharmacy.snapshot', String(token || '')); }
  pendingReceiptVerifications(token) { return this._read('pharmacy.receiptQueue', String(token || '')); }
  failedDeliveryFollowUps(token) { return this._read('pharmacy.followUps', String(token || '')); }
  confirmReturnedToFarmasi(token, id) { return this._mutate('pharmacy.confirmReturn', String(token || ''), String(id || '')); }
  failedFollowupWa(token, id) { return this._mutate('pharmacy.followUpWhatsApp', String(token || ''), String(id || '')); }
  planRedelivery(token, id, payload) { return this._mutate('pharmacy.planRedelivery', String(token || ''), String(id || ''), payload || {}); }
  rescheduleDelivery(token, id, payload) { return this._mutate('pharmacy.createRedelivery', String(token || ''), String(id || ''), payload || {}); }
  markSelfPickup(token, id, note = '') { return this._mutate('pharmacy.markSelfPickup', String(token || ''), String(id || ''), String(note || '')); }
  confirmSelfPickup(token, id, note = '') { return this._mutate('pharmacy.confirmSelfPickup', String(token || ''), String(id || ''), String(note || '')); }
  closeFailedDelivery(token, id, note) { return this._mutate('pharmacy.closeCase', String(token || ''), String(id || ''), String(note || '')); }
  refreshFarmasiMaster(token) { return this._read('pharmacy.refreshMaster', String(token || '')); }
  createDelivery(token, payload) { return this._mutate('pharmacy.createDelivery', String(token || ''), payload || {}); }
  updateFarmasiRecord(token, id, payload) { return this._mutate('pharmacy.updateDelivery', String(token || ''), String(id || ''), payload || {}); }
  markReady(token, id) { return this._mutate('pharmacy.markReady', String(token || ''), String(id || '')); }
  registrationWa(token, id) { return this._read('pharmacy.registrationWhatsApp', String(token || ''), String(id || '')); }
  manualReceiptWa(token, id) { return this._read('pharmacy.receiptWhatsApp', String(token || ''), String(id || '')); }
  manualVerifyReceipt(token, id, method, note) { return this._mutate('pharmacy.verifyReceipt', String(token || ''), String(id || ''), String(method || ''), String(note || '')); }
  activeIncidents(token) { return this._read('pharmacy.activeIncidents', String(token || '')); }
  farmasiActiveIncidents(token) { return this.activeIncidents(token); }

  courierBootstrap(token) { return this._read('courier.bootstrap', String(token || '')); }
  courierRows(token) { return this._read('courier.queue', String(token || '')); }
  courierHistory(token, limit = 50) { return this._read('courier.history', String(token || ''), Number(limit || 50)); }
  claimTask(token, id) { return this._mutate('courier.claim', String(token || ''), String(id || '')); }
  completeVerified(token, id, payload) { return this._mutate('courier.complete', String(token || ''), String(id || ''), payload || {}); }
  pendingTask(token, id, payload) { return this._mutate('courier.pending', String(token || ''), String(id || ''), payload || {}); }
  resumeDelivery(token, id) { return this._mutate('courier.resume', String(token || ''), String(id || '')); }
  failTask(token, id, payload) { return this._mutate('courier.fail', String(token || ''), String(id || ''), payload || {}); }
  reportIncident(token, payload) { return this._mutate('courier.reportIncident', String(token || ''), payload || {}); }
  resolveIncident(token, incidentId, note) { return this._mutate('courier.resolveIncident', String(token || ''), String(incidentId || ''), String(note || '')); }

  adminBootstrap(token) { return this._read('admin.bootstrap', String(token || '')); }
  adminRows(token, search = '') { return this._read('admin.search', String(token || ''), String(search || '')); }
  adminUpdateStatus(token, id, status, note = '', adminPin = '') { return this._mutate('admin.correctStatus', String(token || ''), String(id || ''), String(status || ''), String(note || ''), String(adminPin || '')); }
  adminArchiveHealth(token) { return this._read('admin.archiveHealth', String(token || '')); }
  adminResilienceHealth(token) { return this._read('admin.resilienceHealth', String(token || '')); }
  adminDataFidelityHealth(token) { return this._read('admin.dataFidelityHealth', String(token || '')); }
  adminRepairDataFidelity(token, adminPin = '') { return this._mutate('admin.repairDataFidelity', String(token || ''), String(adminPin || '')); }
  adminCleanupLegacyDatabase(token, adminPin = '') { return this._mutate('admin.cleanupLegacyDatabase', String(token || ''), String(adminPin || '')); }
  adminBackupNow(token, note = '') { return this._mutate('admin.backupNow', String(token || ''), String(note || '')); }
  adminPrepareRecovery(token, backupId, adminPin = '') { return this._mutate('admin.prepareRecovery', String(token || ''), String(backupId || ''), String(adminPin || '')); }
  adminRestoreMaster(token, backupId, sheets = [], adminPin = '') { return this._mutate('admin.restoreMaster', String(token || ''), String(backupId || ''), Array.isArray(sheets) ? sheets : [], String(adminPin || '')); }
  adminRestoreMissingSheet(token, sourceId, sheetName, adminPin = '') { return this._mutate('admin.restoreMissingSheet', String(token || ''), String(sourceId || ''), String(sheetName || ''), String(adminPin || '')); }
  adminRestoreSheetStructure(token, sourceId, sheetName, adminPin = '') { return this._mutate('admin.restoreSheetStructure', String(token || ''), String(sourceId || ''), String(sheetName || ''), String(adminPin || '')); }
  adminRestoreSheetContent(token, sourceId, sheetName, adminPin = '') { return this._mutate('admin.restoreSheetContent', String(token || ''), String(sourceId || ''), String(sheetName || ''), String(adminPin || '')); }
  adminCompareMasterCells(token, sourceId, sheetName) { return this._read('admin.compareMasterCells', String(token || ''), String(sourceId || ''), String(sheetName || '')); }
  adminRestoreMasterCells(token, sourceId, sheetName, cells = [], adminPin = '') { return this._mutate('admin.restoreMasterCells', String(token || ''), String(sourceId || ''), String(sheetName || ''), Array.isArray(cells) ? cells : [], String(adminPin || '')); }
  adminRestoreMissingTransactions(token, sourceId, adminPin = '', acknowledged = false) { return this._mutate('admin.restoreMissingTransactions', String(token || ''), String(sourceId || ''), String(adminPin || ''), acknowledged === true); }
  adminEmergencyRestore(token, sourceId, adminPin = '', acknowledged = false) { return this._mutate('admin.emergencyRestore', String(token || ''), String(sourceId || ''), String(adminPin || ''), acknowledged === true); }
  adminRestoreActiveFromTrash(token, adminPin = '') { return this._mutate('admin.restoreActiveFromTrash', String(token || ''), String(adminPin || '')); }
  adminApplyProtections(token, adminPin = '') { return this._mutate('admin.applyProtections', String(token || ''), String(adminPin || '')); }
  adminEnsureBackupSchedule(token, adminPin = '') { return this._mutate('admin.ensureBackupSchedule', String(token || ''), String(adminPin || '')); }
  adminRefreshMaster(token) { return this._read('admin.refreshMaster', String(token || '')); }
  adminAccounts(token) { return this._read('admin.accounts', String(token || '')); }
  adminAccountCreate(token, payload, adminPin = '') { return this._mutate('admin.accountCreate', String(token || ''), payload || {}, String(adminPin || '')); }
  adminAccountUpdate(token, currentEmail, payload, adminPin = '') { return this._mutate('admin.accountUpdate', String(token || ''), String(currentEmail || ''), payload || {}, String(adminPin || '')); }
  adminAccountChangePin(token, email, newPin, adminPin = '') { return this._mutate('admin.accountChangePin', String(token || ''), String(email || ''), String(newPin || ''), String(adminPin || '')); }
  adminAccountSetActive(token, email, active, adminPin = '') { return this._mutate('admin.accountSetActive', String(token || ''), String(email || ''), active === true, String(adminPin || '')); }
  adminAuditRows(token, limit = 100) { return this._read('admin.audit', String(token || ''), Number(limit || 100)); }
  deliveryHistory(token, id) { return this._read('admin.deliveryHistory', String(token || ''), String(id || '')); }

  managementData(token, startDate, endDate, basis = 'DAFTAR', scope = 'HOME', force = false) {
    return this._read('management.dashboard', String(token || ''), String(startDate || ''), String(endDate || ''), String(basis || 'DAFTAR'), String(scope || 'HOME'), force === true);
  }
}
