const PAGE_W = 1240;
const PAGE_H = 1754;
const RENDER_SCALE = 2;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FONT = 'Arial, Helvetica, sans-serif';
const COLORS = Object.freeze({
  ink:'#0b2834', muted:'#667982', line:'#d6e2e5', navy:'#052d39', teal:'#0a6f79', pale:'#f4f8f9',
  success:'#177451', successSoft:'#edf8f2', warning:'#9a6100', warningSoft:'#fff7e7', danger:'#b33a43', dangerSoft:'#fff0f1'
});

function n(value) { return Number(value || 0).toLocaleString('id-ID'); }
function pct(value) { return `${(Number(value || 0) * 100).toFixed(1)}%`; }
function minutes(value) { return `${n(value)} menit`; }
function fmtDate(value) {
  if (!value) return '-';
  const [y,m,d] = String(value).slice(0,10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(value);
}
function clean(value) { return String(value ?? '').replace(/[\u2013\u2014]/g,'-'); }
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
function wrap(ctx, text, maxWidth) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = words[0];
  for (let i=1;i<words.length;i++) {
    const test = `${line} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else { lines.push(line); line = words[i]; }
  }
  lines.push(line);
  return lines;
}
function roundedRect(ctx,x,y,w,h,r,fill,stroke) {
  const rr = Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr);
  if (fill) { ctx.fillStyle=fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=1; ctx.stroke(); }
}
class Painter {
  constructor(meta, logo, minStatsSample) {
    this.meta = meta || {};
    this.logo = logo;
    this.minStatsSample = Math.max(2, Number(minStatsSample || 10));
    this.pages = [];
    this.page = null;
    this.ctx = null;
    this.y = 0;
    this.newPage(true);
  }
  newPage(first=false) {
    const canvas = document.createElement('canvas'); canvas.width=PAGE_W*RENDER_SCALE; canvas.height=PAGE_H*RENDER_SCALE;
    const ctx = canvas.getContext('2d'); ctx.scale(RENDER_SCALE,RENDER_SCALE); ctx.fillStyle='#fff'; ctx.fillRect(0,0,PAGE_W,PAGE_H);
    this.pages.push(canvas); this.page=canvas; this.ctx=ctx;
    this.y = first ? this.drawMainHeader() : this.drawContinuationHeader();
  }
  font(size=22, weight=400) { this.ctx.font = `${weight} ${size}px ${FONT}`; this.ctx.fillStyle=COLORS.ink; }
  drawMainHeader() {
    const ctx=this.ctx, y=55;
    if (this.logo) ctx.drawImage(this.logo,MARGIN,y,82,82);
    this.font(21,700); ctx.fillText('RSUD Provinsi Nusa Tenggara Barat',MARGIN+100,y+26);
    this.font(31,800); ctx.fillText('Laporan Layanan Pengantaran Obat Gratis',MARGIN+100,y+64);
    this.font(16,400); ctx.fillStyle=COLORS.muted;
    const basis = this.meta.basis === 'SELESAI' ? 'Tanggal Pengantaran Selesai' : 'Tanggal Pendaftaran';
    ctx.fillText(`Periode ${fmtDate(this.meta.start)} - ${fmtDate(this.meta.end)}  |  Hitung berdasarkan ${basis}`,MARGIN+100,y+92);
    ctx.strokeStyle=COLORS.teal; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(MARGIN,y+120); ctx.lineTo(PAGE_W-MARGIN,y+120); ctx.stroke();
    return y+150;
  }
  drawContinuationHeader() {
    const ctx=this.ctx, y=46;
    this.font(15,700); ctx.fillStyle=COLORS.navy; ctx.fillText('RSUD Provinsi Nusa Tenggara Barat - Laporan Pengantaran Obat',MARGIN,y);
    ctx.strokeStyle=COLORS.line; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(MARGIN,y+18); ctx.lineTo(PAGE_W-MARGIN,y+18); ctx.stroke();
    return y+46;
  }
  ensure(height) { if (this.y + height > PAGE_H - 92) this.newPage(false); }
  section(title, estimated=70) {
    this.ensure(estimated);
    this.y += 12; this.font(21,800); this.ctx.fillStyle=COLORS.navy; this.ctx.fillText(clean(title),MARGIN,this.y+22);
    this.y += 40;
  }
  cards(items, cols=3) {
    const gap=14, w=(CONTENT_W-gap*(cols-1))/cols, h=92;
    for (let i=0;i<items.length;i+=cols) {
      this.ensure(h+18);
      for (let c=0;c<cols;c++) {
        const item=items[i+c]; if(!item) continue;
        const x=MARGIN+c*(w+gap), tone=item.tone||'';
        const accent = tone==='success'?COLORS.success:tone==='warning'?COLORS.warning:tone==='danger'?COLORS.danger:COLORS.teal;
        roundedRect(this.ctx,x,this.y,w,h,12,'#fff',COLORS.line);
        this.ctx.fillStyle=accent; this.ctx.fillRect(x,this.y,4,h);
        this.font(12,700); this.ctx.fillStyle=COLORS.muted; this.ctx.fillText(clean(item.label).toUpperCase(),x+18,this.y+24);
        this.font(27,800); this.ctx.fillStyle=COLORS.ink; this.ctx.fillText(clean(item.value),x+18,this.y+57);
        if (item.note) { this.font(11,400); this.ctx.fillStyle=COLORS.muted; this.ctx.fillText(clean(item.note),x+18,this.y+77); }
      }
      this.y += h+14;
    }
  }
  timeCards(stats={}) {
    const items=[
      ['Total Waktu Layanan',stats.total],['Pendaftaran hingga Siap Diantar',stats.pharmacy],['Menunggu Diambil Kurir',stats.consolidation],['Durasi Penyelesaian Pengantaran',stats.courier]
    ];
    const gap=14, cols=2, w=(CONTENT_W-gap)/2;
    for(let i=0;i<items.length;i+=2){
      this.ensure(148);
      for(let c=0;c<2;c++){
        const [label,x]=items[i+c]||[]; if(!label) continue; const sample=Number(x?.sample||0), px=MARGIN+c*(w+gap);
        roundedRect(this.ctx,px,this.y,w,132,12,COLORS.pale,COLORS.line);
        this.font(14,800); this.ctx.fillStyle=COLORS.navy; this.ctx.fillText(label,px+18,this.y+26);
        if(!sample){ this.font(18,700); this.ctx.fillStyle=COLORS.muted; this.ctx.fillText('Belum ada data',px+18,this.y+64); }
        else if(sample < this.minStatsSample){
          this.font(13,700); this.ctx.fillStyle=COLORS.ink; this.ctx.fillText(`Mean (rata-rata): ${minutes(x.average)}`,px+18,this.y+58);
          this.font(11,400); this.ctx.fillStyle=COLORS.muted; this.ctx.fillText(`${n(sample)} pengantaran dianalisis. Median/P90 belum cukup data.`,px+18,this.y+84);
        } else {
          this.font(12,700); this.ctx.fillStyle=COLORS.ink; this.ctx.fillText(`Mean (rata-rata): ${minutes(x.average)}`,px+18,this.y+50);
          this.ctx.fillText(`Median (nilai tengah): ${minutes(x.median)}`,px+18,this.y+76);
          this.ctx.fillText(`P90 (90% selesai dalam): <= ${minutes(x.p90)}`,px+18,this.y+102);
          this.font(10,400); this.ctx.fillStyle=COLORS.muted; this.ctx.fillText(`${n(sample)} pengantaran dianalisis`,px+18,this.y+122);
        }
      }
      this.y += 146;
    }
  }
  table(title, headers, rows, widths=null) {
    this.section(title,110);
    if(!rows.length){ this.font(14,400); this.ctx.fillStyle=COLORS.muted; this.ctx.fillText('Belum ada data pada periode ini.',MARGIN,this.y+10); this.y+=36; return; }
    const total=widths ? widths.reduce((a,b)=>a+b,0) : headers.length;
    const ws = widths ? widths.map(v=>CONTENT_W*v/total) : headers.map(()=>CONTENT_W/headers.length);
    const drawHeader=()=>{
      const h=38; this.ensure(h+42); let x=MARGIN;
      headers.forEach((head,i)=>{ this.ctx.fillStyle='#eaf3f5'; this.ctx.fillRect(x,this.y,ws[i],h); this.ctx.strokeStyle=COLORS.line; this.ctx.strokeRect(x,this.y,ws[i],h); this.font(11,800); this.ctx.fillStyle=COLORS.navy; this.ctx.fillText(clean(head),x+8,this.y+24); x+=ws[i]; });
      this.y+=h;
    };
    drawHeader();
    rows.forEach(row=>{
      this.font(11,400);
      const wrapped=row.map((cell,i)=>wrap(this.ctx,clean(cell),ws[i]-16));
      const maxLines=Math.max(...wrapped.map(x=>x.length)); const h=Math.max(34,14+maxLines*16);
      if(this.y+h>PAGE_H-92){ this.newPage(false); this.font(18,800); this.ctx.fillStyle=COLORS.navy; this.ctx.fillText(`${clean(title)} (lanjutan)`,MARGIN,this.y+18); this.y+=34; drawHeader(); }
      let x=MARGIN;
      wrapped.forEach((lines,i)=>{ this.ctx.strokeStyle=COLORS.line; this.ctx.strokeRect(x,this.y,ws[i],h); this.font(11,400); this.ctx.fillStyle=COLORS.ink; lines.forEach((line,j)=>this.ctx.fillText(line,x+8,this.y+21+j*16)); x+=ws[i]; });
      this.y+=h;
    });
    this.y+=12;
  }
  finalize() {
    const total=this.pages.length;
    this.pages.forEach((canvas,index)=>{
      const ctx=canvas.getContext('2d'); ctx.font=`400 11px ${FONT}`; ctx.fillStyle=COLORS.muted;
      const left=`Periode ${fmtDate(this.meta.start)} - ${fmtDate(this.meta.end)}`; ctx.fillText(left,MARGIN,PAGE_H-42);
      const right=`Halaman ${index+1} dari ${total}`; const w=ctx.measureText(right).width; ctx.fillText(right,PAGE_W-MARGIN-w,PAGE_H-42);
    });
  }
}

function dataUrlBytes(dataUrl) {
  const b64=dataUrl.split(',')[1]; const raw=atob(b64); const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out;
}
function enc(text){ return new TextEncoder().encode(text); }
function concat(chunks){ const len=chunks.reduce((s,c)=>s+c.length,0), out=new Uint8Array(len); let p=0; chunks.forEach(c=>{out.set(c,p);p+=c.length;}); return out; }
function pdfFromJpegs(jpegs, title='Laporan Pengantaran Obat') {
  const pageCount=jpegs.length, pageW=595.28, pageH=841.89;
  const infoObj=3+pageCount*3;
  const objectCount=infoObj;
  const objects=new Array(objectCount+1);
  objects[1]=enc('<< /Type /Catalog /Pages 2 0 R >>');
  const kids=[];
  for(let i=0;i<pageCount;i++) kids.push(`${3+i*3} 0 R`);
  objects[2]=enc(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`);
  for(let i=0;i<pageCount;i++){
    const pageObj=3+i*3, imgObj=pageObj+1, contentObj=pageObj+2, bytes=dataUrlBytes(jpegs[i]);
    objects[pageObj]=enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${i+1} ${imgObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    objects[imgObj]=concat([enc(`<< /Type /XObject /Subtype /Image /Width ${PAGE_W*RENDER_SCALE} /Height ${PAGE_H*RENDER_SCALE} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`),bytes,enc('\nendstream')]);
    const cmd=`q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im${i+1} Do\nQ\n`; const cb=enc(cmd);
    objects[contentObj]=concat([enc(`<< /Length ${cb.length} >>\nstream\n`),cb,enc('endstream')]);
  }
  const safeTitle=clean(title).replace(/[()\\]/g,' ');
  objects[infoObj]=enc(`<< /Title (${safeTitle}) /Producer (Pengantaran Obat Gratis RSUD Provinsi NTB) >>`);
  const chunks=[enc('%PDF-1.4\n%\u00ff\u00ff\u00ff\u00ff\n')];
  const offsets=new Array(objectCount+1).fill(0); let offset=chunks[0].length;
  for(let i=1;i<=objectCount;i++){
    offsets[i]=offset; const part=concat([enc(`${i} 0 obj\n`),objects[i],enc('\nendobj\n')]); chunks.push(part); offset+=part.length;
  }
  const xrefOffset=offset;
  let xref=`xref\n0 ${objectCount+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objectCount;i++) xref += `${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  const trailer=`trailer\n<< /Size ${objectCount+1} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(enc(xref+trailer));
  return new Blob([concat(chunks)],{type:'application/pdf'});
}

export async function buildManagementPdf(data,{logoUrl='./icons/logo-rsud.png',minimumStatsSample=10}={}) {
  let logo=null; try { logo=await loadImage(logoUrl); } catch(_) {}
  const d=data||{}, k=d.kpi||{}, v=d.verification||{}, inc=d.incidentSummary||{}, pharm=d.pharmacyPerformance||{staff:[]}, p=new Painter(d.meta||{},logo,minimumStatsSample);
  p.section('Key Performance Indicator (KPI)',115);
  p.cards([
    {label:'Total Pendaftaran',value:n(k.total)},
    {label:'Terkirim',value:n(k.delivered),tone:'success'},
    {label:'Gagal Antar',value:n(k.failed),tone:'danger'},
    {label:'Tingkat Keberhasilan',value:pct(k.successRate)},
    {label:'Penerimaan Terverifikasi',value:pct(v.rate)},
    {label:'Kendala Aktif',value:n(inc.active||0),note:`${n(inc.total||0)} kendala tercatat`,tone:Number(inc.active||0)?'warning':''}
  ]);
  p.section('Waktu Layanan',155); p.timeCards(d.timeStats||{});
  if(Array.isArray(d.activeIncidents)&&d.activeIncidents.length){
    p.table('Kendala Aktif',['Kurir','Kendala','Perkiraan','Paket','Wilayah'],d.activeIncidents.map(x=>[x.courier||'-',[x.type||'-',x.detail||''].filter(Boolean).join(' - '),x.delayEstimate||'-',n(x.affectedCount||0),Array.isArray(x.affectedAreas)?(x.affectedAreas.join(', ')||'-'):(x.affectedAreas||'-')]),[1.1,1.8,1.2,.7,1.8]);
  }
  p.table('Kinerja Farmasi',['Petugas','Pendaftaran','Siap','Verifikasi','Tindak Lanjut','Pengantaran Ulang'],(pharm.staff||[]).map(x=>[x.name,n(x.registrations),n(x.ready),n(x.verifications),n(x.followUps),n(x.redeliveries)]),[1.8,1,1,1,1.2,1.3]);
  p.table('Kinerja Kurir',['Kurir','Selesai','Terkirim','Gagal','Keberhasilan','Kendala'],(d.couriers||[]).map(x=>[x.name,n(Number(x.delivered||0)+Number(x.failed||0)),n(x.delivered),n(x.failed),pct(x.successRate),n(x.incidents)]),[1.8,1,1,1,1.2,1]);
  const a=d.deliveryAnalytics||{};
  p.section('Pengantaran Ulang',115);
  p.cards([
    {label:'Total Pengantaran',value:n(a.total)}, {label:'Berhasil Diantar',value:n(a.delivered),tone:'success'}, {label:'Gagal Diantar',value:n(a.failed),tone:'danger'},
    {label:'Kasus Pengantaran Ulang',value:n(a.retriedCases)}, {label:'Pengantaran Ulang Berhasil',value:n(a.retryDelivered),tone:'success'}, {label:'Ambil Mandiri',value:n(a.selfPickup)}
  ]);
  p.table('Wilayah Terkirim',['Kabupaten/Kota','Jumlah'],(d.deliveredRegions||[]).slice(0,15).map(x=>[x.name,n(x.count)]),[4,1]);
  p.table('Alasan Gagal Antar',['Alasan','Jumlah'],(a.failureReasons||d.failureReasons||[]).slice(0,20).map(x=>[x.name,n(x.count)]),[4,1]);
  p.finalize();
  const jpegs=p.pages.map(c=>c.toDataURL('image/jpeg',0.98));
  const title=`Laporan Pengantaran Obat ${fmtDate(d.meta?.start)} - ${fmtDate(d.meta?.end)}`;
  return pdfFromJpegs(jpegs,title);
}

export function reportFilename(data) {
  const start=String(data?.meta?.start||'').replaceAll('-',''); const end=String(data?.meta?.end||'').replaceAll('-','');
  return `Laporan_Pengantaran_Obat_${start || 'periode'}${end && end!==start ? `_${end}` : ''}.pdf`;
}

export function downloadPdfBlob(blob, filename) {
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename||'Laporan_Pengantaran_Obat.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
}
