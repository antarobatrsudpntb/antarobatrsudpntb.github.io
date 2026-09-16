import { Component, ErrorInfo, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Archive, ArrowRight, Bike, Building2, CalendarDays, Check,
  ChevronDown, ChevronRight, ClipboardCheck, Clock3, Edit3, Eye, EyeOff, FileClock, FileText,
  Folder, FolderOpen, History,
  HeartPulse, Home, KeyRound, LayoutDashboard, LoaderCircle, LockKeyhole, LogOut,
  Map, MapPin, Menu, MessageCircle, PackageCheck, PackageOpen, Phone, Plus, Printer,
  RefreshCw, Route, Save, Search, ShieldCheck, Sparkles, TriangleAlert,
  UserCog, Users, WalletCards, Wifi, WifiOff, X,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AppUser, callFunction, clearSession, getStoredSession, isEmulator,
  login, ping, requestId, Role, RealtimeStatus, subscribeWorkspaceSignals,
} from "./lib/backend";

type Row = Record<string, any>;
type Toast = { type: "success" | "error"; message: string } | null;
type WhatsAppDialog = { title: string; actions: Array<{ label?: string; action: Row }>; record?: Row; allowPrint?: boolean } | null;
type OperationalOptions = Record<string, string[]>;

const OPTION_FALLBACKS: OperationalOptions = {
  PENDING_REASONS: ["Penerima belum dapat dihubungi", "Penerima sementara tidak berada di tempat", "Penerima meminta ditunggu/ditunda hari ini", "Alamat/patokan sedang dikonfirmasi", "Akses lokasi sementara terhambat", "Lainnya"],
  FAILURE_REASONS: ["Penerima tidak berada di tempat dan pengantaran tidak dapat dilanjutkan", "Nomor tidak dapat dihubungi setelah upaya", "Alamat tidak ditemukan", "Alamat tidak lengkap/tidak dapat dikonfirmasi", "Pasien/penerima menolak menerima", "Kendala kendaraan/cuaca membuat pengantaran tidak dapat dilanjutkan", "Jalan/lokasi tidak dapat dilalui", "Lainnya"],
  RECEIVER_RELATIONSHIPS: ["Pasien sendiri", "Suami/Istri", "Orang tua", "Anak", "Keluarga lain", "Pengasuh", "Lainnya"],
  NO_CODE_REASONS: ["Pasien tidak menerima pesan", "Nomor WhatsApp tidak aktif", "Penerima tidak mengetahui kode", "Pasien lansia/tidak mampu menggunakan HP", "Kendala teknis", "Lainnya"],
  COURIER_INCIDENT_TYPES: ["Ban bocor", "Hujan lebat", "Mesin bermasalah", "Kecelakaan", "Kemacetan berat", "Lainnya"],
  DELAY_ESTIMATES: ["15 menit", "30 menit", "60 menit", "Tidak dapat melanjutkan"],
  MANUAL_VERIFICATION_METHODS: ["TELEPON", "WHATSAPP", "KONFIRMASI LANGSUNG", "LAINNYA"],
};

function optionsOf(options: OperationalOptions, key: string) {
  return Array.isArray(options[key]) && options[key].length ? options[key] : OPTION_FALLBACKS[key] || [];
}

const STATUS = {
  WAITING: "MENUNGGU DIPROSES", READY: "SIAP DIANTAR", TRANSIT: "DALAM PERJALANAN",
  DELIVERED: "TERKIRIM", FAILED: "GAGAL ANTAR",
};

const roleLabel: Record<Role, string> = {
  FARMASI: "Farmasi", KURIR: "Kurir", ADMIN: "Administrator", MANAJEMEN: "Manajemen",
};

function get(row: Row, ...keys: string[]) {
  for (const key of keys) if (row?.[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  return "";
}

function baseStatusOf(row: Row) { return String(get(row, "status", "Status")); }
function operationalStateOf(row: Row) { return String(get(row, "operationalState", "Status Operasional") || ""); }
function statusOf(row: Row) {
  const explicit = String(get(row, "displayStatus", "Status Tampilan"));
  if (explicit) return explicit;
  const state = operationalStateOf(row);
  const attempt = Math.max(1, Number(get(row, "attemptCount", "Jumlah Percobaan", "attemptNo") || 1));
  if (state === "RETURN_WAITING") return `GAGAL ANTAR #${attempt} • MENUNGGU OBAT KEMBALI`;
  if (state === "FOLLOW_UP") return `GAGAL ANTAR #${attempt} • PERLU TINDAK LANJUT`;
  if (state === "REDELIVERY_PLANNED") return "PENGANTARAN ULANG DIRENCANAKAN";
  if (state === "SELF_PICKUP_WAITING") return "MENUNGGU AMBIL MANDIRI";
  if (state === "PENDING") return "PENDING";
  return baseStatusOf(row);
}
function villageOf(row: Row) { return String(get(row, "villageSnapshot", "village", "Desa/Kelurahan", "Kelurahan", "areaKey") || "Wilayah belum diisi"); }
function deliveryName(row: Row) { return String(get(row, "patientName", "Nama Pasien", "name") || "Pasien"); }
function deliveryCode(row: Row) { return String(get(row, "packageCode", "Kode Paket", "deliveryCode", "ID Sistem", "id") || "—"); }
function systemId(row: Row) { return String(get(row, "deliveryCode", "ID Sistem", "id") || "—"); }
function rowId(row: Row) { return String(get(row, "id", "ID Sistem")); }
function money(value: unknown) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Makassar" }).format(date) + " WITA";
}
function todayKey() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date()); }
function monthStart() { return `${todayKey().slice(0, 7)}-01`; }

function witaTextDateKey(value: unknown) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function plannedDateOf(row: Row) {
  return String(get((row.attempt || {}) as Row, "plannedDate") || get(row, "plannedDate") || "").slice(0, 10);
}

function isTodayPharmacyRow(row: Row, dateKey = todayKey()) {
  const state = operationalStateOf(row);
  const activityDates = [
    String(get(row, "registeredDateKey", "Tanggal Daftar")).slice(0, 10),
    String(get(row, "completedDateKey", "Tanggal Selesai")).slice(0, 10),
    witaTextDateKey(get(row, "Waktu Siap")),
    witaTextDateKey(get(row, "Waktu Diambil")),
    witaTextDateKey(get(row, "Waktu Terkirim")),
    plannedDateOf(row),
  ];
  const unfinished = [STATUS.WAITING, STATUS.READY, STATUS.TRANSIT].includes(baseStatusOf(row)) || state === "RETURN_WAITING";
  return unfinished || activityDates.includes(dateKey);
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] || char));
}

function printLabelWindow(target: Window, record: Row) {
  const fee = Number(get(record, "deliveryFeeSnapshot", "Biaya Pengantaran") || 0);
  const feePolicy = String(get(record, "feePolicySnapshot", "Kebijakan Biaya") || (fee > 0 ? "BERBAYAR" : "GRATIS"));
  const subsidy = Number(get(record, "subsidyAmountSnapshot", "Nilai Subsidi") || 0);
  const baseFee = Number(get(record, "baseDeliveryFeeSnapshot", "Tarif Asli Pengantaran") || fee + subsidy);
  const payment = feePolicy === "SUBSIDI"
    ? `Tarif ${money(baseFee)} • Subsidi ${money(subsidy)} • Pasien ${money(fee)}${fee > 0 ? " (LUNAS DI FARMASI)" : " (DITANGGUNG SUBSIDI)"}`
    : fee > 0 ? `${money(fee)} • LUNAS DI FARMASI` : "GRATIS";
  const address = [get(record, "address", "Alamat Lengkap"), villageOf(record), get(record, "districtSnapshot", "district", "Kecamatan"), get(record, "regencySnapshot", "region", "Kabupaten/Kota")].filter(Boolean).join(", ");
  target.document.open();
  target.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Label ${escapeHtml(deliveryCode(record))}</title><style>
    @page{size:A6 portrait;margin:8mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#082f5f}.label{min-height:132mm;border:2px solid #0a5da8;border-radius:12px;padding:12px;display:flex;flex-direction:column}.head{display:flex;gap:9px;align-items:center;border-bottom:2px solid #dceaf2;padding-bottom:9px}.head img{width:44px;height:44px;object-fit:contain}.head strong,.head span{display:block}.head strong{font-size:14px}.head span{font-size:9px;color:#567184;margin-top:2px}.code{margin:13px 0 10px;font-size:22px;font-weight:900;letter-spacing:.04em}.name{font-size:18px;font-weight:800}.meta{margin:5px 0 12px;color:#456579;font-size:11px}.block{margin-top:9px;padding:9px;border-radius:8px;background:#f1f7fa;font-size:11px;line-height:1.45}.block b{display:block;color:#075ba7;font-size:9px;text-transform:uppercase;letter-spacing:.08em}.payment{border:1px solid #b9ead7;background:#edfbf5;color:#075f45}.payment strong{display:block;font-size:13px}.foot{margin-top:auto;padding-top:10px;border-top:1px dashed #aac2ce;text-align:center;color:#567184;font-size:9px;line-height:1.4}
  </style></head><body><section class="label"><div class="head"><img src="./assets/logo-rsud-ntb.webp"><div><strong>RSUD Provinsi NTB</strong><span>MELESAT • Layanan Pengantaran Obat</span></div></div><div class="code">${escapeHtml(deliveryCode(record))}</div><div class="name">${escapeHtml(deliveryName(record))}</div><div class="meta">No. RM ${escapeHtml(get(record, "rm", "No RM") || "—")} • Penerima: ${escapeHtml(get(record, "recipientName", "Nama Penerima") || deliveryName(record))}</div><div class="block"><b>Alamat tujuan</b>${escapeHtml(address)}</div><div class="block"><b>Patokan lokasi</b>${escapeHtml(get(record, "landmark", "Patokan Lokasi") || "—")}</div><div class="block payment"><b>${escapeHtml(feePolicy)}</b><strong>${escapeHtml(payment)}</strong>${fee > 0 ? "Kurir tidak menerima pembayaran." : feePolicy === "SUBSIDI" ? "Tidak ada tagihan kepada pasien maupun Kurir." : "Pasien tidak dikenakan biaya pengantaran."}</div><div class="foot">ID Sistem ${escapeHtml(systemId(record))}<br>Rahasia pasien • Tidak memuat informasi obat/diagnosis<br>Dicetak ${escapeHtml(new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Makassar" }).format(new Date()))} WITA</div></section><script>setTimeout(()=>window.print(),350)<\/script></body></html>`);
  target.document.close();
}

function useToast() {
  const [toast, setToast] = useState<Toast>(null);
  const show = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4500);
  }, []);
  return { toast, show };
}

function useInteractionGuard(busy: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (busy) root.classList.add("melesat-interaction-busy");
    else root.classList.remove("melesat-interaction-busy");
    return () => root.classList.remove("melesat-interaction-busy");
  }, [busy]);
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand--compact" : ""}`}>
    <img src="./assets/logo-rsud-ntb.webp" alt="Logo RSUD Provinsi NTB" />
    <div><strong>RSUD Provinsi NTB</strong><span>MELESAT • Layanan Pengantaran Obat</span></div>
  </div>;
}

function Badge({ status }: { status: string }) {
  const key = status.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return <span className={`status status--${key}`}>{status || "Belum ada status"}</span>;
}

function Empty({ icon = <PackageOpen />, title, text }: { icon?: ReactNode; title: string; text: string }) {
  return <div className="empty"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div>;
}

function Loading() {
  return <div className="loading"><LoaderCircle className="spin" /><span>Memuat data MELESAT…</span></div>;
}

class ViewBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "Tampilan tidak dapat dimuat." };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MELESAT view error", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="view-error"><span><TriangleAlert /></span><div><h2>Tampilan mengalami kendala</h2><p>{this.state.error}</p><button className="primary-button" onClick={() => window.location.reload()}><RefreshCw /> Muat Ulang</button></div></div>;
  }
}

function ToastView({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return <div className={`toast toast--${toast.type}`}>{toast.type === "success" ? <Check /> : <TriangleAlert />}<span>{toast.message}</span></div>;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Modal({ title, text, children, onClose, wide = false }: { title: string; text?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-layer" role="presentation">
    <button className="modal-backdrop" aria-label="Tutup dialog" onClick={onClose} />
    <section className={`modal-card${wide ? " modal-card--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><div><h2>{title}</h2>{text && <p>{text}</p>}</div><button type="button" className="modal-close" onClick={onClose} aria-label="Tutup"><X /></button></header>
      {children}
    </section>
  </div>;
}

function ConfirmDialog({ title, text, confirmLabel, onConfirm, onClose, busy = false, danger = false, children }: { title: string; text?: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean; danger?: boolean; children?: ReactNode }) {
  return <Modal title={title} text={text} onClose={() => !busy && onClose()}>
    <div className="confirm-body">{children}</div>
    <footer className="modal-actions confirm-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Batal</button><button type="button" className={danger ? "danger-button" : "primary-button"} disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : danger ? <TriangleAlert /> : <Check />}{confirmLabel}</button></footer>
  </Modal>;
}

function WhatsAppResultModal({ dialog, onClose }: { dialog: NonNullable<WhatsAppDialog>; onClose: () => void }) {
  return <Modal title={dialog.title} text={`${dialog.actions.length} pesan siap dibuka. Pesan tidak dikirim otomatis.`} onClose={onClose} wide={dialog.actions.length > 1}>
    <div className="wa-result-list">{dialog.actions.map((item, index) => <article className="wa-result" key={`${item.label || "wa"}-${index}`}>
      {item.label && <strong className="wa-label">{item.label}</strong>}
      <div className="wa-preview">{String(get(item.action, "message") || "Pesan WhatsApp siap.")}</div>
      <div className="modal-actions">
        {dialog.allowPrint && dialog.record && index === 0 && <button className="secondary-button" onClick={() => { const popup = window.open("", "_blank", "width=720,height=820"); if (popup) printLabelWindow(popup, dialog.record!); }}><Printer /> Cetak Label</button>}
        <a className="primary-button" href={String(get(item.action, "url"))} target="_blank" rel="noreferrer"><MessageCircle /> Buka WhatsApp</a>
      </div>
    </article>)}</div>
  </Modal>;
}

function whatsAppDialogFromResult(title: string, result: Row, record?: Row, allowPrint = false): WhatsAppDialog {
  if (result?.waAction) return { title, actions: [{ action: result.waAction as Row }], record, allowPrint };
  const actions = Array.isArray(result?.waActions)
    ? result.waActions.filter((item: Row) => item?.waAction).map((item: Row) => ({ label: [get(item, "id"), get(item, "name")].filter(Boolean).join(" • "), action: item.waAction as Row }))
    : [];
  return actions.length ? { title, actions, record, allowPrint } : null;
}

function PinInput({ value, onChange, placeholder = "4–6 angka", label = "PIN" }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  const [visible, setVisible] = useState(false);
  return <Field label={label}><div className="input-wrap"><LockKeyhole /><input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} type={visible ? "text" : "password"} inputMode="numeric" autoComplete="off" placeholder={placeholder} /><button type="button" className="icon-button" onClick={() => setVisible(!visible)} aria-label={visible ? "Sembunyikan PIN" : "Tampilkan PIN"}>{visible ? <EyeOff /> : <Eye />}</button></div></Field>;
}

function LoginScreen({ onLogin }: { onLogin: (user: AppUser) => void }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const { toast, show } = useToast();

  useEffect(() => { ping().then(() => setHealth("online")).catch(() => setHealth("offline")); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || pin.length < 4) return show("error", "Isi username dan PIN 4–6 angka.");
    setBusy(true);
    try { onLogin(await login(username, pin)); }
    catch (error) { show("error", error instanceof Error ? error.message : "Login gagal."); }
    finally { setBusy(false); }
  }

  return <main className="login-page">
    <section className="login-story">
      <Brand />
      <div className="story-orb story-orb--one" /><div className="story-orb story-orb--two" />
      <div className="hero-wrap">
        <img className="hero-mascot" src="./assets/maskot-melesat.png" alt="Maskot MELESAT membawa obat" />
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles /> MELESAT</span>
          <h1>Istirahat di Rumah,<br /><em>Obat Kami Antar.</em></h1>
          <p>Sistem layanan pengantaran obat yang menghubungkan Farmasi, Kurir, Admin, dan Manajemen RSUD Provinsi NTB.</p>
          <div className="hero-points"><span><ShieldCheck /> Aman & tercatat</span><span><MapPin /> Terarah per wilayah</span></div>
        </div>
      </div>
    </section>
    <section className="login-side">
      <form className="login-card" onSubmit={submit}>
        <div className="mobile-brand"><Brand compact /></div>
        <div className="login-heading"><span className="login-icon"><LockKeyhole /></span><div><h2>Masuk ke MELESAT</h2><p>Gunakan akun dan PIN yang diberikan Admin.</p></div></div>
        <Field label="Username"><div className="input-wrap"><Users /><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="contoh: farmasi01" autoComplete="username" /></div></Field>
        <Field label="PIN"><div className="input-wrap"><LockKeyhole /><input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} type={visible ? "text" : "password"} placeholder="4–6 angka" inputMode="numeric" autoComplete="current-password" /><button type="button" className="icon-button" onClick={() => setVisible(!visible)} aria-label="Tampilkan PIN">{visible ? <EyeOff /> : <Eye />}</button></div></Field>
        <button className="primary-button primary-button--large" disabled={busy}>{busy ? <><LoaderCircle className="spin" /> Memeriksa…</> : <>Masuk <ArrowRight /></>}</button>
        <div className={`connection connection--${health}`}>{health === "online" ? <Wifi /> : health === "offline" ? <WifiOff /> : <LoaderCircle className="spin" />}<span>{health === "online" ? "Aplikasi siap digunakan" : health === "offline" ? "Layanan belum tersambung" : "Memeriksa koneksi…"}</span></div>
        {isEmulator() && <details className="demo-box"><summary>Akun uji Emulator</summary><div><button type="button" onClick={() => { setUsername("farmasi_dev"); setPin("1234"); }}>Farmasi</button><button type="button" onClick={() => { setUsername("kurir_dev"); setPin("2345"); }}>Kurir</button><button type="button" onClick={() => { setUsername("admin_dev"); setPin("3456"); }}>Admin</button><button type="button" onClick={() => { setUsername("manajemen_dev"); setPin("4567"); }}>Manajemen</button></div></details>}
        <p className="help-text">PIN salah atau lupa? Hubungi Administrator MELESAT.</p>
      </form>
      <footer>RSUD Provinsi NTB • Melayani dengan Tulus & Santun</footer>
    </section>
    <ToastView toast={toast} />
  </main>;
}

const navByRole: Record<Role, Array<{ id: string; label: string; icon: ReactNode }>> = {
  FARMASI: [
    { id: "home", label: "Beranda", icon: <Home /> }, { id: "register", label: "Pendaftaran", icon: <Plus /> },
    { id: "today", label: "Hari Ini", icon: <CalendarDays /> }, { id: "verify", label: "Verifikasi", icon: <ClipboardCheck /> },
    { id: "followup", label: "Tindak Lanjut", icon: <History /> },
    { id: "incidents", label: "Kendala Kurir", icon: <TriangleAlert /> },
  ],
  KURIR: [
    { id: "home", label: "Beranda", icon: <Home /> }, { id: "ready", label: "Siap Diambil", icon: <PackageOpen /> },
    { id: "my-tasks", label: "Tugas Saya", icon: <Bike /> }, { id: "history", label: "Riwayat Hari Ini", icon: <History /> },
    { id: "incidents", label: "Kendala", icon: <TriangleAlert /> },
  ],
  ADMIN: [
    { id: "home", label: "Status Layanan", icon: <Activity /> }, { id: "accounts", label: "Akun", icon: <UserCog /> },
    { id: "areas", label: "Master Wilayah", icon: <Map /> }, { id: "transactions", label: "Transaksi", icon: <Search /> },
    { id: "settings", label: "Operasional & WA", icon: <MessageCircle /> }, { id: "archive", label: "Archive & Backup", icon: <Archive /> },
  ],
  MANAJEMEN: [
    { id: "home", label: "Ringkasan", icon: <LayoutDashboard /> }, { id: "performance", label: "Kinerja", icon: <Activity /> },
    { id: "areas", label: "Wilayah", icon: <MapPin /> }, { id: "reports", label: "Laporan", icon: <FileText /> },
  ],
};

function Sidebar({ user, active, setActive, onLogout, badges = {} }: { user: AppUser; active: string; setActive: (id: string) => void; onLogout: () => void; badges?: Record<string, number> }) {
  return <aside className="sidebar">
    <Brand compact />
    <nav>{navByRole[user.role].map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}>{item.icon}<span>{item.label}</span>{Number(badges[item.id] || 0) > 0 && <b className="nav-badge">{badges[item.id] > 99 ? "99+" : badges[item.id]}</b>}{active === item.id && <ChevronRight />}</button>)}</nav>
    <div className="sidebar-bottom"><div className="sidebar-role"><span>{user.name.slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><small>{roleLabel[user.role]}</small></div></div><div className="sidebar-foot"><button onClick={onLogout}><LogOut /> Keluar</button></div></div>
  </aside>;
}

function Topbar({ user, title, onMenu, onRefresh, busy }: { user: AppUser; title: string; onMenu: () => void; onRefresh: () => void; busy: boolean }) {
  return <header className="topbar"><button className="menu-button" onClick={onMenu}><Menu /></button><div><small>{roleLabel[user.role]}</small><h1>{title}</h1></div><div className="topbar-actions"><button className="ghost-button" onClick={onRefresh} disabled={busy}><RefreshCw className={busy ? "spin" : ""} /><span>Perbarui</span></button><div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div></div></header>;
}

function MobileNav({ role, active, setActive, badges = {} }: { role: Role; active: string; setActive: (id: string) => void; badges?: Record<string, number> }) {
  return <nav className="mobile-nav">{navByRole[role].slice(0, 5).map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}>{item.icon}{Number(badges[item.id] || 0) > 0 && <b>{badges[item.id] > 99 ? "99+" : badges[item.id]}</b>}<span>{item.label.split(" ")[0]}</span></button>)}</nav>;
}

function StatCard({ icon, label, value, note, tone = "blue" }: { icon: ReactNode; label: string; value: ReactNode; note?: string; tone?: string }) {
  return <article className={`stat stat--${tone}`}><span className="stat-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong>{note && <p>{note}</p>}</div></article>;
}

function ActionStatCard({ icon, label, value, note, tone = "blue", onClick }: { icon: ReactNode; label: string; value: ReactNode; note?: string; tone?: string; onClick: () => void }) {
  return <button type="button" className={`stat stat-action stat--${tone}`} onClick={onClick}><span className="stat-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong>{note && <p>{note}</p>}</div><ChevronRight /></button>;
}

function SectionTitle({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return <div className="section-title"><div><h2>{title}</h2>{text && <p>{text}</p>}</div>{action}</div>;
}

function DeliveryCard({ row, actions }: { row: Row; actions?: ReactNode }) {
  const links = (row.links || {}) as Row;
  return <article className="delivery-card">
    <div className="delivery-head"><div><small>{deliveryCode(row)}</small><h3>{deliveryName(row)}</h3><em className="system-id">{systemId(row)}</em></div><Badge status={statusOf(row)} /></div>
    <div className="delivery-meta"><span><MapPin /> {villageOf(row)}</span><span><Building2 /> {get(row, "districtSnapshot", "district", "Kecamatan") || "—"}</span><span><Clock3 /> {dateText(get(row, "registeredAt", "Tanggal Daftar"))}</span></div>
    {get(row, "address", "Alamat Lengkap", "Alamat") && <p className="address">{get(row, "address", "Alamat Lengkap", "Alamat")}</p>}
    <div className="delivery-foot"><div className="quick-links">{(links.maps || get(row, "mapsLink", "Link Maps")) && <a href={String(links.maps || get(row, "mapsLink", "Link Maps"))} target="_blank" rel="noreferrer"><MapPin /> Maps</a>}{(links.whatsapp || get(row, "whatsappLink", "Link WhatsApp")) && <a href={String(links.whatsapp || get(row, "whatsappLink", "Link WhatsApp"))} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a>}{(links.phone || get(row, "phoneLink", "Link Telepon")) && <a href={String(links.phone || get(row, "phoneLink", "Link Telepon"))}><Phone /> Telepon</a>}</div>{actions}</div>
  </article>;
}

function TodayDeliveryRow({ row, actions }: { row: Row; actions: ReactNode }) {
  const plannedDate = plannedDateOf(row);
  const timeLabel = operationalStateOf(row) === "REDELIVERY_PLANNED" && plannedDate
    ? `Jadwal ${plannedDate.split("-").reverse().join("/")}`
    : String(get(row, "Jam Daftar") || dateText(get(row, "registeredAt", "Tanggal Daftar")));
  return <article className="today-row">
    <div className="today-time"><strong>{timeLabel}</strong><small>{deliveryCode(row)}</small></div>
    <div className="today-patient"><strong>{deliveryName(row)}</strong><span>No. RM {get(row, "rm", "No RM") || "—"}</span><small>{systemId(row)}</small></div>
    <div className="today-area"><strong>{villageOf(row)}</strong><span>{[get(row, "districtSnapshot", "Kecamatan"), get(row, "regencySnapshot", "Kabupaten/Kota")].filter(Boolean).join(" • ")}</span></div>
    <div className="today-status"><Badge status={statusOf(row)} /></div>
    <div className="today-actions">{actions}</div>
  </article>;
}

function AreaCombobox({ areas, value, onChange }: { areas: Row[]; value: string; onChange: (areaId: string) => void }) {
  const selected = useMemo(() => areas.find(area => String(get(area, "areaId", "id")) === value), [areas, value]);
  const labelOf = useCallback((area: Row) => [get(area, "village"), get(area, "district"), get(area, "regency")].filter(Boolean).join(" • "), []);
  const [query, setQuery] = useState(selected ? labelOf(selected) : "");
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const blurTimer = useRef<number | null>(null);
  const activeAreas = useMemo(() => areas.filter(area => get(area, "coverageStatus") === "AKTIF" && get(area, "active") !== false && get(area, "feePolicy") !== "BELUM DITETAPKAN"), [areas]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("id");
    if (!preview && needle.length < 2) return [];
    return activeAreas
      .filter(area => !needle || labelOf(area).toLocaleLowerCase("id").includes(needle))
      .sort((a, b) => String(get(a, "village")).localeCompare(String(get(b, "village")), "id"))
      .slice(0, 30);
  }, [activeAreas, labelOf, preview, query]);

  useEffect(() => {
    if (selected && (!open || value)) setQuery(labelOf(selected));
    if (!value && !open) setQuery("");
  }, [labelOf, open, selected, value]);

  function select(area: Row) {
    const areaId = String(get(area, "areaId", "id"));
    onChange(areaId); setQuery(labelOf(area)); setOpen(false); setPreview(false); setHighlighted(0);
  }

  return <div className="area-combobox">
    <div className="area-combobox-input"><Search /><input
      role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="area-options"
      value={query} placeholder="Ketik desa, kecamatan, atau kabupaten…"
      onFocus={() => { if (blurTimer.current) window.clearTimeout(blurTimer.current); setOpen(true); }}
      onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 120); }}
      onChange={(event) => { setQuery(event.target.value); setPreview(false); setOpen(true); setHighlighted(0); if (value) onChange(""); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setHighlighted(index => Math.min(index + 1, Math.max(matches.length - 1, 0))); }
        if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted(index => Math.max(index - 1, 0)); }
        if (event.key === "Enter" && open && matches[highlighted]) { event.preventDefault(); select(matches[highlighted]); }
        if (event.key === "Escape") setOpen(false);
      }}
    /><button type="button" aria-label="Buka daftar wilayah aktif" onMouseDown={(event) => event.preventDefault()} onClick={() => { setPreview(true); setOpen(current => !current || !preview); }}><ChevronDown /></button></div>
    {open && <div className="area-options" id="area-options" role="listbox">
      {!preview && query.trim().length < 2 ? <div className="area-option-help"><Search /><span><strong>Ketik minimal 2 huruf</strong><small>Hasil dibatasi 30 agar tetap cepat.</small></span></div> : matches.length ? matches.map((area, index) => <button
        type="button" role="option" aria-selected={String(get(area, "areaId", "id")) === value}
        className={index === highlighted ? "highlighted" : ""} key={String(get(area, "areaId", "id"))}
        onMouseDown={(event) => event.preventDefault()} onClick={() => select(area)}
      ><span><strong>{get(area, "village")}</strong><small>{get(area, "district")} • {get(area, "regency")}</small></span><span><Badge status="AKTIF" /><em>{get(area, "feePolicy") === "GRATIS" ? "GRATIS" : money(get(area, "patientFee"))}</em></span></button>) : <div className="area-option-help"><MapPin /><span><strong>Wilayah aktif tidak ditemukan</strong><small>Coba nama desa, kecamatan, atau kabupaten/kota.</small></span></div>}
    </div>}
  </div>;
}

function SafeQueueCard({ row, actions }: { row: Row; actions: ReactNode }) {
  return <article className="delivery-card safe-queue-card"><div className="delivery-head"><div><small>{deliveryCode(row)}</small><h3>{villageOf(row)}</h3></div><Badge status={statusOf(row)} /></div><div className="delivery-meta"><span><Building2 /> {get(row, "district") || "—"}</span><span><MapPin /> {get(row, "region") || "—"}</span><span><Clock3 /> {get(row, "readyAt") || "Siap sekarang"}</span></div><div className="privacy-lock"><LockKeyhole /><span><strong>Identitas pasien terkunci</strong><small>Nama, RM, alamat, kontak, dan Maps dibuka hanya setelah tugas berhasil diambil.</small></span></div><div className="delivery-foot"><span className="attempt-note">Pengantaran ke-{Number(get(row, "attemptNo") || 1)}</span>{actions}</div></article>;
}

function FarmasiView({ active, data, areas, incidents, operationalOptions, onRefresh, onMutation, navigate, show }: { active: string; data: Row[]; areas: Row[]; incidents: Row[]; operationalOptions: OperationalOptions; onRefresh: () => void; onMutation: (result: Row) => void; navigate: (id: string) => void; show: (type: "success" | "error", message: string) => void }) {
  const [busy, setBusy] = useState(false);
  useInteractionGuard(busy);
  const [manualRows, setManualRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ rm: "", name: "", phone: "", address: "", areaKey: "", landmark: "", recipient: "", courierNote: "", paymentConfirmed: false });
  const [editRecord, setEditRecord] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ rm: "", name: "", phone: "", address: "", areaKey: "", landmark: "", recipient: "", courierNote: "", paymentConfirmed: false });
  const [printAfterSave, setPrintAfterSave] = useState(true);
  const [waDialog, setWaDialog] = useState<WhatsAppDialog>(null);
  const [duplicateDialog, setDuplicateDialog] = useState<{ kind: "register" | "edit"; duplicate: Row; printWindow?: Window | null } | null>(null);
  const [readyRow, setReadyRow] = useState<Row | null>(null);
  const [followupRow, setFollowupRow] = useState<Row | null>(null);
  const [followupDate, setFollowupDate] = useState(todayKey());
  const [followupNote, setFollowupNote] = useState("");
  const [manualRow, setManualRow] = useState<Row | null>(null);
  const [manualMethod, setManualMethod] = useState("WHATSAPP");
  const [manualNote, setManualNote] = useState("Pasien menyatakan obat sudah diterima");
  const selectedArea = useMemo(() => areas.find((area) => String(get(area, "areaId", "id")) === form.areaKey), [areas, form.areaKey]);
  const selectedFee = Number(get(selectedArea || {}, "patientFee") || 0);
  const selectedSubsidy = Number(get(selectedArea || {}, "subsidyAmount") || 0);
  const selectedBaseFee = Number(get(selectedArea || {}, "baseDeliveryFee") || selectedFee + selectedSubsidy);
  const selectedEditArea = useMemo(() => areas.find((area) => String(get(area, "areaId", "id")) === editForm.areaKey), [areas, editForm.areaKey]);
  const selectedEditFee = Number(get(selectedEditArea || {}, "patientFee") || 0);
  const counts = useMemo(() => Object.fromEntries(Object.values(STATUS).map((s) => [s, data.filter((r) => baseStatusOf(r) === s).length])), [data]);
  const waiting = data.filter((r) => baseStatusOf(r) === STATUS.WAITING);
  const failed = data.filter((r) => ["RETURN_WAITING", "FOLLOW_UP", "REDELIVERY_PLANNED", "SELF_PICKUP_WAITING"].includes(operationalStateOf(r)));
  const todayRows = data.filter((row) => isTodayPharmacyRow(row));

  useEffect(() => {
    if (active === "verify") callFunction<{ rows: Row[] }>("getPendingReceiptVerifications").then((r) => setManualRows(r.rows || [])).catch((e) => show("error", e.message));
  }, [active, show]);

  function finishRegistration(result: Row, printWindow: Window | null) {
    const record = (result.record || {}) as Row;
    if (printWindow && Object.keys(record).length) printLabelWindow(printWindow, record); else printWindow?.close();
    setWaDialog(whatsAppDialogFromResult("Pendaftaran berhasil", result, record, true));
    show("success", `Pengantaran ${deliveryCode(record)} berhasil didaftarkan.`);
    setForm({ rm: "", name: "", phone: "", address: "", areaKey: "", landmark: "", recipient: "", courierNote: "", paymentConfirmed: false });
    onMutation(result);
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    if (!selectedArea) return show("error", "Pilih Desa/Kelurahan dari hasil pencarian.");
    if (selectedFee > 0 && !form.paymentConfirmed) return show("error", "Konfirmasi bahwa biaya pengantaran sudah dibayar di Farmasi.");
    const printWindow = printAfterSave ? window.open("", "_blank", "width=720,height=820") : null;
    setBusy(true);
    try {
      let result = await callFunction<Row>("addDelivery", { requestId: requestId("add"), payload: form });
      if (result.requiresDuplicateConfirmation) {
        setDuplicateDialog({ kind: "register", duplicate: (result.duplicate || {}) as Row, printWindow });
        return;
      }
      finishRegistration(result, printWindow);
    } catch (e) { printWindow?.close(); show("error", e instanceof Error ? e.message : "Gagal mendaftarkan."); }
    finally { setBusy(false); }
  }

  async function confirmDuplicate() {
    if (!duplicateDialog) return;
    setBusy(true);
    try {
      if (duplicateDialog.kind === "register") {
        const result = await callFunction<Row>("addDelivery", { requestId: requestId("add_confirm"), payload: { ...form, confirmDuplicate: true } });
        const printWindow = duplicateDialog.printWindow || null;
        setDuplicateDialog(null);
        finishRegistration(result, printWindow);
      } else if (editRecord) {
        const result = await callFunction<Row>("pharmacyUpdateWaitingDelivery", { requestId: requestId("edit_waiting_confirm"), id: rowId(editRecord), payload: { ...editForm, confirmDuplicate: true } });
        setDuplicateDialog(null); setEditRecord(null); show("success", "Pendaftaran berhasil diperbarui setelah konfirmasi duplikasi."); onMutation(result);
      }
    } catch (error) { show("error", error instanceof Error ? error.message : "Konfirmasi duplikasi gagal."); }
    finally { setBusy(false); }
  }
  async function act(name: string, payload: Row, success: string, waTitle = "Pesan WhatsApp siap") {
    setBusy(true); try { const result = await callFunction<Row>(name, payload); setWaDialog(whatsAppDialogFromResult(waTitle, result)); onMutation(result); show("success", success); return result; } catch (e) { show("error", e instanceof Error ? e.message : "Aksi gagal."); return null; } finally { setBusy(false); }
  }

  function openEdit(row: Row) {
    const patientFee = Number(get(row, "deliveryFeeSnapshot", "Biaya Pengantaran") || 0);
    setEditRecord(row);
    setEditForm({
      rm: String(get(row, "rm", "No RM")), name: String(get(row, "patientName", "Nama Pasien")),
      phone: String(get(row, "phone", "No WhatsApp")), address: String(get(row, "address", "Alamat Lengkap")),
      areaKey: String(get(row, "serviceAreaId", "areaKey")), landmark: String(get(row, "landmark", "Patokan Lokasi")),
      recipient: String(get(row, "recipientName", "Nama Penerima")), courierNote: String(get(row, "courierNote", "Catatan Kurir")),
      paymentConfirmed: patientFee <= 0 || String(get(row, "paymentStatusSnapshot", "Status Pembayaran")) === "LUNAS DI FARMASI",
    });
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editRecord || !selectedEditArea) return show("error", "Pilih Desa/Kelurahan dari hasil pencarian.");
    if (selectedEditFee > 0 && !editForm.paymentConfirmed) return show("error", "Konfirmasi biaya sudah diterima di Farmasi.");
    setBusy(true);
    try {
      let result = await callFunction<Row>("pharmacyUpdateWaitingDelivery", { requestId: requestId("edit_waiting"), id: rowId(editRecord), payload: editForm });
      if (result.requiresDuplicateConfirmation) {
        setDuplicateDialog({ kind: "edit", duplicate: (result.duplicate || {}) as Row }); return;
      }
      setEditRecord(null); show("success", "Pendaftaran berhasil diperbarui."); onMutation(result);
    } catch (error) { show("error", error instanceof Error ? error.message : "Perubahan gagal disimpan."); }
    finally { setBusy(false); }
  }
  async function followupAction(name: string, payload: Row, success: string, waTitle?: string, close = true) {
    const result = await act(name, payload, success, waTitle);
    if (result) {
      if (close) setFollowupRow(null);
      else setFollowupRow(current => current ? { ...current, ...(result.record || {}), attempt: result.attempt || current.attempt } : current);
    }
    return result;
  }

  function openFollowup(row: Row) {
    const planned = plannedDateOf(row);
    setFollowupDate(planned >= todayKey() ? planned : todayKey());
    setFollowupNote("");
    setFollowupRow(row);
  }

  async function scheduleRedelivery(row: Row) {
    setBusy(true);
    try {
      const plannedResult = await callFunction<Row>("planRedelivery", { requestId: requestId("plan"), id: rowId(row), payload: { scheduleDate: followupDate } });
      onMutation(plannedResult);
      if (followupDate === todayKey()) {
        const result = await callFunction<Row>("createRedelivery", { requestId: requestId("redelivery"), id: rowId(row), payload: { scheduleDate: followupDate, phone: get(row, "phone", "No WhatsApp"), address: get(row, "address", "Alamat Lengkap"), landmark: get(row, "landmark", "Patokan Lokasi"), recipient: get(row, "recipientName", "Nama Penerima"), areaKey: get(row, "serviceAreaId", "areaKey"), courierNote: get(row, "courierNote", "Catatan Kurir") } });
        onMutation(result);
        setWaDialog(whatsAppDialogFromResult("Pengantaran ulang siap", result));
        show("success", "Pengantaran ke-2 siap masuk antrean Kurir dengan kode penerimaan baru.");
      } else show("success", `Rencana pengantaran ulang disimpan untuk ${followupDate}.`);
      setFollowupRow(null);
    } catch (error) { show("error", error instanceof Error ? error.message : "Pengantaran ulang gagal diproses."); }
    finally { setBusy(false); }
  }

  function printRecord(row: Row) {
    const popup = window.open("", "_blank", "width=720,height=820");
    if (!popup) return show("error", "Browser memblokir jendela cetak. Izinkan pop-up untuk MELESAT.");
    printLabelWindow(popup, row);
  }

  function todayActions(row: Row) {
    const plannedDate = plannedDateOf(row);
    const redeliveryDue = operationalStateOf(row) === "REDELIVERY_PLANNED" && Boolean(plannedDate) && plannedDate <= todayKey();
    return <div className="action-row recovery-actions"><button className="secondary-button small" type="button" onClick={() => printRecord(row)}><Printer /> Cetak Label</button><button className="secondary-button small" type="button" disabled={busy} onClick={() => act("pharmacyRegistrationWaAction", { id: rowId(row) }, "Pesan kode penerimaan disiapkan.", "Kirim ulang kode penerimaan")}><MessageCircle /> WA Kode</button>{baseStatusOf(row) === STATUS.WAITING && <><button className="secondary-button small" type="button" disabled={busy} onClick={() => openEdit(row)}><Edit3 /> Edit</button><button className="primary-button small" type="button" disabled={busy} onClick={() => setReadyRow(row)}><PackageCheck /> Siap Diantar</button></>}{redeliveryDue && <button className="primary-button small" type="button" disabled={busy} onClick={() => openFollowup(row)}><CalendarDays /> Aktifkan Antar Ke-2</button>}</div>;
  }

  const editModal = editRecord ? <Modal wide title={`Edit ${deliveryCode(editRecord)}`} text="Data hanya dapat diubah selama obat masih MENUNGGU DIPROSES. Setiap perubahan dicatat pada audit." onClose={() => !busy && setEditRecord(null)}><form className="modal-form" onSubmit={submitEdit}><div className="form-grid"><Field label="Nomor Rekam Medis"><input required value={editForm.rm} onChange={(e) => setEditForm({ ...editForm, rm: e.target.value })} /></Field><Field label="Nama Pasien"><input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></Field><Field label="Nomor WhatsApp"><input required inputMode="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></Field><Field label="Desa/Kelurahan" hint="Ketik lalu pilih hasil wilayah aktif."><AreaCombobox areas={areas} value={editForm.areaKey} onChange={(areaKey) => setEditForm({ ...editForm, areaKey, paymentConfirmed: false })} /></Field><Field label="Alamat lengkap"><textarea required value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} /></Field><Field label="Patokan"><textarea required value={editForm.landmark} onChange={(e) => setEditForm({ ...editForm, landmark: e.target.value })} /></Field><Field label="Nama calon penerima"><input value={editForm.recipient} onChange={(e) => setEditForm({ ...editForm, recipient: e.target.value })} /></Field><Field label="Catatan untuk Kurir"><input value={editForm.courierNote} onChange={(e) => setEditForm({ ...editForm, courierNote: e.target.value })} /></Field></div>{selectedEditArea && <div className={`registration-fee ${selectedEditFee > 0 ? "registration-fee--paid" : "registration-fee--free"}`}><WalletCards /><div><small>BIAYA PENGANTARAN</small><strong>{get(selectedEditArea, "feePolicy")} • {selectedEditFee > 0 ? money(selectedEditFee) : "GRATIS"}</strong><p>{selectedEditFee > 0 ? "Biaya dibayar di Farmasi; Kurir tidak menerima pembayaran." : "Pasien tidak ditagih oleh Kurir."}</p></div>{selectedEditFee > 0 && <label className="payment-check"><input type="checkbox" checked={editForm.paymentConfirmed} onChange={(e) => setEditForm({ ...editForm, paymentConfirmed: e.target.checked })} /><span>Biaya {money(selectedEditFee)} sudah diterima di Farmasi</span></label>}</div>}<footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditRecord(null)}>Batal</button><button className="primary-button" disabled={busy || (selectedEditFee > 0 && !editForm.paymentConfirmed)}>{busy ? <LoaderCircle className="spin" /> : <Save />} Simpan Perubahan</button></footer></form></Modal> : null;

  const duplicateModal = duplicateDialog ? <ConfirmDialog title="Nomor RM sudah terdaftar hari ini" text="Periksa data aktif berikut sebelum membuat pendaftaran kedua." confirmLabel="Tetap Daftarkan" busy={busy} danger onClose={() => { duplicateDialog.printWindow?.close(); setDuplicateDialog(null); }} onConfirm={confirmDuplicate}>
    <div className="duplicate-summary"><TriangleAlert /><div><strong>{get(duplicateDialog.duplicate, "packageCode", "Kode Paket", "id") || "Paket aktif"}</strong><p>{get(duplicateDialog.duplicate, "name") || "Pasien"} • {get(duplicateDialog.duplicate, "status") || "Status aktif"}</p><small>{get(duplicateDialog.duplicate, "registeredAt") || "Hari ini"} • {[get(duplicateDialog.duplicate, "village"), get(duplicateDialog.duplicate, "district"), get(duplicateDialog.duplicate, "region")].filter(Boolean).join(" • ")}</small></div></div>
  </ConfirmDialog> : null;

  const readyModal = readyRow ? <ConfirmDialog title="Tandai obat siap diantar?" text={`Paket ${deliveryCode(readyRow)} • ${deliveryName(readyRow)}`} confirmLabel="Ya, Siap Diantar" busy={busy} onClose={() => setReadyRow(null)} onConfirm={async () => { const result = await act("markReady", { requestId: requestId("ready"), id: rowId(readyRow) }, "Obat masuk antrean Kurir."); if (result) setReadyRow(null); }}>
    <div className="confirm-note"><PackageCheck /><p>Pastikan obat telah selesai, benar, berlabel, dan siap diserahkan kepada Kurir.</p></div>
  </ConfirmDialog> : null;

  const followupModal = followupRow ? (() => {
    const state = operationalStateOf(followupRow);
    const attempt = (followupRow.attempt || {}) as Row;
    const attemptNo = Number(get(attempt, "attemptNo") || get(followupRow, "Jumlah Percobaan") || 1);
    const waDone = Boolean(get(attempt, "followupWaAt"));
    return <Modal wide title={`Tindak lanjut ${deliveryCode(followupRow)}`} text={`Gagal antar ke-${attemptNo} • ${deliveryName(followupRow)}`} onClose={() => !busy && setFollowupRow(null)}>
      <div className="modal-form followup-form"><div className="failure-summary"><TriangleAlert /><div><strong>{get(attempt, "failureReason") || get(followupRow, "Alasan Gagal") || "Gagal antar"}</strong><p>{get(attempt, "failureDetail") || get(followupRow, "Catatan Gagal") || "Tanpa catatan tambahan"}</p></div></div>
      {state === "RETURN_WAITING" && <><div className="confirm-note warning"><PackageOpen /><p>Kurir sudah melaporkan gagal antar. Konfirmasi hanya setelah obat fisik benar-benar diterima kembali di Farmasi.</p></div><button className="primary-button" disabled={busy} onClick={() => followupAction("confirmReturnToPharmacy", { requestId: requestId("return"), id: rowId(followupRow) }, "Obat kembali ke Farmasi telah dikonfirmasi.")}><PackageCheck /> Konfirmasi Obat Sudah Kembali</button></>}
      {["FOLLOW_UP", "REDELIVERY_PLANNED"].includes(state) && <><div className="followup-steps"><button className="secondary-button" disabled={busy} onClick={() => followupAction("failedFollowUpWhatsApp", { requestId: requestId("followup"), id: rowId(followupRow) }, "Pesan tindak lanjut siap dibuka.", "Tindak lanjut gagal antar", false)}><MessageCircle /> {waDone ? "Buka Ulang WA Tindak Lanjut" : "1. Siapkan WA Tindak Lanjut"}</button>{attemptNo < 2 && <div className="followup-schedule"><Field label="Tanggal pengantaran ulang" hint="Jika hari ini, paket langsung masuk antrean Kurir. Jika tanggal lain, rencana disimpan dahulu."><input type="date" min={todayKey()} value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} /></Field><button className="primary-button" disabled={busy || !waDone || !followupDate} onClick={() => scheduleRedelivery(followupRow)}><CalendarDays /> 2. Simpan Pengantaran Ulang</button></div>}</div><Field label="Catatan keputusan (opsional)"><textarea value={followupNote} onChange={(e) => setFollowupNote(e.target.value)} placeholder="Contoh: pasien memilih ambil di loket" /></Field><div className="modal-actions inline-actions"><button className="secondary-button" disabled={busy || !waDone} onClick={() => followupAction("markSelfPickup", { requestId: requestId("pickup"), id: rowId(followupRow), note: followupNote || "Pasien memilih mengambil obat secara mandiri di Farmasi." }, "Pasien diarahkan untuk ambil mandiri.")}><Home /> Tetapkan Ambil Mandiri</button>{attemptNo < 2 && <button className="danger-button" disabled={busy || !waDone || !followupNote.trim()} onClick={() => followupAction("closeFailedCase", { requestId: requestId("close"), id: rowId(followupRow), note: followupNote }, "Kasus gagal antar ditutup.")}><X /> Tutup Layanan</button>}</div></>}
      {state === "SELF_PICKUP_WAITING" && <><div className="confirm-note"><Home /><p>Kasus menunggu pengambilan mandiri di Loket Farmasi. Tutup hanya setelah obat benar-benar diserahkan.</p></div><Field label="Catatan penyerahan"><textarea value={followupNote} onChange={(e) => setFollowupNote(e.target.value)} placeholder="Nama penerima/waktu penyerahan singkat" /></Field><button className="primary-button" disabled={busy} onClick={() => followupAction("confirmSelfPickup", { requestId: requestId("pickup_done"), id: rowId(followupRow), note: followupNote || "Obat telah diambil mandiri di Loket Farmasi." }, "Pengambilan mandiri dikonfirmasi; kasus selesai.")}><Check /> Konfirmasi Obat Sudah Diambil</button></>}
      </div>
    </Modal>;
  })() : null;

  const manualModal = manualRow ? <Modal title={`Verifikasi ${deliveryCode(manualRow)}`} text={deliveryName(manualRow)} onClose={() => !busy && setManualRow(null)}><form className="modal-form" onSubmit={async (event) => { event.preventDefault(); const currentId = rowId(manualRow); const result = await act("manualVerifyReceipt", { requestId: requestId("manual"), id: currentId, method: manualMethod, note: manualNote }, "Penerimaan terverifikasi manual."); if (result) { setManualRows(rows => rows.filter(row => rowId(row) !== currentId)); setManualRow(null); } }}><Field label="Metode verifikasi"><select value={manualMethod} onChange={(e) => setManualMethod(e.target.value)}>{optionsOf(operationalOptions, "MANUAL_VERIFICATION_METHODS").map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Catatan verifikasi"><textarea required value={manualNote} onChange={(e) => setManualNote(e.target.value)} /></Field><footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setManualRow(null)}>Batal</button><button className="primary-button" disabled={busy}><ClipboardCheck /> Simpan Verifikasi</button></footer></form></Modal> : null;

  if (active === "register") return <div className="content-stack"><SectionTitle title="Daftar Pengantaran" text="Isi data minimum yang dibutuhkan Kurir. Informasi obat tidak dicantumkan." />
    <form className="form-card" onSubmit={register}><div className="form-grid">
      <Field label="Nomor Rekam Medis"><input required value={form.rm} onChange={(e) => setForm({ ...form, rm: e.target.value })} placeholder="Contoh: 00123456" /></Field>
      <Field label="Nama Pasien"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama lengkap" /></Field>
      <Field label="Nomor WhatsApp"><input required inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></Field>
      <Field label="Desa/Kelurahan" hint="Ketik nama desa, kecamatan, atau kabupaten/kota; lalu pilih hasilnya."><AreaCombobox areas={areas} value={form.areaKey} onChange={(areaKey) => setForm({ ...form, areaKey, paymentConfirmed: false })} /></Field>
      <Field label="Alamat lengkap"><textarea required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, lingkungan/dusun" /></Field>
      <Field label="Patokan"><textarea required value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} placeholder="Patokan yang mudah dikenali" /></Field>
      <Field label="Nama calon penerima"><input value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} placeholder="Opsional" /></Field>
      <Field label="Catatan untuk Kurir"><input value={form.courierNote} onChange={(e) => setForm({ ...form, courierNote: e.target.value })} placeholder="Opsional, tanpa data klinis" /></Field>
    </div>{selectedArea && <div className={`registration-fee ${selectedFee > 0 ? "registration-fee--paid" : "registration-fee--free"}`}><WalletCards /><div><small>BIAYA PENGANTARAN</small><strong>{get(selectedArea, "feePolicy")} • {get(selectedArea, "feePolicy") === "SUBSIDI" ? `Tarif ${money(selectedBaseFee)} − subsidi ${money(selectedSubsidy)} = ${money(selectedFee)}` : selectedFee > 0 ? money(selectedFee) : "GRATIS"}</strong><p>{selectedFee > 0 ? "Biaya setelah subsidi/tarif dibayar langsung di Farmasi. Kurir tidak menerima pembayaran." : get(selectedArea, "feePolicy") === "SUBSIDI" ? "Biaya pasien ditanggung penuh subsidi; Kurir tidak menerima pembayaran." : "Pasien tidak dikenakan biaya pengantaran."}</p></div>{selectedFee > 0 && <label className="payment-check"><input type="checkbox" checked={form.paymentConfirmed} onChange={(e) => setForm({ ...form, paymentConfirmed: e.target.checked })} /><span>Biaya {money(selectedFee)} sudah diterima di Farmasi</span></label>}</div>}
    <div className="registration-options"><label><input type="checkbox" checked={printAfterSave} onChange={(e) => setPrintAfterSave(e.target.checked)} /><span>Cetak label A6 setelah disimpan</span></label></div>
    <div className="form-summary"><ShieldCheck /><div><strong>Privasi pasien dijaga</strong><p>Detail klinis dan nama obat tidak dikirim ke tampilan Kurir.</p></div><button className="primary-button" disabled={busy || (selectedFee > 0 && !form.paymentConfirmed)}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Daftarkan</button></div></form>
    {duplicateModal}{waDialog && <WhatsAppResultModal dialog={waDialog} onClose={() => setWaDialog(null)} />}
  </div>;

  if (active === "today") return <div className="content-stack"><SectionTitle title="Pengantaran Hari Ini" text="Daftar ringkas berurutan ke bawah: cetak ulang label, kirim ulang WA kode, edit data menunggu, dan tandai obat siap." />{todayRows.length ? <div className="today-list">{todayRows.map((row) => <TodayDeliveryRow key={rowId(row)} row={row} actions={todayActions(row)} />)}</div> : <Empty icon={<CalendarDays />} title="Belum ada pengantaran hari ini" text="Data pendaftaran hari ini dan pekerjaan aktif akan muncul di sini." />}{editModal}{duplicateModal}{readyModal}{waDialog && <WhatsAppResultModal dialog={waDialog} onClose={() => setWaDialog(null)} />}</div>;

  if (active === "followup") return <div className="content-stack"><SectionTitle title="Tindak Lanjut Gagal Antar" text="Maksimal dua kali pengantaran ke rumah. Rencana tetap di sini sampai Farmasi mengaktifkan pengantaran ulang pada tanggal jadwal." />{failed.length ? <div className="today-list">{failed.map((row) => <TodayDeliveryRow key={rowId(row)} row={row} actions={<button className="secondary-button small" disabled={busy} onClick={() => openFollowup(row)}><History /> Kelola Tindak Lanjut</button>} />)}</div> : <Empty icon={<ShieldCheck />} title="Tidak ada tindak lanjut" text="Kasus gagal antar yang masih perlu keputusan Farmasi akan muncul di sini." />}{followupModal}{waDialog && <WhatsAppResultModal dialog={waDialog} onClose={() => setWaDialog(null)} />}</div>;

  if (active === "verify") return <div className="content-stack"><SectionTitle title="Verifikasi Penerimaan" text="Kirim konfirmasi WhatsApp terlebih dahulu, lalu catat verifikasi setelah pasien/penerima menyatakan obat sudah diterima." />{manualRows.length ? <div className="today-list">{manualRows.map((row) => <TodayDeliveryRow key={rowId(row)} row={row} actions={<div className="action-row"><button className="secondary-button small" disabled={busy} onClick={() => act("getManualReceiptConfirmationWaAction", { id: rowId(row) }, "Pesan konfirmasi disiapkan.", "Konfirmasi penerimaan")}><MessageCircle /> Siapkan WA</button><button className="primary-button small" disabled={busy} onClick={() => { setManualMethod(optionsOf(operationalOptions, "MANUAL_VERIFICATION_METHODS")[0] || "WHATSAPP"); setManualNote("Pasien menyatakan obat sudah diterima"); setManualRow(row); }}><ClipboardCheck /> Sudah Dikonfirmasi</button></div>} />)}</div> : <Empty icon={<ClipboardCheck />} title="Antrean verifikasi kosong" text="Pengantaran tanpa kode akan muncul di sini." />}{manualModal}{waDialog && <WhatsAppResultModal dialog={waDialog} onClose={() => setWaDialog(null)} />}</div>;

  if (active === "incidents") return <div className="content-stack"><SectionTitle title="Kendala Kurir Aktif" text="Pantau area dan paket terdampak sebelum menindaklanjuti pasien." />{incidents.length ? <div className="incident-list">{incidents.map((row) => <article className="incident-card" key={rowId(row)}><span><TriangleAlert /></span><div><small>{get(row, "courier", "courierName")}</small><h3>{get(row, "type")}</h3><p>{get(row, "detail")}</p><div><Badge status={String(get(row, "verificationStatus"))} /><em>{get(row, "affectedCount")} paket • {get(row, "delayEstimate")}</em></div></div></article>)}</div> : <Empty icon={<ShieldCheck />} title="Tidak ada kendala aktif" text="Seluruh Kurir dapat melanjutkan pengantaran." />}{waDialog && <WhatsAppResultModal dialog={waDialog} onClose={() => setWaDialog(null)} />}</div>;

  return <div className="content-stack"><section className="welcome-banner"><div><span className="eyebrow">RUANG KERJA FARMASI</span><h2>Operasional hari ini, dalam satu kendali.</h2><p>Pendaftaran, kesiapan obat, label, kode pasien, dan verifikasi tersambung dalam satu alur.</p><button className="light-button" onClick={() => navigate("register")}><Plus /> Daftarkan Pengantaran</button></div><img src="./assets/maskot-melesat.png" alt="Maskot MELESAT" /></section>
    <div className="stats-grid"><ActionStatCard icon={<FileClock />} label="Menunggu diproses" value={counts[STATUS.WAITING] || 0} note="Buka pekerjaan hari ini" tone="orange" onClick={() => navigate("today")} /><ActionStatCard icon={<PackageCheck />} label="Siap diantar" value={counts[STATUS.READY] || 0} note="Pantau antrean Kurir" onClick={() => navigate("today")} /><ActionStatCard icon={<Bike />} label="Dalam perjalanan" value={counts[STATUS.TRANSIT] || 0} note="Sedang ditangani Kurir" tone="purple" onClick={() => navigate("today")} /><ActionStatCard icon={<ClipboardCheck />} label="Terkirim" value={counts[STATUS.DELIVERED] || 0} note="Cek verifikasi penerimaan" tone="green" onClick={() => navigate("verify")} /></div>
    <SectionTitle title="Perlu Tindakan" text="Pesan operasional yang memerlukan perhatian petugas." />
    <div className="attention-grid"><button onClick={() => navigate("today")}><span><CalendarDays /></span><div><strong>{todayRows.length} pengantaran dipantau hari ini</strong><small>Cetak label, kirim ulang kode, atau tandai obat siap.</small></div><ChevronRight /></button><button className={failed.length ? "attention-danger" : ""} onClick={() => navigate("followup")}><span><History /></span><div><strong>{failed.length} gagal antar perlu tindak lanjut</strong><small>Kelola obat kembali, antar ulang, atau ambil mandiri.</small></div><ChevronRight /></button><button onClick={() => navigate("verify")}><span><ClipboardCheck /></span><div><strong>Buka verifikasi manual</strong><small>Pastikan penyerahan tanpa kode tetap terkonfirmasi.</small></div><ChevronRight /></button><button className={incidents.length ? "attention-danger" : ""} onClick={() => navigate("incidents")}><span><TriangleAlert /></span><div><strong>{incidents.length} kendala Kurir aktif</strong><small>Pantau dampak dan komunikasi kepada pasien.</small></div><ChevronRight /></button></div>
    <SectionTitle title="Aktivitas terbaru" text="Status pengantaran yang paling baru diperbarui." />{data.length ? <div className="cards-grid">{data.slice(0, 6).map((row) => <DeliveryCard key={rowId(row)} row={row} />)}</div> : <Empty title="Belum ada transaksi" text="Mulai dengan mendaftarkan pengantaran pasien." />}</div>;
}

function KurirView({ active, data, user, incident, operationalOptions, onRefresh, onMutation, navigate, show }: { active: string; data: Row[]; user: AppUser; incident: Row | null; operationalOptions: OperationalOptions; onRefresh: () => void; onMutation: (result: Row) => void; navigate: (id: string) => void; show: (type: "success" | "error", message: string) => void }) {
  const [busy, setBusy] = useState(false);
  useInteractionGuard(busy);
  const [waDialog, setWaDialog] = useState<WhatsAppDialog>(null);
  const [claimRow, setClaimRow] = useState<Row | null>(null);
  const [pendingRow, setPendingRow] = useState<Row | null>(null);
  const [pendingReason, setPendingReason] = useState("");
  const [pendingDetail, setPendingDetail] = useState("");
  const [failureRow, setFailureRow] = useState<Row | null>(null);
  const [failureReason, setFailureReason] = useState("");
  const [failureDetail, setFailureDetail] = useState("");
  const [completeRow, setCompleteRow] = useState<Row | null>(null);
  const [completeForm, setCompleteForm] = useState({ recipientName: "", relationship: "", mode: "CODE", code: "", noCodeReason: "" });
  const [completeError, setCompleteError] = useState("");
  const [resolveDialog, setResolveDialog] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const ready = data.filter((row) => baseStatusOf(row) === STATUS.READY);
  const mine = data.filter((row) => baseStatusOf(row) === STATUS.TRANSIT);
  const historyRows = data.filter((row) => [STATUS.DELIVERED, STATUS.FAILED].includes(baseStatusOf(row)));
  const grouped = Object.entries(Object.groupBy(ready, row => [get(row, "region"), get(row, "district"), villageOf(row)].filter(Boolean).join(" • ")));
  async function act(name: string, payload: Row, success: string, waTitle = "Pesan pasien siap") {
    setBusy(true);
    try {
      const result = await callFunction<Row>(name, payload);
      if (result.codeInvalid || result.codeLocked) {
        const message = String(result.backendMessage || "Kode penerimaan tidak valid.");
        setCompleteError(message); show("error", message); return result;
      }
      setWaDialog(whatsAppDialogFromResult(waTitle, result));
      onMutation(result); show("success", success); return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Aksi gagal.";
      setCompleteError(message); show("error", message); return null;
    }
    finally { setBusy(false); }
  }

  function openPending(row: Row) {
    setPendingReason(optionsOf(operationalOptions, "PENDING_REASONS")[0] || "");
    setPendingDetail(""); setPendingRow(row);
  }
  function openFailure(row: Row) {
    setFailureReason(optionsOf(operationalOptions, "FAILURE_REASONS")[0] || "");
    setFailureDetail(""); setFailureRow(row);
  }
  function openComplete(row: Row) {
    setCompleteError("");
    setCompleteForm({
      recipientName: String(get(row, "recipientName", "Nama Penerima") || deliveryName(row)),
      relationship: optionsOf(operationalOptions, "RECEIVER_RELATIONSHIPS")[0] || "",
      mode: "CODE", code: "",
      noCodeReason: optionsOf(operationalOptions, "NO_CODE_REASONS")[0] || "",
    });
    setCompleteRow(row);
  }
  async function submitComplete(event: FormEvent) {
    event.preventDefault();
    if (!completeRow) return;
    setCompleteError("");
    const result = await act(
      "completeTaskVerified",
      { requestId: requestId("complete"), id: rowId(completeRow), payload: completeForm },
      completeForm.mode === "CODE" ? "Pengantaran selesai dan kode terverifikasi." : "Penyerahan dicatat; Farmasi akan melakukan verifikasi manual.",
      completeForm.mode === "CODE" ? "Konfirmasi obat diterima" : "Konfirmasi tanpa kode",
    );
    if (result && !result.codeInvalid && !result.codeLocked) setCompleteRow(null);
    else if (result?.codeLocked) setCompleteForm(current => ({ ...current, mode: "NO_CODE", code: "" }));
  }
  function taskActions(row: Row) {
    const state = operationalStateOf(row) || "ACTIVE";
    const failButton = <button className="danger-button small" disabled={busy} onClick={() => openFailure(row)}><TriangleAlert /> Gagal</button>;
    if (state === "PENDING") return <div className="action-row"><button className="primary-button small" disabled={busy} onClick={() => act("resumeDelivery", { requestId: requestId("resume"), id: rowId(row) }, "Pengantaran dilanjutkan.")}><Bike /> Lanjut Antar</button>{failButton}</div>;
    if (state === "RETURN_WAITING") return <div className="task-state-note"><TriangleAlert /><span>Gagal antar sudah dilaporkan. Kembalikan obat fisik ke Farmasi.</span></div>;
    return <div className="action-row"><button className="secondary-button small" disabled={busy} onClick={() => openPending(row)}><Clock3 /> Pending</button>{failButton}<button className="primary-button small" disabled={busy} onClick={() => openComplete(row)}><Check /> Selesaikan</button></div>;
  }

  const claimModal = claimRow ? <ConfirmDialog
    title="Ambil tugas pengantaran?"
    text={"Paket " + deliveryCode(claimRow) + " • " + villageOf(claimRow)}
    confirmLabel="Ya, Ambil Tugas"
    busy={busy}
    onClose={() => setClaimRow(null)}
    onConfirm={async () => {
      const result = await act("claimTask", { requestId: requestId("claim"), id: rowId(claimRow) }, "Tugas berhasil diambil. Detail tujuan kini terbuka di Tugas Saya.", "Pemberitahuan mulai diantar");
      if (result) setClaimRow(null);
    }}
  ><div className="confirm-note"><Bike /><p>Pastikan kode paket pada aplikasi sama dengan label fisik. Nama, RM, kontak, alamat, dan Maps baru dibuka setelah klaim berhasil.</p></div></ConfirmDialog> : null;

  const pendingModal = pendingRow ? <Modal title="Pending Pengantaran" text={deliveryCode(pendingRow) + " • " + deliveryName(pendingRow)} onClose={() => !busy && setPendingRow(null)}>
    <form className="modal-form" onSubmit={async (event) => {
      event.preventDefault();
      const result = await act("setDeliveryPending", { requestId: requestId("pending"), id: rowId(pendingRow), payload: { reason: pendingReason, detail: pendingDetail } }, "Pengantaran ditandai pending; paket tetap dibawa Kurir.", "Pemberitahuan pending");
      if (result) setPendingRow(null);
    }}>
      <div className="confirm-note warning"><Clock3 /><p>Gunakan bila pengantaran masih mungkin dilanjutkan hari ini. Status dapat dibuka kembali dengan tombol Lanjut Antar.</p></div>
      <Field label="Alasan pending"><select required value={pendingReason} onChange={(event) => setPendingReason(event.target.value)}>{optionsOf(operationalOptions, "PENDING_REASONS").map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Catatan tambahan (opsional)"><textarea value={pendingDetail} onChange={(event) => setPendingDetail(event.target.value)} placeholder="Keterangan singkat bila diperlukan" /></Field>
      <footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setPendingRow(null)}>Batal</button><button className="warning-button" disabled={busy || !pendingReason}><Clock3 /> Simpan Pending & Siapkan WA</button></footer>
    </form>
  </Modal> : null;

  const failureModal = failureRow ? <Modal title="Catat Gagal Antar" text={deliveryCode(failureRow) + " • " + deliveryName(failureRow)} onClose={() => !busy && setFailureRow(null)}>
    <form className="modal-form" onSubmit={async (event) => {
      event.preventDefault();
      const result = await act("failDelivery", { requestId: requestId("failed"), id: rowId(failureRow), payload: { reason: failureReason, detail: failureDetail } }, "Gagal antar dicatat; obat wajib dikembalikan ke Farmasi.", "Pemberitahuan gagal antar");
      if (result) setFailureRow(null);
    }}>
      <div className="confirm-note warning"><TriangleAlert /><p>Gunakan bila pengantaran hari ini tidak dapat dilanjutkan. Setelah disimpan, paket wajib dikembalikan dan dikonfirmasi Farmasi.</p></div>
      <Field label="Alasan gagal"><select required value={failureReason} onChange={(event) => setFailureReason(event.target.value)}>{optionsOf(operationalOptions, "FAILURE_REASONS").map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Catatan tambahan (opsional)"><textarea value={failureDetail} onChange={(event) => setFailureDetail(event.target.value)} placeholder="Keterangan singkat bila diperlukan" /></Field>
      <footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setFailureRow(null)}>Batal</button><button className="danger-button" disabled={busy || !failureReason}><TriangleAlert /> Simpan Gagal Antar & Siapkan WA</button></footer>
    </form>
  </Modal> : null;

  const completionModal = completeRow ? <Modal wide title="Selesaikan Pengantaran" text={deliveryCode(completeRow) + " • " + deliveryName(completeRow)} onClose={() => !busy && setCompleteRow(null)}>
    <form className="modal-form" onSubmit={submitComplete}>
      <div className="confirm-note warning"><ShieldCheck /><p>Minta kode penerimaan hanya setelah obat benar-benar berada di tangan pasien/penerima.</p></div>
      <div className="form-grid">
        <Field label="Nama penerima aktual"><input required value={completeForm.recipientName} onChange={(event) => setCompleteForm({ ...completeForm, recipientName: event.target.value })} /></Field>
        <Field label="Hubungan penerima"><select required value={completeForm.relationship} onChange={(event) => setCompleteForm({ ...completeForm, relationship: event.target.value })}>{optionsOf(operationalOptions, "RECEIVER_RELATIONSHIPS").map(value => <option key={value}>{value}</option>)}</select></Field>
      </div>
      <div className="choice-cards">
        <label className={completeForm.mode === "CODE" ? "selected" : ""}><input type="radio" name="completeMode" value="CODE" checked={completeForm.mode === "CODE"} onChange={() => { setCompleteError(""); setCompleteForm({ ...completeForm, mode: "CODE" }); }} /><span><strong>Dengan kode</strong><small>Verifikasi langsung selesai</small></span></label>
        <label className={completeForm.mode === "NO_CODE" ? "selected" : ""}><input type="radio" name="completeMode" value="NO_CODE" checked={completeForm.mode === "NO_CODE"} onChange={() => { setCompleteError(""); setCompleteForm({ ...completeForm, mode: "NO_CODE", code: "" }); }} /><span><strong>Tanpa kode</strong><small>Masuk verifikasi manual Farmasi</small></span></label>
      </div>
      {completeForm.mode === "CODE"
        ? <Field label="Kode penerimaan 4 digit"><input className="receipt-code" required inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={completeForm.code} onChange={(event) => setCompleteForm({ ...completeForm, code: event.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="••••" /></Field>
        : <Field label="Alasan tanpa kode"><select required value={completeForm.noCodeReason} onChange={(event) => setCompleteForm({ ...completeForm, noCodeReason: event.target.value })}>{optionsOf(operationalOptions, "NO_CODE_REASONS").map(value => <option key={value}>{value}</option>)}</select></Field>}
      {completeError && <div className="inline-error"><TriangleAlert />{completeError}</div>}
      <footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setCompleteRow(null)}>Batal</button><button className="primary-button" disabled={busy || !completeForm.recipientName || !completeForm.relationship || (completeForm.mode === "CODE" ? completeForm.code.length !== 4 : !completeForm.noCodeReason)}><Check /> Simpan Pengantaran</button></footer>
    </form>
  </Modal> : null;

  const resolveModal = resolveDialog && incident ? <Modal title="Selesaikan Kendala" text={String(get(incident, "type")) + " • laporan " + user.name} onClose={() => !busy && setResolveDialog(false)}>
    <form className="modal-form" onSubmit={async (event) => {
      event.preventDefault();
      const result = await act("resolveCourierIncident", { requestId: requestId("resolve"), incidentId: rowId(incident), resolutionNote }, "Kendala selesai.");
      if (result) { setResolveDialog(false); setResolutionNote(""); }
    }}>
      <Field label="Catatan penyelesaian"><textarea required value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Contoh: ban sudah diganti, perjalanan dilanjutkan" /></Field>
      <footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setResolveDialog(false)}>Batal</button><button className="primary-button" disabled={busy || !resolutionNote.trim()}><Check /> Selesaikan Kendala</button></footer>
    </form>
  </Modal> : null;

  const actionModals = <>{claimModal}{pendingModal}{failureModal}{completionModal}{resolveModal}{waDialog && <WhatsAppResultModal dialog={waDialog} onClose={() => setWaDialog(null)} />}</>;
  if (active === "my-tasks") return <div className="content-stack"><SectionTitle title="Pengantaran Saya" text="Buka Maps untuk tujuan spesifik pasien. Selesaikan setiap paket secara individual." />{mine.length ? <div className="cards-grid">{mine.map((row) => <DeliveryCard key={rowId(row)} row={row} actions={taskActions(row)} />)}</div> : <Empty icon={<Bike />} title="Belum ada tugas aktif" text="Ambil paket siap diantar dari daftar tugas." />}{actionModals}</div>;
  if (active === "history") return <div className="content-stack"><SectionTitle title="Riwayat Hari Ini" text="Paket yang selesai atau gagal pada hari operasional ini." />{historyRows.length ? <div className="cards-grid">{historyRows.map((row) => <DeliveryCard key={rowId(row)} row={row} />)}</div> : <Empty icon={<History />} title="Riwayat hari ini masih kosong" text="Tugas yang selesai atau gagal akan tercatat otomatis di sini." />}{actionModals}</div>;
  if (active === "incidents") return <div className="content-stack"><SectionTitle title="Kendala Perjalanan" text="Satu Kurir hanya boleh memiliki satu kendala aktif." />{incident ? <article className="incident-focus"><span className="incident-visual"><TriangleAlert /></span><div><small>KENDALA AKTIF</small><h2>{get(incident, "type")}</h2><p>{get(incident, "detail")}</p><Badge status={String(get(incident, "verificationStatus"))} /><button className="primary-button" disabled={busy} onClick={() => { setResolutionNote(""); setResolveDialog(true); }}><Check /> Selesaikan Kendala</button></div></article> : <form className="form-card compact incident-report-form" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const fd = new FormData(formElement); void act("reportCourierIncident", { requestId: requestId("incident"), payload: { type: fd.get("type"), detail: fd.get("detail"), delayEstimate: fd.get("delay") } }, "Kendala dilaporkan ke Farmasi.", "Pemberitahuan kendala ke pasien").then(result => { if (result) formElement.reset(); }); }}><SectionTitle title="Laporkan kendala" text="Siapkan pesan WhatsApp untuk setiap pasien pada paket aktif yang terdampak." /><div className="form-grid"><Field label="Jenis kendala"><select name="type" required><option value="">Pilih kendala</option>{optionsOf(operationalOptions, "COURIER_INCIDENT_TYPES").map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Estimasi keterlambatan"><select name="delay" required>{optionsOf(operationalOptions, "DELAY_ESTIMATES").map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Detail"><textarea name="detail" required placeholder="Jelaskan singkat tanpa data pasien" /></Field></div><button className="danger-button incident-submit" disabled={busy}><TriangleAlert /> Laporkan Kendala</button></form>}{actionModals}</div>;
  if (active === "ready") return <div className="content-stack"><section className="courier-hero"><div><span className="eyebrow">SIAP DIAMBIL</span><h2>{ready.length} paket menunggu Kurir</h2><p>Pilih berdasarkan wilayah. Identitas dan alamat pasien tetap terkunci sampai tugas berhasil diambil.</p></div><div className="route-icon"><Bike /></div></section>{ready.length ? grouped.map(([routeName, rows]) => <section className="route-group" key={routeName}><header><div><MapPin /><span><strong>{routeName}</strong><small>{rows?.length || 0} paket dalam kelompok rute ini</small></span></div><Badge status="KLAIM PER PAKET" /></header><div className="cards-grid">{rows?.map((row) => <SafeQueueCard key={rowId(row)} row={row} actions={<button className="primary-button small" disabled={busy || !!incident} onClick={() => setClaimRow(row)}><Bike /> Ambil Tugas</button>} />)}</div></section>) : <Empty icon={<PackageCheck />} title="Semua paket sudah tertangani" text="Daftar diperbarui otomatis ketika Farmasi menyiapkan obat." />}{incident && <div className="policy-note warning"><TriangleAlert /><div><strong>Pengambilan tugas dikunci sementara</strong><p>Selesaikan kendala aktif sebelum mengambil paket baru.</p></div></div>}{actionModals}</div>;
  return <div className="content-stack"><section className="courier-hero"><div><span className="eyebrow">RUANG KERJA KURIR</span><h2>Rute jelas, tindakan cepat.</h2><p>Ambil paket per wilayah, buka tujuan setelah klaim, lalu selesaikan setiap pengantaran dari HP.</p></div><div className="route-icon"><Bike /></div></section><div className="stats-grid courier-stats"><ActionStatCard icon={<PackageOpen />} label="Siap diambil" value={ready.length} note="Identitas masih terkunci" onClick={() => navigate("ready")} /><ActionStatCard icon={<Bike />} label="Tugas aktif" value={mine.length} note="Lanjutkan pengantaran" tone="purple" onClick={() => navigate("my-tasks")} /><ActionStatCard icon={<PackageCheck />} label="Ditangani hari ini" value={historyRows.length} note={`${historyRows.filter(row => baseStatusOf(row) === STATUS.DELIVERED).length} berhasil • ${historyRows.filter(row => baseStatusOf(row) === STATUS.FAILED).length} gagal`} tone="green" onClick={() => navigate("history")} /><ActionStatCard icon={<TriangleAlert />} label="Kendala aktif" value={incident ? 1 : 0} note={incident ? "Perlu diselesaikan" : "Perjalanan aman"} tone="orange" onClick={() => navigate("incidents")} /></div><div className="courier-next"><span><Route /></span><div><strong>{mine.length ? `${mine.length} tugas perlu diselesaikan` : ready.length ? `${ready.length} paket siap dipilih` : "Belum ada tugas baru"}</strong><p>{mine.length ? "Buka Tugas Saya untuk Maps, WhatsApp, telepon, dan penyelesaian paket." : ready.length ? "Buka Siap Diambil dan pilih paket sesuai rute perjalanan." : "Antrean baru akan muncul otomatis."}</p></div><button className="primary-button" onClick={() => navigate(mine.length ? "my-tasks" : "ready")}><ArrowRight /> Buka</button></div></div>;
}

function AdminView({ active, data, areas, accounts, retention, health, currentUser, operationalSettings, onRefresh, onLogout, navigate, show }: { active: string; data: Row[]; areas: Row[]; accounts: Row[]; retention: Row | null; health: Row; currentUser: AppUser; operationalSettings: Row; onRefresh: () => void; onLogout: () => void; navigate: (id: string) => void; show: (type: "success" | "error", message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedRegencies, setExpandedRegencies] = useState<Set<string>>(() => new Set(["Kota Mataram"]));
  const [accountDialog, setAccountDialog] = useState<"create" | "edit" | "pin" | null>(null);
  const [accountForm, setAccountForm] = useState({ currentUsername: "", username: "", name: "", role: "FARMASI", active: true, pin: "", pinConfirm: "", adminPin: "", note: "" });
  const [areaDialog, setAreaDialog] = useState<"edit" | null>(null);
  const [areaForm, setAreaForm] = useState({ areaId: "", province: "Nusa Tenggara Barat", regency: "", district: "", village: "", coverageStatus: "BELUM DITETAPKAN", feePolicy: "BELUM DITETAPKAN", baseDeliveryFee: "0", subsidyAmount: "0", patientFee: "0", adminPin: "" });
  const [settingDialog, setSettingDialog] = useState<{ kind: "OPTIONS" | "TEMPLATE"; key: string; label: string } | null>(null);
  const [settingValue, setSettingValue] = useState("");
  const [settingPin, setSettingPin] = useState("");
  const [correctionRow, setCorrectionRow] = useState<Row | null>(null);
  const [correctionForm, setCorrectionForm] = useState({ status: "", note: "", adminPin: "" });
  const [backupDialog, setBackupDialog] = useState(false);
  const [backupForm, setBackupForm] = useState({ note: "Checkpoint PRECHANGE dibuat melalui Dashboard Admin", adminPin: "" });
  const [cleanupDialog, setCleanupDialog] = useState<Row | null>(null);
  const [cleanupResult, setCleanupResult] = useState<Row | null>(null);
  const [cleanupForm, setCleanupForm] = useState({ adminPin: "", confirmation: "" });
  const [techDialog, setTechDialog] = useState(false);
  const [techPin, setTechPin] = useState("");
  const [techSession, setTechSession] = useState<Row | null>(null);
  const [recoveryRows, setRecoveryRows] = useState<Row[]>([]);
  const [techBackupId, setTechBackupId] = useState("");
  const [techTransactionId, setTechTransactionId] = useState("");
  const [techCell, setTechCell] = useState({ sheet: "DELIVERIES", keyValue: "", field: "status" });
  const [techPreview, setTechPreview] = useState<Row | null>(null);
  const [techConfirmation, setTechConfirmation] = useState("");

  async function invoke<T = Row>(name: string, payload: Row, success = "") {
    setBusy(true);
    try { const result = await callFunction<T>(name, payload); if (success) show("success", success); await onRefresh(); return result; }
    catch (e) { show("error", e instanceof Error ? e.message : "Aksi gagal."); return null; }
    finally { setBusy(false); }
  }

  async function act(name: string, payload: Row, success: string) {
    return Boolean(await invoke(name, payload, success));
  }

  function openCleanup(row: Row) {
    setCleanupDialog(row); setCleanupResult(null); setCleanupForm({ adminPin: "", confirmation: "" });
  }

  async function prepareCleanup(event: FormEvent) {
    event.preventDefault(); if (!cleanupDialog) return;
    if (!/^\d{4,6}$/.test(cleanupForm.adminPin)) return show("error", "PIN Admin harus 4–6 angka.");
    const result = await invoke<Row>("adminPrepareCleanup", { requestId: requestId("cleanup_prepare"), year: Number(cleanupDialog.year), adminPin: cleanupForm.adminPin }, "Manifest cleanup berhasil diperiksa.");
    if (result) { setCleanupResult(result); setCleanupForm({ adminPin: "", confirmation: "" }); }
  }

  async function approveCleanup(event: FormEvent) {
    event.preventDefault(); if (!cleanupDialog) return;
    const manifestId = String(get(cleanupResult || cleanupDialog, "manifestId"));
    if (!manifestId) return show("error", "Manifest cleanup belum tersedia.");
    if (!/^\d{4,6}$/.test(cleanupForm.adminPin)) return show("error", "PIN Admin harus 4–6 angka.");
    if (cleanupForm.confirmation !== "SETUJUI CLEANUP") return show("error", "Ketik SETUJUI CLEANUP persis untuk melanjutkan.");
    const result = await invoke<Row>("adminApproveCleanup", { requestId: requestId("cleanup_approve"), manifestId, adminPin: cleanupForm.adminPin, confirmation: cleanupForm.confirmation }, "Cleanup disetujui setelah PRECHANGE backup dibuat.");
    if (result) { setCleanupResult(result); setCleanupForm({ adminPin: "", confirmation: "" }); }
  }

  async function runCleanupBatch() {
    if (!cleanupDialog) return; const manifestId = String(get(cleanupResult || cleanupDialog, "manifestId"));
    if (!manifestId) return show("error", "Manifest cleanup tidak ditemukan.");
    const result = await invoke<Row>("adminRunCleanupBatch", { requestId: requestId("cleanup_batch"), manifestId, limit: 200 }, "Batch cleanup dijalankan dengan safety gate aktif.");
    if (result) setCleanupResult(result);
  }

  async function enterTech(event: FormEvent) {
    event.preventDefault(); if (!/^\d{4,6}$/.test(techPin)) return show("error", "PIN Admin harus 4–6 angka.");
    const result = await invoke<Row>("enterTechnicianMode", { adminPin: techPin }, "Mode Teknisi Lanjutan aktif selama 10 menit.");
    if (!result) return; setTechSession(result); setTechPin(""); setTechPreview(null); setTechConfirmation("");
    const list = await invoke<{ rows: Row[] }>("adminRecoveryRegistry", { limit: 40 });
    const rows = list?.rows || []; setRecoveryRows(rows); if (rows.length) setTechBackupId(String(get(rows[0], "backupId", "id")));
  }

  async function technicianSimple(name: string, success: string) {
    if (!techSession) return; const result = await invoke<Row>(name, { technicianToken: techSession.technicianToken }, success);
    if (name === "diagnosticBundle" && result?.fileUrl) window.open(String(result.fileUrl), "_blank", "noopener,noreferrer");
  }

  async function previewRecovery(mode: "BACKUP" | "TRANSACTION" | "CELL") {
    if (!techSession || !techBackupId) return show("error", "Pilih backup terlebih dahulu.");
    const selected = recoveryRows.find(row => String(get(row, "backupId", "id")) === techBackupId);
    let name = "technicianBackupPreview"; let payload: Row = { technicianToken: techSession.technicianToken, backupId: techBackupId };
    if (mode === "BACKUP" && String(get(selected || {}, "kind")) === "CHECKPOINT") name = "technicianCheckpointPreview";
    if (mode === "TRANSACTION") { if (!techTransactionId.trim()) return show("error", "Masukkan ID Sistem transaksi."); name = "technicianTransactionPreview"; payload.deliveryId = techTransactionId.trim(); }
    if (mode === "CELL") { if (!techCell.keyValue.trim() || !techCell.field.trim()) return show("error", "ID baris dan nama field wajib diisi."); name = "technicianCellPreview"; payload = { ...payload, ...techCell }; }
    const result = await invoke<Row>(name, payload); if (result) { setTechPreview({ ...result, __mode: mode, __kind: String(get(selected || {}, "kind")) }); setTechConfirmation(""); }
  }

  async function applyRecovery() {
    if (!techSession || !techPreview) return;
    const mode = String(techPreview.__mode); let name = "technicianRestoreBackup"; const payload: Row = { technicianToken: techSession.technicianToken, backupId: techPreview.backupId, confirmation: techConfirmation, note: "Recovery melalui Mode Teknisi Lanjutan" };
    if (mode === "BACKUP" && String(techPreview.__kind) === "CHECKPOINT") name = "technicianRestoreCheckpoint";
    if (mode === "TRANSACTION") { name = "technicianRecoverTransaction"; payload.deliveryId = techPreview.deliveryId; }
    if (mode === "CELL") { name = "technicianRestoreCell"; payload.sheet = techPreview.sheet; payload.keyValue = techPreview.keyValue; payload.field = techPreview.field; }
    const result = await invoke<Row>(name, payload, "Recovery selesai dan reconciliation telah dijalankan.");
    if (result) { setTechPreview(null); setTechConfirmation(""); const list = await invoke<{ rows: Row[] }>("adminRecoveryRegistry", { limit: 40 }); setRecoveryRows(list?.rows || []); }
  }

  function openCreateAccount() {
    setAccountForm({ currentUsername: "", username: "", name: "", role: "FARMASI", active: true, pin: "", pinConfirm: "", adminPin: "", note: "" });
    setAccountDialog("create");
  }

  function openEditAccount(row: Row) {
    setAccountForm({ currentUsername: String(get(row, "username")), username: String(get(row, "username")), name: String(get(row, "name")), role: String(get(row, "role")), active: get(row, "active") !== false, pin: "", pinConfirm: "", adminPin: "", note: String(get(row, "note") || "") });
    setAccountDialog("edit");
  }

  function openPinAccount(row: Row) {
    setAccountForm({ currentUsername: String(get(row, "username")), username: String(get(row, "username")), name: String(get(row, "name")), role: String(get(row, "role")), active: get(row, "active") !== false, pin: "", pinConfirm: "", adminPin: "", note: String(get(row, "note") || "") });
    setAccountDialog("pin");
  }

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4,6}$/.test(accountForm.adminPin)) return show("error", "PIN Admin harus 4–6 angka.");
    if (accountDialog === "create") {
      if (!/^\d{4,6}$/.test(accountForm.pin)) return show("error", "PIN awal harus 4–6 angka.");
      const ok = await act("adminAccountCreate", { requestId: requestId("account_create"), username: accountForm.username, name: accountForm.name, role: accountForm.role, pin: accountForm.pin, note: accountForm.note || "Dibuat melalui PWA", adminPin: accountForm.adminPin }, "Akun berhasil dibuat.");
      if (ok) setAccountDialog(null);
      return;
    }
    if (accountDialog === "edit") {
      const ok = await act("adminAccountUpdate", { requestId: requestId("account_update"), currentUsername: accountForm.currentUsername, username: accountForm.username, name: accountForm.name, role: accountForm.role, active: accountForm.active, note: accountForm.note, adminPin: accountForm.adminPin }, "Data akun berhasil diperbarui.");
      if (ok) setAccountDialog(null);
      return;
    }
    if (accountDialog === "pin") {
      if (!/^\d{4,6}$/.test(accountForm.pin)) return show("error", "PIN baru harus 4–6 angka.");
      if (accountForm.pin !== accountForm.pinConfirm) return show("error", "Konfirmasi PIN baru tidak sama.");
      const ownPin = accountForm.currentUsername.toLowerCase() === currentUser.username.toLowerCase();
      const ok = await act("adminAccountChangePin", { requestId: requestId("account_pin"), username: accountForm.currentUsername, newPin: accountForm.pin, adminPin: accountForm.adminPin }, ownPin ? "PIN Admin berhasil diubah. Silakan masuk kembali." : "PIN akun berhasil diubah.");
      if (ok) { setAccountDialog(null); if (ownPin) onLogout(); }
    }
  }

  function openEditArea(row: Row) {
    const patientFee = Number(get(row, "patientFee") || 0);
    const subsidyAmount = Number(get(row, "subsidyAmount") || 0);
    setAreaForm({ areaId: String(get(row, "areaId", "id")), province: String(get(row, "province") || "Nusa Tenggara Barat"), regency: String(get(row, "regency")), district: String(get(row, "district")), village: String(get(row, "village")), coverageStatus: String(get(row, "coverageStatus") || "BELUM DITETAPKAN"), feePolicy: String(get(row, "feePolicy") || "BELUM DITETAPKAN"), baseDeliveryFee: String(Number(get(row, "baseDeliveryFee") || patientFee + subsidyAmount)), subsidyAmount: String(subsidyAmount), patientFee: String(patientFee), adminPin: "" });
    setAreaDialog("edit");
  }

  function validAreaPolicy(coverageStatus: string, feePolicy: string, baseDeliveryFee: number, subsidyAmount: number, patientFee: number) {
    if (coverageStatus === "AKTIF" && feePolicy === "BELUM DITETAPKAN") return "Wilayah AKTIF wajib memiliki kebijakan biaya.";
    if (["GRATIS", "BELUM DITETAPKAN"].includes(feePolicy) && (baseDeliveryFee !== 0 || subsidyAmount !== 0 || patientFee !== 0)) return "GRATIS/BELUM DITETAPKAN harus memiliki seluruh komponen biaya Rp0.";
    if (feePolicy === "BERBAYAR" && (baseDeliveryFee <= 0 || subsidyAmount !== 0 || patientFee !== baseDeliveryFee)) return "BERBAYAR wajib memiliki tarif asli lebih dari Rp0 tanpa subsidi.";
    if (feePolicy === "SUBSIDI" && (baseDeliveryFee <= 0 || subsidyAmount <= 0 || subsidyAmount > baseDeliveryFee || patientFee !== baseDeliveryFee - subsidyAmount)) return "SUBSIDI wajib memiliki tarif asli, nilai subsidi, dan biaya pasien yang sesuai.";
    return "";
  }

  async function submitArea(event: FormEvent) {
    event.preventDefault();
    const baseDeliveryFee = Number(areaForm.baseDeliveryFee || 0);
    const subsidyAmount = Number(areaForm.subsidyAmount || 0);
    const patientFee = Math.max(0, baseDeliveryFee - subsidyAmount);
    const invalid = validAreaPolicy(areaForm.coverageStatus, areaForm.feePolicy, baseDeliveryFee, subsidyAmount, patientFee);
    if (invalid) return show("error", invalid);
    if (!/^\d{4,6}$/.test(areaForm.adminPin)) return show("error", "PIN Admin harus 4–6 angka.");
    const area = { areaId: areaForm.areaId, coverageStatus: areaForm.coverageStatus, feePolicy: areaForm.feePolicy, baseDeliveryFee, subsidyAmount, patientFee };
    const ok = await act("adminServiceAreaUpsert", { requestId: requestId("area_upsert"), area, adminPin: areaForm.adminPin }, "Wilayah berhasil diperbarui.");
    if (ok) setAreaDialog(null);
  }

  function openSetting(kind: "OPTIONS" | "TEMPLATE", key: string, label: string, value: string | string[]) {
    setSettingDialog({ kind, key, label });
    setSettingValue(Array.isArray(value) ? value.join("\n") : String(value || ""));
    setSettingPin("");
  }

  async function saveSetting(event: FormEvent) {
    event.preventDefault();
    if (!settingDialog) return;
    if (!/^\d{4,6}$/.test(settingPin)) return show("error", "PIN Admin harus 4–6 angka.");
    const payload: Row = { requestId: requestId("operational_setting"), kind: settingDialog.kind, key: settingDialog.key, adminPin: settingPin };
    if (settingDialog.kind === "OPTIONS") payload.values = settingValue.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    else payload.template = settingValue;
    const ok = await act("adminOperationalSettingsUpdate", payload, "Pengaturan operasional berhasil disimpan.");
    if (ok) setSettingDialog(null);
  }

  async function resetSetting() {
    if (!settingDialog) return;
    if (!/^\d{4,6}$/.test(settingPin)) return show("error", "Masukkan PIN Admin untuk mengembalikan nilai bawaan.");
    const ok = await act("adminOperationalSettingsUpdate", { requestId: requestId("operational_reset"), kind: settingDialog.kind, key: settingDialog.key, reset: true, adminPin: settingPin }, "Pengaturan dikembalikan ke nilai bawaan.");
    if (ok) setSettingDialog(null);
  }

  async function submitCorrection(event: FormEvent) {
    event.preventDefault();
    if (!correctionRow) return;
    if (!/^\d{4,6}$/.test(correctionForm.adminPin)) return show("error", "PIN Admin harus 4–6 angka.");
    const ok = await act("adminCorrectStatus", { requestId: requestId("correct"), id: rowId(correctionRow), status: correctionForm.status, note: correctionForm.note, adminPin: correctionForm.adminPin }, "Status berhasil dikoreksi.");
    if (ok) setCorrectionRow(null);
  }

  async function submitBackup(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4,6}$/.test(backupForm.adminPin)) return show("error", "PIN Admin harus 4–6 angka.");
    const ok = await act("adminCreateBackup", { kind: "PRECHANGE", note: backupForm.note, adminPin: backupForm.adminPin }, "Backup PRECHANGE dibuat.");
    if (ok) setBackupDialog(false);
  }

  const filteredAreas = areas.filter((a) => JSON.stringify(a).toLowerCase().includes(query.toLowerCase())).sort((a, b) => String(get(a, "regency")).localeCompare(String(get(b, "regency")), "id") || String(get(a, "district")).localeCompare(String(get(b, "district")), "id") || String(get(a, "village")).localeCompare(String(get(b, "village")), "id"));
  const groupedAreas = Object.entries(Object.groupBy(filteredAreas, area => String(get(area, "regency") || "Kabupaten/Kota belum diisi"))).sort(([a], [b]) => a.localeCompare(b, "id"));
  function areaKey(row: Row) { return String(get(row, "areaId", "id")); }
  function toggleRegency(regency: string) { setExpandedRegencies(current => { const next = new Set(current); if (next.has(regency)) next.delete(regency); else next.add(regency); return next; }); }
  const calculatedPatientFee = Math.max(0, Number(areaForm.baseDeliveryFee || 0) - Number(areaForm.subsidyAmount || 0));
  const optionGroups = (operationalSettings.optionGroups || {}) as OperationalOptions;
  const templates = (operationalSettings.templates || {}) as Record<string, string>;
  const optionLabels: Record<string, string> = {
    PENDING_REASONS: "Alasan Pending Kurir",
    FAILURE_REASONS: "Alasan Gagal Antar",
    RECEIVER_RELATIONSHIPS: "Hubungan Penerima",
    NO_CODE_REASONS: "Alasan Penyerahan Tanpa Kode",
    COURIER_INCIDENT_TYPES: "Jenis Kendala Kurir",
    DELAY_ESTIMATES: "Estimasi Keterlambatan",
    MANUAL_VERIFICATION_METHODS: "Metode Verifikasi Farmasi",
  };

  const accountModal = accountDialog ? <Modal title={accountDialog === "create" ? "Tambah Akun" : accountDialog === "edit" ? "Kelola Akun" : "Ganti PIN"} text={accountDialog === "pin" ? `Buat PIN baru untuk ${accountForm.name}. PIN lama tidak dapat dilihat.` : "Setiap perubahan membutuhkan konfirmasi PIN Admin dan dicatat dalam audit."} onClose={() => !busy && setAccountDialog(null)}>
    <form className="modal-form" onSubmit={submitAccount}>
      {accountDialog !== "pin" && <div className="form-grid">
        <Field label="Nama petugas"><input required value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} /></Field>
        <Field label="Username" hint={accountForm.role === "ADMIN" ? "Username Admin tunggal dikunci." : "Gunakan satu kata; underscore diperbolehkan."}><input required disabled={accountForm.role === "ADMIN"} value={accountForm.username} onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value.replace(/\s/g, "_") })} /></Field>
        <Field label="Peran"><select disabled={accountForm.role === "ADMIN"} value={accountForm.role} onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value })}>{accountForm.role === "ADMIN" && <option value="ADMIN">ADMIN</option>}<option value="FARMASI">FARMASI</option><option value="KURIR">KURIR</option><option value="MANAJEMEN">MANAJEMEN</option></select></Field>
        {accountDialog === "edit" && <Field label="Status"><select disabled={accountForm.role === "ADMIN"} value={accountForm.active ? "AKTIF" : "NONAKTIF"} onChange={(e) => setAccountForm({ ...accountForm, active: e.target.value === "AKTIF" })}><option value="AKTIF">AKTIF</option><option value="NONAKTIF">NONAKTIF</option></select></Field>}
        <Field label="Catatan" hint="Opsional; tidak berisi PIN."><input value={accountForm.note} onChange={(e) => setAccountForm({ ...accountForm, note: e.target.value })} /></Field>
        {accountDialog === "create" && <PinInput label="PIN awal" value={accountForm.pin} onChange={(pin) => setAccountForm({ ...accountForm, pin })} />}
      </div>}
      {accountDialog === "pin" && <div className="form-grid"><PinInput label="PIN baru" value={accountForm.pin} onChange={(pin) => setAccountForm({ ...accountForm, pin })} /><PinInput label="Ulangi PIN baru" value={accountForm.pinConfirm} onChange={(pinConfirm) => setAccountForm({ ...accountForm, pinConfirm })} /></div>}
      <div className="secure-confirm"><ShieldCheck /><div><strong>Konfirmasi tindakan</strong><p>Masukkan PIN akun Admin yang sedang digunakan.</p></div></div>
      <PinInput label="PIN Admin" value={accountForm.adminPin} onChange={(adminPin) => setAccountForm({ ...accountForm, adminPin })} />
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setAccountDialog(null)} disabled={busy}>Batal</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : accountDialog === "pin" ? <KeyRound /> : <Save />}{accountDialog === "create" ? "Simpan Akun" : accountDialog === "edit" ? "Simpan Perubahan" : "Ganti PIN"}</button></footer>
    </form>
  </Modal> : null;

  const areaModal = areaDialog ? <Modal wide title="Kelola Desa/Kelurahan" text="Identitas Golden Master 623 dikunci. Admin hanya mengatur cakupan layanan dan biaya." onClose={() => !busy && setAreaDialog(null)}>
    <form className="modal-form" onSubmit={submitArea}>
      <div className="form-grid">
        <Field label="Provinsi"><input readOnly value={areaForm.province} /></Field>
        <Field label="Kabupaten/Kota"><input readOnly value={areaForm.regency} /></Field>
        <Field label="Kecamatan"><input readOnly value={areaForm.district} /></Field>
        <Field label="Desa/Kelurahan"><input readOnly value={areaForm.village} /></Field>
      </div>
      <div className="form-grid policy-grid">
        <Field label="Status cakupan"><select value={areaForm.coverageStatus} onChange={(e) => setAreaForm({ ...areaForm, coverageStatus: e.target.value })}><option>AKTIF</option><option>NONAKTIF</option><option>BELUM DITETAPKAN</option></select></Field>
        <Field label="Kebijakan biaya"><select value={areaForm.feePolicy} onChange={(e) => { const feePolicy = e.target.value; setAreaForm({ ...areaForm, feePolicy, baseDeliveryFee: ["GRATIS", "BELUM DITETAPKAN"].includes(feePolicy) ? "0" : areaForm.baseDeliveryFee, subsidyAmount: feePolicy === "SUBSIDI" ? areaForm.subsidyAmount : "0", patientFee: ["GRATIS", "BELUM DITETAPKAN"].includes(feePolicy) ? "0" : areaForm.baseDeliveryFee }); }}><option>GRATIS</option><option>SUBSIDI</option><option>BERBAYAR</option><option>BELUM DITETAPKAN</option></select></Field>
        {!["GRATIS", "BELUM DITETAPKAN"].includes(areaForm.feePolicy) && <Field label="Tarif asli" hint="Tarif pengantaran sebelum subsidi."><input type="number" min="0" step="1000" value={areaForm.baseDeliveryFee} onChange={(e) => { const baseDeliveryFee = e.target.value; const patientFee = String(Math.max(0, Number(baseDeliveryFee || 0) - Number(areaForm.subsidyAmount || 0))); setAreaForm({ ...areaForm, baseDeliveryFee, patientFee }); }} /></Field>}
        {areaForm.feePolicy === "SUBSIDI" && <Field label="Nilai subsidi" hint="Nominal yang ditanggung RSUD."><input type="number" min="0" step="1000" value={areaForm.subsidyAmount} onChange={(e) => { const subsidyAmount = e.target.value; const patientFee = String(Math.max(0, Number(areaForm.baseDeliveryFee || 0) - Number(subsidyAmount || 0))); setAreaForm({ ...areaForm, subsidyAmount, patientFee }); }} /></Field>}
        {!["GRATIS", "BELUM DITETAPKAN"].includes(areaForm.feePolicy) && <Field label="Dibayar pasien" hint="Dihitung otomatis dan dibayar di Farmasi."><input readOnly value={money(calculatedPatientFee)} /></Field>}
      </div>
      <div className="policy-preview"><Route /><div><strong>{areaForm.coverageStatus} • {areaForm.feePolicy}</strong><p>{areaForm.feePolicy === "GRATIS" ? "Pasien tidak dikenakan biaya pengantaran." : areaForm.feePolicy === "BELUM DITETAPKAN" ? "Belum dapat digunakan untuk pendaftaran layanan." : areaForm.feePolicy === "SUBSIDI" ? `Tarif ${money(areaForm.baseDeliveryFee)} − subsidi ${money(areaForm.subsidyAmount)} = pasien membayar ${money(calculatedPatientFee)} di Farmasi.` : `Pasien membayar tarif ${money(areaForm.baseDeliveryFee)} di Farmasi.`}</p></div></div>
      <PinInput label="PIN Admin" value={areaForm.adminPin} onChange={(adminPin) => setAreaForm({ ...areaForm, adminPin })} />
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setAreaDialog(null)} disabled={busy}>Batal</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Save />}Simpan Wilayah</button></footer>
    </form>
  </Modal> : null;

  const settingModal = settingDialog ? <Modal wide title={settingDialog.label} text={settingDialog.kind === "OPTIONS" ? "Satu pilihan per baris. Perubahan langsung dipakai modal operasional Farmasi/Kurir." : "Gunakan variabel yang tersedia; pesan tetap dibuka melalui click-to-chat dan tidak diklaim terkirim otomatis."} onClose={() => !busy && setSettingDialog(null)}>
    <form className="modal-form" onSubmit={saveSetting}>
      <Field label={settingDialog.kind === "OPTIONS" ? "Daftar pilihan" : "Isi template WhatsApp"} hint={settingDialog.kind === "OPTIONS" ? "Urutan baris menjadi urutan pilihan pada aplikasi." : "Variabel wajib tidak boleh dihapus."}><textarea className="settings-textarea" required rows={settingDialog.kind === "OPTIONS" ? 12 : 15} value={settingValue} onChange={(event) => setSettingValue(event.target.value)} /></Field>
      {settingDialog.kind === "TEMPLATE" && <div className="token-panel"><strong>Variabel tersedia</strong><div>{((operationalSettings.allowedTokens || []) as string[]).map(token => <code key={token}>{"{{" + token + "}}"}</code>)}</div></div>}
      <div className="secure-confirm"><ShieldCheck /><div><strong>Perubahan diaudit</strong><p>Masukkan PIN Admin. PIN dan hash tidak pernah ditampilkan atau disimpan di template.</p></div></div>
      <PinInput label="PIN Admin" value={settingPin} onChange={setSettingPin} />
      <footer className="modal-actions split-actions"><button type="button" className="secondary-button" disabled={busy} onClick={resetSetting}><RefreshCw /> Kembalikan Bawaan</button><span /><button type="button" className="secondary-button" disabled={busy} onClick={() => setSettingDialog(null)}>Batal</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Save />} Simpan</button></footer>
    </form>
  </Modal> : null;

  const correctionModal = correctionRow ? <Modal title={"Koreksi " + deliveryCode(correctionRow)} text="Perubahan status membutuhkan alasan dan PIN Admin; seluruhnya masuk audit trail." onClose={() => !busy && setCorrectionRow(null)}>
    <form className="modal-form" onSubmit={submitCorrection}>
      <Field label="Status koreksi"><select required value={correctionForm.status} onChange={(event) => setCorrectionForm({ ...correctionForm, status: event.target.value })}>{Object.values(STATUS).map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Alasan koreksi"><textarea required value={correctionForm.note} onChange={(event) => setCorrectionForm({ ...correctionForm, note: event.target.value })} placeholder="Jelaskan alasan koreksi secara spesifik" /></Field>
      <PinInput label="PIN Admin" value={correctionForm.adminPin} onChange={(adminPin) => setCorrectionForm({ ...correctionForm, adminPin })} />
      <footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setCorrectionRow(null)}>Batal</button><button className="primary-button" disabled={busy || !correctionForm.note.trim()}><Save /> Terapkan Koreksi</button></footer>
    </form>
  </Modal> : null;

  const backupModal = backupDialog ? <Modal title="Buat Backup PRECHANGE" text="Buat checkpoint sebelum perubahan besar, pemulihan, atau annual cleanup." onClose={() => !busy && setBackupDialog(false)}>
    <form className="modal-form" onSubmit={submitBackup}>
      <Field label="Catatan backup"><textarea required value={backupForm.note} onChange={(event) => setBackupForm({ ...backupForm, note: event.target.value })} /></Field>
      <PinInput label="PIN Admin" value={backupForm.adminPin} onChange={(adminPin) => setBackupForm({ ...backupForm, adminPin })} />
      <footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setBackupDialog(false)}>Batal</button><button className="primary-button" disabled={busy}><ShieldCheck /> Buat Backup</button></footer>
    </form>
  </Modal> : null;


  const cleanupStatus = String(get(cleanupResult || cleanupDialog || {}, "status") || "");
  const cleanupManifestId = String(get(cleanupResult || cleanupDialog || {}, "manifestId") || "");
  const cleanupGates = (get(cleanupResult || cleanupDialog || {}, "gates") || {}) as Row;
  const cleanupModal = cleanupDialog ? <Modal wide title={`Annual Cleanup ${cleanupDialog.year}`} text="Tidak ada penghapusan otomatis. Safety gate harus PASS, lalu PRECHANGE backup dan persetujuan Admin wajib dibuat." onClose={() => !busy && setCleanupDialog(null)}>
    <div className="cleanup-gates">
      <div><small>Status</small><Badge status={cleanupStatus || String(cleanupDialog.status)} /></div>
      <div><small>Eligible</small><strong>{cleanupGates.eligible === false ? "TIDAK" : "YA"}</strong></div>
      <div><small>Archive lengkap</small><strong>{cleanupGates.archiveComplete === false ? "BELUM" : cleanupGates.archiveComplete === true ? "YA" : "—"}</strong></div>
      <div><small>Workflow aktif</small><strong>{cleanupGates.noActiveWorkflow === false ? "ADA" : cleanupGates.noActiveWorkflow === true ? "TIDAK" : "—"}</strong></div>
      <div><small>Integritas sistem</small><strong>{cleanupGates.systemIntegrity === false ? "BLOKIR" : cleanupGates.systemIntegrity === true ? "AMAN" : "—"}</strong></div>
      <div><small>PRECHANGE backup</small><strong>{cleanupGates.backupHealthy === false ? "GAGAL" : cleanupGates.backupHealthy === true ? "SEHAT" : "SAAT APPROVAL"}</strong></div>
      <div><small>Reconciliation</small><strong>{cleanupGates.reconciliationPass === false ? "FAIL" : cleanupGates.reconciliationPass === true ? "PASS" : "SAAT APPROVAL"}</strong></div>
    </div>
    {(cleanupStatus === "" || cleanupStatus === "ELIGIBLE" || cleanupStatus === "BLOCKED") && <form className="modal-form" onSubmit={prepareCleanup}>
      <div className="policy-note"><ShieldCheck /><div><strong>Tahap 1 — Siapkan manifest</strong><p>Sistem hanya memeriksa eligibility, archive, workflow aktif, dan integritas. Belum ada data yang dihapus.</p></div></div>
      <PinInput label="PIN Admin" value={cleanupForm.adminPin} onChange={(adminPin) => setCleanupForm({ ...cleanupForm, adminPin })} />
      <footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setCleanupDialog(null)}>Batal</button><button className="primary-button" disabled={busy}><ClipboardCheck /> Periksa & Siapkan</button></footer>
    </form>}
    {cleanupStatus === "PREPARED" && <form className="modal-form" onSubmit={approveCleanup}>
      <div className="policy-note warning"><TriangleAlert /><div><strong>Tahap 2 — Persetujuan final</strong><p>Saat disetujui, sistem membuat PRECHANGE backup terlebih dahulu. Penghapusan kemudian berjalan batch kecil.</p></div></div>
      <Field label="Konfirmasi" hint="Ketik persis: SETUJUI CLEANUP"><input required value={cleanupForm.confirmation} onChange={(e) => setCleanupForm({ ...cleanupForm, confirmation: e.target.value })} /></Field>
      <PinInput label="PIN Admin" value={cleanupForm.adminPin} onChange={(adminPin) => setCleanupForm({ ...cleanupForm, adminPin })} />
      <footer className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setCleanupDialog(null)}>Batal</button><button className="danger-button" disabled={busy || cleanupForm.confirmation !== "SETUJUI CLEANUP"}><ShieldCheck /> Setujui Cleanup</button></footer>
    </form>}
    {(cleanupStatus === "APPROVED" || cleanupStatus === "RUNNING") && <div className="modal-form">
      <div className="policy-note"><RefreshCw /><div><strong>Tahap 3 — Batch worker</strong><p>Worker otomatis memproses maksimal 200 baris per batch. Tombol di bawah hanya mempercepat satu batch sekarang.</p></div></div>
      <p>Manifest: <code>{cleanupManifestId}</code> • sudah dihapus: {Number(get(cleanupResult || cleanupDialog, "deletedTotal", "deletedCount") || 0).toLocaleString("id-ID")}</p>
      <footer className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => setCleanupDialog(null)}>Tutup</button><button className="danger-button" disabled={busy} onClick={() => void runCleanupBatch()}><RefreshCw /> Jalankan 1 Batch</button></footer>
    </div>}
    {cleanupStatus === "COMPLETE" || cleanupStatus === "CLEANED" ? <div className="policy-note"><Check /><div><strong>Cleanup selesai</strong><p>Detail operasional tahun ini sudah dibersihkan; archive analitik anonim tetap dipertahankan.</p></div></div> : null}
  </Modal> : null;

  const selectedRecovery = recoveryRows.find(row => String(get(row, "backupId", "id")) === techBackupId);
  const techModal = techDialog ? <Modal wide title="Mode Teknisi Lanjutan" text="Fitur recovery sensitif. Akses memerlukan step-up authentication dan otomatis berakhir sekitar 10 menit." onClose={() => !busy && setTechDialog(false)}>
    {!techSession ? <form className="modal-form" onSubmit={enterTech}>
      <div className="policy-note warning"><LockKeyhole /><div><strong>Bukan untuk kegiatan Admin harian</strong><p>Gunakan hanya untuk pemeriksaan struktur, recovery, atau diagnostic bundle.</p></div></div>
      <PinInput label="PIN Admin" value={techPin} onChange={setTechPin} />
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setTechDialog(false)}>Batal</button><button className="primary-button" disabled={busy}><KeyRound /> Aktifkan 10 Menit</button></footer>
    </form> : <div className="modal-form technician-panel">
      <div className="policy-note"><ShieldCheck /><div><strong>Mode Teknisi aktif</strong><p>Berakhir: {dateText(techSession.expiresAt)}. Semua tindakan dipreview, dibackup, direkonsiliasi, dan diaudit.</p></div></div>
      <div className="row-actions"><button className="secondary-button" disabled={busy} onClick={() => void technicianSimple("repairSafeStructure", "Perbaikan struktur aman selesai.")}><ShieldCheck /> Repair Struktur Aman</button><button className="secondary-button" disabled={busy} onClick={() => void technicianSimple("diagnosticBundle", "Diagnostic bundle tanpa PII dibuat.")}><FileText /> Diagnostic Bundle</button></div>
      <Field label="Recovery snapshot"><select value={techBackupId} onChange={(e) => { setTechBackupId(e.target.value); setTechPreview(null); }}>{recoveryRows.length ? recoveryRows.map(row => <option key={String(get(row,"backupId","id"))} value={String(get(row,"backupId","id"))}>{get(row,"kind")} • {dateText(get(row,"createdAt"))} • {get(row,"note") || get(row,"backupId","id")}</option>) : <option value="">Belum ada backup/checkpoint</option>}</select></Field>
      {selectedRecovery && <div className="tech-grid">
        <article><strong>Restore snapshot</strong><p>Preview seluruh full backup atau checkpoint sebelum restore.</p><button className="secondary-button small" disabled={busy} onClick={() => void previewRecovery("BACKUP")}><Eye /> Preview</button></article>
        <article><strong>Pulihkan transaksi hilang</strong><input placeholder="ID Sistem / delivery_id" value={techTransactionId} onChange={(e) => setTechTransactionId(e.target.value)} /><button className="secondary-button small" disabled={busy || String(get(selectedRecovery,"kind")) === "CHECKPOINT"} onClick={() => void previewRecovery("TRANSACTION")}><Search /> Preview</button></article>
        <article><strong>Restore satu field</strong><select value={techCell.sheet} onChange={(e) => setTechCell({ ...techCell, sheet: e.target.value })}><option>DELIVERIES</option><option>DELIVERY_ATTEMPTS</option><option>INCIDENTS</option><option>SERVICE_AREAS</option></select><input placeholder="ID baris" value={techCell.keyValue} onChange={(e) => setTechCell({ ...techCell, keyValue: e.target.value })} /><input placeholder="Nama field, mis. status" value={techCell.field} onChange={(e) => setTechCell({ ...techCell, field: e.target.value })} /><button className="secondary-button small" disabled={busy || String(get(selectedRecovery,"kind")) === "CHECKPOINT"} onClick={() => void previewRecovery("CELL")}><Eye /> Preview</button></article>
      </div>}
      {techPreview && <div className="tech-preview"><strong>Preview Recovery</strong><pre>{JSON.stringify(Object.fromEntries(Object.entries(techPreview).filter(([key]) => !key.startsWith("__"))), null, 2)}</pre><Field label="Konfirmasi" hint={`Ketik persis: ${String(get(techPreview, "requiresConfirmation"))}`}><input value={techConfirmation} onChange={(e) => setTechConfirmation(e.target.value)} /></Field><button className="danger-button" disabled={busy || techConfirmation !== String(get(techPreview, "requiresConfirmation"))} onClick={() => void applyRecovery()}><TriangleAlert /> Terapkan Recovery</button></div>}
      <footer className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => { setTechSession(null); setTechDialog(false); }}>Keluar Mode Teknisi</button></footer>
    </div>}
  </Modal> : null;

  if (active === "accounts") return <div className="content-stack"><SectionTitle title="Akun & Akses" text="Kelola profil, peran, status, dan PIN tanpa pernah menampilkan PIN atau hash." action={<button className="primary-button" onClick={openCreateAccount}><Plus /> Tambah Akun</button>} />
    <div className="table-card account-table"><table><thead><tr><th>Petugas</th><th>Username</th><th>Peran</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{accounts.map((row) => <tr key={rowId(row) || get(row, "username")}><td><strong>{get(row, "name", "Nama")}</strong><small>{get(row, "pinConfigured") ? "PIN tersimpan aman" : "PIN belum tersedia"}</small></td><td><code>{get(row, "username", "Username")}</code></td><td>{get(row, "role", "Role")}</td><td><Badge status={get(row, "active", "Aktif") === false ? "NONAKTIF" : "AKTIF"} /></td><td><div className="row-actions"><button className="secondary-button small" onClick={() => openEditAccount(row)}><Edit3 /> Kelola</button><button className="secondary-button small" onClick={() => openPinAccount(row)}><KeyRound /> Ganti PIN</button></div></td></tr>)}</tbody></table></div>{accountModal}</div>;
  if (active === "areas") return <div className="content-stack"><SectionTitle title="Master Wilayah Pulau Lombok" text={`${areas.length.toLocaleString("id-ID")} Desa/Kelurahan Golden Master. Admin mengatur cakupan dan biaya tanpa menambah/menghapus identitas wilayah.`} />
    <div className="area-toolbar"><div className="filter-line"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari desa, kecamatan, kabupaten…" /></div></div>
    {filteredAreas.length ? <div className="regency-folders">{groupedAreas.map(([regency, rows]) => { const open = Boolean(query.trim()) || expandedRegencies.has(regency); const activeCount = rows?.filter(area => get(area, "coverageStatus") === "AKTIF").length || 0; return <section className={`regency-folder ${open ? "open" : ""}`} key={regency}><button className="regency-folder-head" type="button" onClick={() => toggleRegency(regency)} aria-expanded={open}><span className="folder-icon">{open ? <FolderOpen /> : <Folder />}</span><span><strong>{regency}</strong><small>{rows?.length || 0} Desa/Kelurahan • {activeCount} aktif</small></span><ChevronDown /></button>{open && <div className="area-grid">{rows?.map((a) => { const id = areaKey(a); const policy = String(get(a, "feePolicy")); return <article className="area-card" key={id}><div className="area-card-head"><div><small>{get(a, "district")}</small><h3>{get(a, "village")}</h3><p>Kode {get(a, "kodeWilayah", "officialCode") || id}{get(a, "kodePos", "postalCode") ? ` • Kode Pos ${get(a, "kodePos", "postalCode")}` : ""}</p></div><button className="area-edit" onClick={() => openEditArea(a)} aria-label={`Kelola ${get(a, "village")}`}><Edit3 /></button></div><div><Badge status={String(get(a, "coverageStatus"))} /><span className="fee">{policy === "SUBSIDI" ? `Tarif ${money(get(a, "baseDeliveryFee"))} • Subsidi ${money(get(a, "subsidyAmount"))} • Pasien ${money(get(a, "patientFee"))}` : `${policy} • ${money(get(a, "patientFee"))}`}</span></div></article>; })}</div>}</section>; })}</div> : <Empty icon={<MapPin />} title={areas.length ? "Wilayah tidak ditemukan" : "Master wilayah masih kosong"} text={areas.length ? "Ubah kata pencarian untuk melihat wilayah lain." : "Jalankan seed Master Pulau Lombok lalu muat ulang halaman."} />}{areaModal}</div>;
  if (active === "settings") return <div className="content-stack"><SectionTitle title="Pengaturan Operasional & WhatsApp" text="Admin dapat mengubah pilihan kerja dan seluruh template WhatsApp tanpa membuka source code." />
    <div className="policy-note"><ShieldCheck /><div><strong>Satu sumber pengaturan</strong><p>Perubahan langsung dipakai Farmasi dan Kurir. WhatsApp tetap click-to-chat: petugas memeriksa lalu menekan Buka WhatsApp.</p></div></div>
    <SectionTitle title="Pilihan Operasional" text="Pilihan ini muncul pada modal Pending, Gagal Antar, Selesai, Kendala, dan Verifikasi." />
    <div className="settings-grid">{Object.keys(optionGroups).map(key => <article className="setting-card" key={key}><span><Route /></span><div><h3>{optionLabels[key] || key}</h3><p>{optionGroups[key].length} pilihan</p><small>{optionGroups[key].slice(0, 3).join(" • ")}{optionGroups[key].length > 3 ? " …" : ""}</small></div><button className="secondary-button small" onClick={() => openSetting("OPTIONS", key, optionLabels[key] || key, optionGroups[key])}><Edit3 /> Ubah</button></article>)}</div>
    <SectionTitle title="Template WhatsApp" text="Setiap tindakan memakai template sesuai tahap alur kerja." />
    <div className="template-list">{((operationalSettings.templateDefinitions || []) as Row[]).map(definition => { const key = String(definition.key); return <article className="template-card" key={key}><div><small>{key}</small><h3>{definition.label || key}</h3><p>{templates[key] || "Template belum tersedia."}</p><div className="required-tokens">{((definition.requiredTokens || []) as string[]).map(token => <code key={token}>{"{{" + token + "}}"}</code>)}</div></div><button className="secondary-button small" onClick={() => openSetting("TEMPLATE", key, String(definition.label || key), templates[key] || "")}><Edit3 /> Ubah Template</button></article>; })}</div>{settingModal}</div>;
  if (active === "transactions") return <div className="content-stack"><SectionTitle title="Pencarian & Koreksi" text="Setiap koreksi membutuhkan PIN Admin, alasan, dan menghasilkan audit atomik." /><div className="filter-line"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari kode, pasien, RM, atau wilayah…" /></div><div className="cards-grid">{data.filter((r) => JSON.stringify(r).toLowerCase().includes(query.toLowerCase())).slice(0, 30).map((row) => <DeliveryCard key={rowId(row)} row={row} actions={<button className="secondary-button small" onClick={() => { setCorrectionForm({ status: baseStatusOf(row), note: "", adminPin: "" }); setCorrectionRow(row); }}><Edit3 /> Koreksi</button>} />)}</div>{correctionModal}</div>;
  if (active === "archive") return <div className="content-stack"><SectionTitle title="Archive, Backup & Retention" text="Archive analitik anonim disimpan selama aplikasi digunakan. Cleanup tahunan tidak pernah otomatis tanpa review Admin." /><div className="resilience-grid"><article><span><Archive /></span><h3>Archive KPI</h3><p>Sinkron incremental 15 menit ke workbook archive terpisah, tanpa PII pasien.</p><button className="secondary-button" disabled={busy} onClick={() => void act("adminRunArchiveSync", { requestId: requestId("archive_sync"), batchSize: 100 }, "Archive berhasil disinkronkan.")}><RefreshCw /> Sinkronkan</button></article><article><span><ShieldCheck /></span><h3>Backup</h3><p>Checkpoint ringan 2 jam; full backup harian dan bulanan; PRECHANGE sebelum tindakan sensitif.</p><button className="secondary-button" disabled={busy} onClick={() => { setBackupForm({ note: "Backup PRECHANGE dibuat melalui Dashboard Admin", adminPin: "" }); setBackupDialog(true); }}><ShieldCheck /> Buat PRECHANGE</button></article><article><span><CalendarDays /></span><h3>Annual Cleanup</h3><p>Tahun lama eligible mulai 1 Mei tahun berikutnya. Approval Admin tetap wajib.</p><strong>{get(retention || {}, "eligibleYears")?.length || 0} tahun eligible</strong></article></div><div className="policy-note"><ShieldCheck /><div><strong>Safety gate aktif</strong><p>Archive lengkap, tidak ada workflow aktif, integritas sistem sehat, PRECHANGE backup, typed confirmation, dan audit wajib terpenuhi.</p></div></div>
    <article className="table-card"><SectionTitle title="Retensi per Tahun" text="Status cleanup disimpan sebagai manifest; batch worker hanya bekerja setelah approval." /><table><thead><tr><th>Tahun</th><th>Status</th><th>Archive</th><th>Eligible</th><th>Aksi</th></tr></thead><tbody>{(((retention || {}).years || []) as Row[]).length ? (((retention || {}).years || []) as Row[]).map(row => <tr key={String(row.year)}><td><strong>{row.year}</strong></td><td><Badge status={String(row.status)} /></td><td>{row.archiveStatus || "—"}<small>{row.lastSyncAt ? dateText(row.lastSyncAt) : ""}</small></td><td>{row.eligibleAt || "—"}</td><td>{["ELIGIBLE","BLOCKED","PREPARED","APPROVED","RUNNING"].includes(String(row.status)) ? <button className="secondary-button small" onClick={() => openCleanup(row)}><ShieldCheck /> Tinjau</button> : <span>—</span>}</td></tr>) : <tr><td colSpan={5}>Belum ada tahun operasional yang memerlukan retensi.</td></tr>}</tbody></table></article>
    <div className="advanced-entry"><div><LockKeyhole /><span><strong>Mode Teknisi Lanjutan</strong><small>Restore, repair struktur, pemulihan transaksi hilang, restore field, dan diagnostic bundle.</small></span></div><button className="secondary-button" onClick={() => { setTechSession(null); setTechPin(""); setTechPreview(null); setTechDialog(true); }}><KeyRound /> Buka dengan PIN</button></div>
    {backupModal}{cleanupModal}{techModal}</div>;
  const healthStatus = String(get(health, "status") || "PERLU PERHATIAN");
  const healthOk = healthStatus === "AMAN";
  const healthHeld = healthStatus === "OPERASIONAL DITAHAN";
  return <div className="content-stack"><section className={`health-banner ${healthOk ? "ok" : "bad"}`}><div><span>{healthOk ? <ShieldCheck /> : <TriangleAlert />}</span><div><small>KONDISI SISTEM</small><h2>{healthStatus}</h2><p>{String(get(health, "recommendation") || "Periksa status sistem sebelum melanjutkan.")}</p><small>Backup: {dateText(String(get(health, "lastBackupAt") || "")) || "belum ada"} • Checkpoint: {dateText(String(get(health, "lastCheckpointAt") || "")) || "belum ada"} • Arsip: {String(get(get(health, "archive") || {}, "status") || "—")}</small></div></div><Badge status={healthHeld ? "DITAHAN" : healthOk ? "AMAN" : "PERLU PERHATIAN"} /></section><div className="stats-grid"><StatCard icon={<Users />} label="Akun aktif" value={accounts.filter((a) => get(a, "active", "Aktif") !== false).length} /><StatCard icon={<MapPin />} label="Desa/Kelurahan" value={areas.length} tone="green" /><StatCard icon={<PackageOpen />} label="Transaksi operasional" value={data.length} tone="orange" /><StatCard icon={<Archive />} label="Kebijakan archive" value="KEEP" note="Selama aplikasi digunakan" tone="purple" /></div><SectionTitle title="Pusat kendali Admin" text="Operasi normal dapat dikelola langsung dari aplikasi." /><div className="admin-shortcuts">{navByRole.ADMIN.slice(1).map((n) => <button key={n.id} onClick={() => navigate(n.id)}><span>{n.icon}</span><div><strong>{n.label}</strong><small>Buka pengaturan</small></div><ChevronRight /></button>)}</div></div>;
}

function ManagementView({ active, dashboard, range, setRange, reload }: { active: string; dashboard: Row; range: { startDate: string; endDate: string; reportBasis: string }; setRange: (r: any) => void; reload: () => void }) {
  const kpi = dashboard.kpi || {};
  const daily = dashboard.daily || [];
  const couriers = dashboard.couriers || [];
  const villages = dashboard.villages || [];
  const districts = dashboard.districts || [];
  const regions = dashboard.registrationRegions || [];
  const deliveredRegions = dashboard.deliveredRegions || [];
  const pharmacy = dashboard.pharmacyPerformance?.staff || [];
  const pharmacyTotals = dashboard.pharmacyPerformance?.totals || {};
  const composition = dashboard.composition || {};
  const analytics = dashboard.deliveryAnalytics || {};
  const verification = dashboard.verification || {};
  const incidents = dashboard.incidentSummary || {};
  const failureReasons = dashboard.failureReasons || [];
  const total = Number(kpi.total || 0);
  const delivered = Number(kpi.delivered || 0);
  const verified = Number(dashboard.verification?.verified || 0);
  const finance = dashboard.finance || {};
  const successRate = total ? Math.round(delivered / total * 100) : 0;
  const verificationRate = delivered ? Math.round(verified / delivered * 100) : 0;
  const periodLabel = `${range.startDate.split("-").reverse().join("/")} — ${range.endDate.split("-").reverse().join("/")}`;
  const filters = <div className="management-filter"><Field label="Mulai"><input type="date" value={range.startDate} onChange={(e) => setRange({ ...range, startDate: e.target.value })} /></Field><Field label="Sampai"><input type="date" value={range.endDate} onChange={(e) => setRange({ ...range, endDate: e.target.value })} /></Field><Field label="Basis laporan"><select value={range.reportBasis} onChange={(e) => setRange({ ...range, reportBasis: e.target.value })}><option value="DAFTAR">Tanggal Daftar</option><option value="SELESAI">Tanggal Selesai</option></select></Field><button className="primary-button" onClick={reload}><Search /> Terapkan</button></div>;
  if (active === "performance") return <div className="content-stack">{filters}<SectionTitle title="Kinerja Operasional" text="Ringkasan Kurir dan Farmasi tanpa menampilkan identitas pasien." /><div className="dashboard-grid"><article className="table-card"><SectionTitle title="Kinerja Kurir" text="Keberhasilan, verifikasi, attempt, dan area utama." /><table><thead><tr><th>Kurir</th><th>Terkirim</th><th>Sukses</th><th>Attempt</th><th>Verifikasi</th></tr></thead><tbody>{couriers.map((c: Row) => <tr key={c.name}><td><strong>{c.name}</strong><small>{c.topRegion || "—"}</small></td><td>{c.delivered}</td><td>{c.successRate}%</td><td>{c.totalAttempts}</td><td>{c.verificationRate}%</td></tr>)}</tbody></table></article><article className="table-card"><SectionTitle title="Kinerja Farmasi" text="Aktivitas yang relevan untuk KPI." /><table><thead><tr><th>Petugas</th><th>Daftar</th><th>Siap</th><th>Verifikasi</th></tr></thead><tbody>{pharmacy.map((p: Row) => <tr key={p.name}><td><strong>{p.name}</strong></td><td>{p.registrations}</td><td>{p.ready}</td><td>{p.verifications}</td></tr>)}</tbody></table></article></div></div>;
  if (active === "areas") return <div className="content-stack">{filters}<SectionTitle title="Sebaran Wilayah" text="Drill-down kabupaten/kota, kecamatan, dan Desa/Kelurahan." /><div className="dashboard-grid"><article className="ranking-card"><SectionTitle title="Kabupaten/Kota" />{regions.slice(0, 12).map((v: Row, i: number) => <RankRow key={v.name} item={v} index={i} max={regions[0]?.count} />)}</article><article className="ranking-card"><SectionTitle title="Kecamatan" />{districts.slice(0, 12).map((v: Row, i: number) => <RankRow key={v.name} item={v} index={i} max={districts[0]?.count} />)}</article></div><article className="ranking-card"><SectionTitle title="Desa/Kelurahan" text="Unit pengelompokan rute Kurir dan kebijakan biaya." />{villages.slice(0, 20).map((v: Row, i: number) => <RankRow key={v.name} item={v} index={i} max={villages[0]?.count} />)}</article></div>;
  if (active === "reports") return <div className="content-stack report-page">
    <div className="report-filter">{filters}</div>
    <section className="content-stack management-report">
      <section className="report-hero">
        <div><img className="report-logo" src="./assets/logo-rsud-ntb.webp" alt="Logo RSUD Provinsi NTB" /><span><small>LAPORAN MANAJEMEN MELESAT</small><h2>{periodLabel}</h2><p>Basis {dashboard.meta?.basisLabel || "Tanggal Daftar"} • RSUD Provinsi Nusa Tenggara Barat</p></span></div>
        <div className="report-actions"><button className="primary-button" onClick={() => window.print()}><Printer /> Cetak / Simpan PDF</button></div>
      </section>

      <section className="report-sheet report-sheet--summary">
        <ReportHeading number="01" title="Ringkasan Eksekutif" text="Volume, hasil layanan, verifikasi penerimaan, dan penggunaan sumber daya." />
        <div className="stats-grid report-kpis"><StatCard icon={<PackageOpen />} label="Total layanan" value={total} /><StatCard icon={<PackageCheck />} label="Terkirim" value={delivered} note={`${successRate}% dari total`} tone="green" /><StatCard icon={<ClipboardCheck />} label="Terverifikasi" value={verified} note={`${verificationRate}% dari terkirim`} /><StatCard icon={<Bike />} label="Total attempt" value={Number(analytics.totalAttempts || 0)} tone="purple" /><StatCard icon={<TriangleAlert />} label="Gagal antar" value={Number(kpi.failed || 0)} tone="orange" /><StatCard icon={<Clock3 />} label="Rata-rata proses" value={`${Number(dashboard.timeStats?.average || 0)} menit`} note={`P90 ${Number(dashboard.timeStats?.p90 || 0)} menit`} /></div>
        <div className="report-two-column">
          <ReportTable title="Posisi Layanan" text="Status pada akhir periode laporan." headers={["Status", "Jumlah", "Porsi"]} rows={[
            ["Menunggu diproses", Number(kpi.waiting || 0), reportShare(kpi.waiting, total)],
            ["Siap diantar", Number(kpi.ready || 0), reportShare(kpi.ready, total)],
            ["Dalam perjalanan", Number(kpi.transit || 0), reportShare(kpi.transit, total)],
            ["Terkirim", delivered, reportShare(delivered, total)],
            ["Gagal antar", Number(kpi.failed || 0), reportShare(kpi.failed, total)],
          ]} />
          <ReportTable title="Mutu Penerimaan" text="Verifikasi atas layanan yang sudah diserahkan." headers={["Indikator", "Jumlah", "Keterangan"]} rows={[
            ["Layak diverifikasi", Number(verification.eligible || 0), "Layanan terkirim"],
            ["Dengan kode", Number(verification.code || 0), "Terverifikasi langsung"],
            ["Tanpa kode", Number(verification.manual || 0), "Terverifikasi Farmasi"],
            ["Menunggu verifikasi", Number(verification.pending || 0), "Perlu tindak lanjut"],
            ["Tingkat verifikasi", `${Number(verification.rate || 0)}%`, "Kode + manual"],
          ]} />
        </div>
        <ReportHeading number="02" title="Rekap Pembiayaan" text="Agregat snapshot biaya saat pendaftaran; pembayaran tidak dilakukan kepada Kurir." />
        <div className="stats-grid finance-stats"><StatCard icon={<WalletCards />} label="Tarif asli layanan subsidi" value={money(finance.originalTariff)} note={`${Number(finance.subsidizedServices || 0)} layanan subsidi`} /><StatCard icon={<ShieldCheck />} label="Ditanggung subsidi RSUD" value={money(finance.subsidyAmount)} tone="green" /><StatCard icon={<WalletCards />} label="Tagihan pasien" value={money(finance.patientCharge)} tone="orange" /><StatCard icon={<Check />} label="Diterima di Farmasi" value={money(finance.collectedAtPharmacy)} note={Number(finance.legacyUnverifiedAmount || 0) > 0 ? `${money(finance.legacyUnverifiedAmount)} belum terverifikasi` : "Tercatat lunas"} tone="purple" /></div>
        <ReportTable title="Komposisi Kebijakan Biaya" headers={["Kategori", "Layanan"]} rows={[
          ["Gratis", Number(finance.freeServices || 0)],
          ["Berbayar / ada tagihan pasien", Number(finance.paidServices || 0)],
          ["Menerima subsidi RSUD", Number(finance.subsidizedServices || 0)],
        ]} />
      </section>

      <section className="report-sheet report-sheet--break">
        <ReportHeading number="03" title="Wilayah Terlayani" text="Pemetaan volume untuk perencanaan rute dan kebutuhan Kurir. Seluruh wilayah dengan transaksi pada periode ini ditampilkan." />
        <div className="report-two-column">
          <ReportTable title="Kabupaten/Kota — Pendaftaran" headers={["Wilayah", "Layanan", "Porsi"]} rows={(regions as Row[]).map((row) => [row.name || "Belum ditetapkan", Number(row.count || 0), reportShare(row.count, total)])} empty="Belum ada wilayah pendaftaran." />
          <ReportTable title="Kabupaten/Kota — Terkirim" headers={["Wilayah", "Terkirim", "Porsi"]} rows={(deliveredRegions as Row[]).map((row) => [row.name || "Belum ditetapkan", Number(row.count || 0), reportShare(row.count, delivered)])} empty="Belum ada wilayah yang selesai dilayani." />
        </div>
        <ReportTable title="Kecamatan" text="Seluruh kecamatan yang muncul pada transaksi periode laporan." headers={["Kecamatan", "Layanan", "Porsi"]} rows={(districts as Row[]).map((row) => [row.name || "Belum ditetapkan", Number(row.count || 0), reportShare(row.count, total)])} empty="Belum ada data kecamatan." />
        <ReportTable title="Desa/Kelurahan" text="Seluruh desa/kelurahan yang muncul pada transaksi periode laporan." headers={["Desa/Kelurahan", "Layanan", "Porsi"]} rows={(villages as Row[]).map((row) => [row.name || "Belum ditetapkan", Number(row.count || 0), reportShare(row.count, total)])} empty="Belum ada data desa/kelurahan." />
      </section>

      <section className="report-sheet report-sheet--break">
        <ReportHeading number="04" title="Kinerja Kurir" text="Produktivitas, keberhasilan, verifikasi penerimaan, waktu efektif, insiden, dan wilayah utama." />
        <ReportTable headers={["Kurir", "Attempt", "Terkirim", "Gagal", "Sukses", "Verifikasi", "Rerata", "Insiden", "Wilayah utama"]} rows={(couriers as Row[]).map((row) => [row.name || "Belum ditetapkan", Number(row.totalAttempts || 0), Number(row.delivered || 0), Number(row.failed || 0), `${Number(row.successRate || 0)}%`, `${Number(row.verificationRate || 0)}%`, `${Number(row.timeStats?.average || 0)} mnt`, Number(row.incidents || 0), row.topRegion || "—"])} empty="Belum ada aktivitas Kurir pada periode ini." />
        <ReportHeading number="05" title="Kinerja Farmasi" text="Pendaftaran, penyiapan obat, verifikasi manual, tindak lanjut, dan pengantaran ulang." />
        <ReportTable headers={["Petugas Farmasi", "Daftar", "Siap", "Verifikasi", "Tindak lanjut", "Antar ulang"]} rows={(pharmacy as Row[]).map((row) => [row.name || "Tidak diketahui", Number(row.registrations || 0), Number(row.ready || 0), Number(row.verifications || 0), Number(row.followUps || 0), Number(row.redeliveries || 0)])} footer={["TOTAL", Number(pharmacyTotals.registrations || 0), Number(pharmacyTotals.ready || 0), Number(pharmacyTotals.verifications || 0), Number(pharmacyTotals.followUps || 0), Number(pharmacyTotals.redeliveries || 0)]} empty="Belum ada aktivitas Farmasi pada periode ini." />
      </section>

      <section className="report-sheet report-sheet--break">
        <ReportHeading number="06" title="Evaluasi Pengantaran & Kendala" text="Attempt ulang, pending, penyebab gagal, dan status verifikasi insiden sebagai bahan perbaikan operasional." />
        <div className="stats-grid report-kpis"><StatCard icon={<Route />} label="Sukses attempt pertama" value={Number(analytics.firstAttemptSuccess || 0)} tone="green" /><StatCard icon={<RefreshCw />} label="Attempt pengantaran ulang" value={Number(analytics.redeliveryAttempts || 0)} tone="purple" /><StatCard icon={<PackageCheck />} label="Sukses antar ulang" value={Number(analytics.redeliverySuccess || 0)} /><StatCard icon={<Clock3 />} label="Pending aktif" value={Number(analytics.pendingDeliveries || 0)} tone="orange" /><StatCard icon={<TriangleAlert />} label="Total insiden" value={Number(incidents.total || 0)} tone="orange" /><StatCard icon={<ShieldCheck />} label="Insiden terverifikasi" value={Number(incidents.verified || 0)} tone="green" /></div>
        <div className="report-two-column">
          <ReportTable title="Alasan Gagal Antar" headers={["Alasan", "Jumlah", "Porsi"]} rows={(failureReasons as Row[]).map((row) => [row.name || "Tidak dicatat", Number(row.count || 0), reportShare(row.count, failureReasons.reduce((sum: number, item: Row) => sum + Number(item.count || 0), 0))])} empty="Tidak ada gagal antar pada periode ini." />
          <ReportTable title="Status Insiden Kurir" headers={["Status", "Jumlah"]} rows={[
            ["Aktif", Number(incidents.active || 0)],
            ["Terverifikasi", Number(incidents.verified || 0)],
            ["Tidak terverifikasi", Number(incidents.rejected || 0)],
            ["Menunggu verifikasi", Number(incidents.pending || 0)],
          ]} />
        </div>
        <div className="policy-note report-privacy"><ShieldCheck /><div><strong>Laporan agregat RSUD Provinsi NTB</strong><p>Tidak memuat nama pasien, nomor rekam medis, alamat, nomor telepon, atau data klinis. Dicetak {dateText(new Date().toISOString())}.</p></div></div>
      </section>
    </section>
  </div>;
  return <div className="content-stack management-dashboard"><section className="executive-hero"><div className="executive-copy"><span className="executive-kicker"><Building2 /> RINGKASAN EKSEKUTIF</span><h2>Kinerja layanan pengantaran obat</h2><p>Ikhtisar operasional MELESAT untuk pengambilan keputusan Manajemen RSUD Provinsi NTB.</p><div className="executive-period"><CalendarDays /><span><small>PERIODE LAPORAN</small><strong>{periodLabel}</strong></span></div></div><div className="executive-art"><span>MELESAT</span><img src="./assets/maskot-melesat.png" alt="Maskot MELESAT" /></div></section>
    <div className="management-filter"><Field label="Mulai"><input type="date" value={range.startDate} onChange={(e) => setRange({ ...range, startDate: e.target.value })} /></Field><Field label="Sampai"><input type="date" value={range.endDate} onChange={(e) => setRange({ ...range, endDate: e.target.value })} /></Field><Field label="Basis laporan"><select value={range.reportBasis} onChange={(e) => setRange({ ...range, reportBasis: e.target.value })}><option value="DAFTAR">Tanggal Daftar</option><option value="SELESAI">Tanggal Selesai</option></select></Field><button className="primary-button" onClick={reload}><Search /> Terapkan</button></div>
    <div className="executive-kpis"><ExecutiveKpi icon={<PackageOpen />} label="Total layanan" value={total} note={`${Number(kpi.transit || 0)} dalam perjalanan`} tone="blue" /><ExecutiveKpi icon={<PackageCheck />} label="Terkirim" value={delivered} note={`${successRate}% dari total layanan`} tone="green" /><ExecutiveKpi icon={<ShieldCheck />} label="Terverifikasi" value={verified} note={`${verificationRate}% dari yang terkirim`} tone="teal" /><ExecutiveKpi icon={<WalletCards />} label="Layanan subsidi" value={Number(finance.subsidizedServices || 0)} note={`${money(finance.subsidyAmount)} ditanggung RSUD`} tone="purple" /><ExecutiveKpi icon={<TriangleAlert />} label="Gagal antar" value={Number(kpi.failed || 0)} note="Memerlukan evaluasi layanan" tone="gold" /></div>
    <div className="dashboard-grid"><article className="chart-card"><SectionTitle title="Tren Pengantaran" text={`Basis ${dashboard.meta?.basisLabel || "Tanggal Daftar"}`} />{daily.length ? <ResponsiveContainer width="100%" height={260}><AreaChart data={daily}><defs><linearGradient id="melesatArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0b6fca" stopOpacity={0.35}/><stop offset="95%" stopColor="#0b6fca" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#dfeaec"/><XAxis dataKey="date" tick={{fontSize: 11}}/><YAxis allowDecimals={false} tick={{fontSize: 11}}/><Tooltip/><Area type="monotone" dataKey="total" stroke="#0b6fca" strokeWidth={3} fill="url(#melesatArea)" /></AreaChart></ResponsiveContainer> : <Empty title="Belum ada data periode ini" text="Ubah rentang tanggal untuk melihat tren." />}</article><article className="composition-card"><SectionTitle title="Komposisi Status" text="Posisi transaksi pada periode terpilih." />{Object.entries(composition).map(([key, value]) => { const total = Math.max(Number(kpi.total || 1), 1); return <div className="bar-row" key={key}><span>{key}</span><div><i style={{width: `${Number(value) / total * 100}%`}} /></div><strong>{Number(value)}</strong></div>; })}</article></div>
    <div className="dashboard-grid"><article className="table-card"><SectionTitle title="Kinerja Kurir" text="Ringkasan hasil, verifikasi, dan kendala." /><table><thead><tr><th>Kurir</th><th>Terkirim</th><th>Keberhasilan</th><th>Verifikasi</th></tr></thead><tbody>{couriers.slice(0, 8).map((c: Row) => <tr key={c.name}><td><strong>{c.name}</strong><small>{c.topRegion || "—"}</small></td><td>{c.delivered}</td><td>{c.successRate}%</td><td>{c.verificationRate}%</td></tr>)}</tbody></table></article><article className="ranking-card"><SectionTitle title="Desa/Kelurahan Terlayani" text="Volume pengantaran berdasarkan wilayah tujuan." />{villages.slice(0, 8).map((v: Row, index: number) => <div key={v.name}><span>{index + 1}</span><p><strong>{v.name}</strong><i style={{width: `${Math.max(10, Number(v.count) / Math.max(Number(villages[0]?.count || 1), 1) * 100)}%`}} /></p><em>{v.count}</em></div>)}</article></div>
    {dashboard.meta?.archiveOnly && <div className="policy-note"><Archive /><div><strong>Mode archive-only</strong><p>Periode ini dihitung dari archive KPI anonim; detail operasional lama telah dibersihkan.</p></div></div>}
  </div>;
}

function ExecutiveKpi({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: number; note: string; tone: string }) {
  return <article className={`executive-kpi executive-kpi--${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value.toLocaleString("id-ID")}</strong><p>{note}</p></div></article>;
}

function RankRow({ item, index, max }: { item: Row; index: number; max: number }) {
  return <div><span>{index + 1}</span><p><strong>{item.name || "Belum ditetapkan"}</strong><i style={{ width: `${Math.max(8, Number(item.count) / Math.max(Number(max || 1), 1) * 100)}%` }} /></p><em>{item.count}</em></div>;
}

function reportShare(value: unknown, total: unknown) {
  const denominator = Number(total || 0);
  return denominator > 0 ? `${Math.round(Number(value || 0) / denominator * 1000) / 10}%` : "0%";
}

function ReportHeading({ number, title, text }: { number: string; title: string; text: string }) {
  return <header className="report-heading"><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></header>;
}

function ReportTable({ title, text, headers, rows, footer, empty = "Belum ada data pada periode ini." }: { title?: string; text?: string; headers: string[]; rows: ReactNode[][]; footer?: ReactNode[]; empty?: string }) {
  return <article className="report-table-card">
    {(title || text) && <div className="report-table-title">{title && <h3>{title}</h3>}{text && <p>{text}</p>}</div>}
    <div className="report-table-scroll"><table className="report-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td className="report-empty" colSpan={headers.length}>{empty}</td></tr>}</tbody>{footer && <tfoot><tr>{footer.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr></tfoot>}</table></div>
  </article>;
}

function AppShell({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const [active, setActive] = useState("home");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [busy, setBusy] = useState(true);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [dataUpdatePending, setDataUpdatePending] = useState(false);
  const setRealtime = useCallback((_status: RealtimeStatus) => undefined, []);
  const [deliveries, setDeliveries] = useState<Row[]>([]);
  const [areas, setAreas] = useState<Row[]>([]);
  const [incidents, setIncidents] = useState<Row[]>([]);
  const [incident, setIncident] = useState<Row | null>(null);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [retention, setRetention] = useState<Row | null>(null);
  const [healthy, setHealthy] = useState(true);
  const [adminHealth, setAdminHealth] = useState<Row>({});
  const [dashboard, setDashboard] = useState<Row>({});
  const [operationalOptions, setOperationalOptions] = useState<OperationalOptions>({});
  const [operationalSettings, setOperationalSettings] = useState<Row>({});
  const [range, setRange] = useState({ startDate: monthStart(), endDate: todayKey(), reportBasis: "DAFTAR" });
  const { toast, show } = useToast();

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setBackgroundSyncing(true); else setBusy(true);
    try {
      if (user.role === "MANAJEMEN") {
        const result = await callFunction<Row>("managementData", { ...range, scope: "ALL" });
        setDashboard(result.dashboard || {});
      } else if (user.role === "FARMASI") {
        const workspace = await callFunction<{ rows: Row[]; areas: Row[]; incidents: Row[]; operationalOptions: OperationalOptions }>("pharmacyWorkspaceData");
        setDeliveries(workspace.rows || []); setAreas(workspace.areas || []); setIncidents(workspace.incidents || []); setOperationalOptions(workspace.operationalOptions || {});
      } else if (user.role === "KURIR") {
        const workspace = await callFunction<{ ready: Row[]; mine: Row[]; history: Row[]; incident: Row | null; operationalOptions: OperationalOptions }>("courierWorkspaceData");
        setDeliveries([...(workspace.ready || []), ...(workspace.mine || []), ...(workspace.history || [])]);
        setIncident(workspace.incident || null); setOperationalOptions(workspace.operationalOptions || {});
      } else if (user.role === "ADMIN") {
        const [rowResult, areaResult, accountResult, retentionResult, settingsResult, healthResult] = await Promise.all([
          callFunction<{ rows: Row[] }>("adminRows"), callFunction<{ areas: Row[] }>("adminServiceAreas"),
          callFunction<Row>("adminAccounts"), callFunction<Row>("adminRetentionStatus"), callFunction<Row>("adminOperationalSettings"), callFunction<Row>("adminSystemHealth"),
        ]);
        const accountSummary = accountResult.accounts;
        const accountRows = Array.isArray(accountSummary)
          ? accountSummary
          : Array.isArray(accountSummary?.accounts)
            ? accountSummary.accounts
            : Array.isArray(accountResult.rows)
              ? accountResult.rows
              : [];
        setDeliveries(rowResult.rows || []); setAreas(areaResult.areas || []);
        setAccounts(accountRows); setRetention(retentionResult.retention || retentionResult); setOperationalSettings(settingsResult); setOperationalOptions(settingsResult.optionGroups || {}); setAdminHealth(healthResult.health || healthResult || {});
      }
      setHealthy(true);
    } catch (e) { setHealthy(false); if (!quiet) show("error", e instanceof Error ? e.message : "Data gagal dimuat."); }
    finally { if (quiet) setBackgroundSyncing(false); else setBusy(false); }
  }, [range, show, user.role]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: () => void = () => undefined;
    let timer = 0;
    const quietRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!disposed) void refresh(true); }, 180);
    };
    void subscribeWorkspaceSignals(user.role, quietRefresh, setRealtime).then(stop => { if (disposed) stop(); else unsubscribe = stop; }).catch(() => setRealtime("offline"));
    const onOnline = () => { setRealtime("connecting"); quietRefresh(); };
    const onOffline = () => setRealtime("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { disposed = true; unsubscribe(); window.clearTimeout(timer); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [refresh, user.role]);
  useEffect(() => {
    const handler = (event: Event) => setDataUpdatePending(Boolean((event as CustomEvent<{ pending?: boolean }>).detail?.pending));
    window.addEventListener("melesat:update-pending", handler);
    return () => window.removeEventListener("melesat:update-pending", handler);
  }, []);
  useEffect(() => {
    const context = window.modelContext as { registerTool?: (tool: Row) => void } | undefined;
    if (!context?.registerTool) return;
    try {
      context.registerTool({ name: "melesat_open_section", description: "Membuka bagian tertentu di aplikasi MELESAT.", inputSchema: { type: "object", properties: { section: { type: "string" } }, required: ["section"] }, execute: ({ section }: Row) => { const found = navByRole[user.role].find((n) => n.id === section); if (found) setActive(found.id); return { content: [{ type: "text", text: found ? `Membuka ${found.label}` : "Bagian tidak tersedia untuk peran ini." }] }; } });
    } catch { /* Host tanpa WebMCP penuh tetap aman. */ }
  }, [user.role]);

  const applyMutationResult = useCallback((result: Row) => {
    const record = (result?.record || null) as Row | null;
    if (record && rowId(record)) {
      const id = rowId(record);
      setDeliveries(current => {
        let found = false;
        const next = current.map(row => {
          if (rowId(row) !== id) return row;
          found = true;
          return { ...row, ...record };
        });
        return found ? next : [record, ...next];
      });
    }
    const nextIncident = (result?.incident || null) as Row | null;
    if (Object.prototype.hasOwnProperty.call(result || {}, "incident") && user.role === "KURIR") {
      setIncident(nextIncident && String(get(nextIncident, "status")).toUpperCase() === "AKTIF" ? nextIncident : null);
    }
  }, [user.role]);

  const currentTitle = navByRole[user.role].find((n) => n.id === active)?.label || "MELESAT";
  const badges = useMemo<Record<string, number>>(() => {
    const result: Record<string, number> = {};
    if (user.role === "FARMASI") Object.assign(result, {
      today: deliveries.filter(row => isTodayPharmacyRow(row) && baseStatusOf(row) !== STATUS.DELIVERED).length,
      verify: deliveries.filter(row => String(get(row, "receiptStatus", "Status Verifikasi Penerimaan")).includes("MENUNGGU")).length,
      followup: deliveries.filter(row => ["RETURN_WAITING", "FOLLOW_UP", "REDELIVERY_PLANNED", "SELF_PICKUP_WAITING"].includes(operationalStateOf(row))).length,
      incidents: incidents.length,
    });
    if (user.role === "KURIR") Object.assign(result, {
      ready: deliveries.filter(row => baseStatusOf(row) === STATUS.READY).length,
      "my-tasks": deliveries.filter(row => baseStatusOf(row) === STATUS.TRANSIT).length,
      history: deliveries.filter(row => [STATUS.DELIVERED, STATUS.FAILED].includes(baseStatusOf(row))).length,
      incidents: incident ? 1 : 0,
    });
    return result;
  }, [deliveries, incident, incidents, user.role]);
  function navigate(id: string) { setActive(id); setMobileMenu(false); }
  return <div className={`app-shell app-shell--${user.role.toLowerCase()}`}>
    <div className={mobileMenu ? "sidebar-drawer open" : "sidebar-drawer"}><div className="drawer-backdrop" onClick={() => setMobileMenu(false)} /><Sidebar user={user} active={active} setActive={navigate} onLogout={onLogout} badges={badges} /></div>
    <Sidebar user={user} active={active} setActive={navigate} onLogout={onLogout} badges={badges} />
      <main className="workspace"><Topbar user={user} title={currentTitle} onMenu={() => setMobileMenu(true)} onRefresh={() => void refresh(false)} busy={busy || backgroundSyncing} />{dataUpdatePending && <div className="data-update-banner"><RefreshCw /><span>Data baru tersedia. Perubahan akan diterapkan setelah form atau popup ditutup.</span></div>}<div className="page-content"><ViewBoundary key={`${user.role}:${active}`}>{busy && !deliveries.length && !Object.keys(dashboard).length ? <Loading /> : user.role === "FARMASI" ? <FarmasiView active={active} data={deliveries} areas={areas} incidents={incidents} operationalOptions={operationalOptions} onRefresh={() => void refresh(true)} onMutation={applyMutationResult} navigate={navigate} show={show} /> : user.role === "KURIR" ? <KurirView active={active} data={deliveries} user={user} incident={incident} operationalOptions={operationalOptions} onRefresh={() => void refresh(true)} onMutation={applyMutationResult} navigate={navigate} show={show} /> : user.role === "ADMIN" ? <AdminView active={active} data={deliveries} areas={areas} accounts={accounts} retention={retention} health={adminHealth} currentUser={user} operationalSettings={operationalSettings} onRefresh={() => void refresh(true)} onLogout={onLogout} navigate={navigate} show={show} /> : <ManagementView active={active} dashboard={dashboard} range={range} setRange={setRange} reload={() => void refresh(false)} />}</ViewBoundary></div></main>
    <MobileNav role={user.role} active={active} setActive={navigate} badges={badges} /><ToastView toast={toast} />
  </div>;
}

export function App() {
  const [user, setUser] = useState<AppUser | null>(() => getStoredSession()?.user || null);
  function logout() { clearSession(); setUser(null); }
  return user ? <AppShell user={user} onLogout={logout} /> : <LoginScreen onLogin={setUser} />;
}
