import { DEPLOYMENT_CONFIG } from './deployment.js?v=1.0.0';

export const APP_CONFIG = Object.freeze({
  appName: 'MELESAT — Pengantaran Obat',
  organization: 'RSUD Provinsi Nusa Tenggara Barat',
  version: '1.0.0',
  apiContract: 'ANTAROBAT-V1',
  backendUrl: String(DEPLOYMENT_CONFIG.backendUrl || '').trim(),
  backendStorageKey: 'antarobat_backend_url',
  sessionStorageKey: 'antarobat_session',
  clientIdStorageKey: 'antarobat_client_id',
  farmasiDraftKey: 'antarobat_farmasi_draft',
  transportTimeoutMs: 25000,
  readRetryCount: 1,
  readRetryDelayMs: 700,
  loginRetryCount: 1,
  loginRetryDelayMs: 650,
  mutationReplayWindowMs: 120000,
  mutationBusyRetryCount: 2,
  mutationBusyRetryDelayMs: 700,
  sessionRecheckMs: 5 * 60 * 1000,
  statsMinimumSample: 10
});
