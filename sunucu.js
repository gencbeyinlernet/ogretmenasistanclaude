// Burak TURGUT Okul Takip Sistemi sunucusu.
// Sayfayı sunar, kayıtları veri/ klasöründe JSON olarak tutar, panel şifresiyle korur
// ve yapay zekâ isteklerini .env dosyasındaki anahtarla sağlayıcıya iletir.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { aiAyarlari, aiAkit } from './ai.js';

const KOK = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(KOK, '.env')); } catch { /* .env yoksa ortam değişkenleri kullanılır */ }

const PORT = Number(process.env.PORT) || 3000;
const SIFRE = process.env.PANEL_SIFRESI || '';
const HOST = process.env.HOST || (SIFRE ? '0.0.0.0' : '127.0.0.1');
const VEKIL = process.env.VEKIL_ARKASINDA === '1';
const VERI_DIZINI = path.resolve(KOK, process.env.VERI_DIZINI || 'veri');
const VERI_DOSYASI = path.join(VERI_DIZINI, 'veri.json');
const YEDEK_DIZINI = path.join(VERI_DIZINI, 'yedekler');
const PUBLIC = path.join(KOK, 'public');
const KOLEKSIYONLAR = ['ogrenciler', 'projeler', 'baglantilar'];
const KIMLIK = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const GOVDE_SINIRI = 2 * 1024 * 1024;
const BELGE_SINIRI = 512 * 1024;
const OTURUM_SURESI = 30 * 24 * 60 * 60 * 1000;
const AI = aiAyarlari();

if (!SIFRE && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  console.error('PANEL_SIFRESI tanımlı değil. Sunucuyu dışarıya açmadan önce .env dosyasında bir panel şifresi belirleyin.');
  process.exit(1);
}

/* ── Kayıtlar ── */
let veri = Object.fromEntries(KOLEKSIYONLAR.map(k => [k, {}]));
async function veriYukle() {
  await fsp.mkdir(YEDEK_DIZINI, { recursive: true });
  try {
    const j = JSON.parse(await fsp.readFile(VERI_DOSYASI, 'utf8'));
    KOLEKSIYONLAR.forEach(k => { veri[k] = j[k] && typeof j[k] === 'object' ? j[k] : {}; });
  } catch (e) {
    if (e.code !== 'ENOENT') { console.error(`${VERI_DOSYASI} okunamadı: ${e.message}`); process.exit(1); }
  }
}
async function diskeYaz() {
  const gecici = VERI_DOSYASI + '.tmp';
  await fsp.writeFile(gecici, JSON.stringify(veri));
  try { await fsp.rename(gecici, VERI_DOSYASI); }
  catch { await new Promise(r => setTimeout(r, 150)); await fsp.rename(gecici, VERI_DOSYASI); }
  // Günde bir yedek; son 30 gün saklanır
  const bugun = new Date().toISOString().slice(0, 10), yedek = path.join(YEDEK_DIZINI, `veri-${bugun}.json`);
  if (!fs.existsSync(yedek)) {
    await fsp.copyFile(VERI_DOSYASI, yedek);
    const eski = (await fsp.readdir(YEDEK_DIZINI)).filter(f => /^veri-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -30);
    await Promise.all(eski.map(f => fsp.unlink(path.join(YEDEK_DIZINI, f)).catch(() => {})));
  }
}
let yazmaSirasi = Promise.resolve();
function kaydet() { const p = yazmaSirasi.then(diskeYaz); yazmaSirasi = p.catch(() => {}); return p; }
function birlestir(hedef, kaynak) {
  for (const [k, v] of Object.entries(kaynak)) {
    hedef[k] = v && typeof v === 'object' && !Array.isArray(v) ? birlestir(hedef[k] && typeof hedef[k] === 'object' && !Array.isArray(hedef[k]) ? hedef[k] : {}, v) : v;
  }
  return hedef;
}

/* ── Oturum ── */
async function gizliAnahtar() {
  if (process.env.OTURUM_ANAHTARI) return process.env.OTURUM_ANAHTARI;
  const dosya = path.join(VERI_DIZINI, '.oturum-anahtari');
  try { return (await fsp.readFile(dosya, 'utf8')).trim(); }
  catch { const a = crypto.randomBytes(32).toString('hex'); await fsp.writeFile(dosya, a, { mode: 0o600 }); return a; }
}
let IMZA_ANAHTARI = null;
const imza = v => crypto.createHmac('sha256', IMZA_ANAHTARI).update(v).digest('base64url');
const esit = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const ozet = s => crypto.createHash('sha256').update(String(s)).digest();
function cerezler(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function girisli(req) {
  if (!SIFRE) return true;
  const [bitis, im] = String(cerezler(req).ots || '').split('.');
  return !!bitis && !!im && esit(im, imza(bitis)) && Number(bitis) > Date.now();
}
const guvenli = req => req.socket.encrypted || (VEKIL && String(req.headers['x-forwarded-proto'] || '').startsWith('https'));
const istemciAdresi = req => (VEKIL && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
const denemeler = new Map();
function denemeSiniri(adres) {
  const simdi = Date.now(), d = denemeler.get(adres);
  if (!d || d.bitis < simdi) { denemeler.set(adres, { n: 0, bitis: simdi + 15 * 60 * 1000 }); return false; }
  return d.n >= 10;
}

/* ── Yanıt yardımcıları ── */
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function basliklar(res, ek) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  for (const [k, v] of Object.entries(ek || {})) res.setHeader(k, v);
}
function json(res, durum, govde) {
  basliklar(res, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.writeHead(durum);
  res.end(govde === undefined ? '' : JSON.stringify(govde));
}
function govdeOku(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return reject({ durum: 415, hata: 'İçerik JSON olmalı' });
    let boyut = 0; const parcalar = [];
    req.on('data', p => { boyut += p.length; if (boyut > GOVDE_SINIRI) { reject({ durum: 413, hata: 'İstek çok büyük' }); req.destroy(); } else parcalar.push(p); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parcalar).toString('utf8') || '{}')); } catch { reject({ durum: 400, hata: 'Geçersiz JSON' }); } });
    req.on('error', () => reject({ durum: 400, hata: 'İstek okunamadı' }));
  });
}
const nesneMi = v => v && typeof v === 'object' && !Array.isArray(v);

const TURLER = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
async function statik(req, res, yol) {
  const dosya = path.normalize(path.join(PUBLIC, yol === '/' ? 'index.html' : decodeURIComponent(yol)));
  if (!dosya.startsWith(PUBLIC + path.sep)) return json(res, 404, { hata: 'Bulunamadı' });
  try {
    const icerik = await fsp.readFile(dosya);
    const tur = TURLER[path.extname(dosya).toLowerCase()] || 'application/octet-stream';
    basliklar(res, Object.assign({ 'Content-Type': tur, 'Cache-Control': tur.startsWith('text/html') ? 'no-cache' : 'public, max-age=86400' }, tur.startsWith('text/html') ? { 'Content-Security-Policy': CSP } : {}));
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : icerik);
  } catch { json(res, 404, { hata: 'Bulunamadı' }); }
}

/* ── İstekler ── */
async function yonlendir(req, res) {
  const url = new URL(req.url, 'http://yerel');
  const yol = url.pathname, m = req.method;

  if (!yol.startsWith('/api/')) {
    if (m !== 'GET' && m !== 'HEAD') return json(res, 405, { hata: 'İzin verilmeyen yöntem' });
    return statik(req, res, yol);
  }
  if (yol === '/api/durum' && m === 'GET') {
    return json(res, 200, { uygulama: 'okul-takip', girisGerekli: !!SIFRE, girisYapildi: girisli(req), ai: !!AI, aiSaglayici: AI ? AI.ad : null });
  }
  if (yol === '/api/giris' && m === 'POST') {
    const adres = istemciAdresi(req);
    if (denemeSiniri(adres)) return json(res, 429, { hata: 'Çok fazla deneme' });
    const govde = await govdeOku(req);
    if (!SIFRE || !esit(ozet(govde.sifre || ''), ozet(SIFRE))) { denemeler.get(adres).n++; return json(res, 401, { hata: 'Şifre yanlış' }); }
    denemeler.delete(adres);
    const bitis = String(Date.now() + OTURUM_SURESI);
    res.setHeader('Set-Cookie', `ots=${bitis}.${imza(bitis)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${OTURUM_SURESI / 1000}${guvenli(req) ? '; Secure' : ''}`);
    return json(res, 200, { tamam: true });
  }
  if (yol === '/api/cikis' && m === 'POST') {
    res.setHeader('Set-Cookie', 'ots=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return json(res, 200, { tamam: true });
  }
  if (!girisli(req)) return json(res, 401, { hata: 'Giriş gerekli' });

  if (yol === '/api/veri' && m === 'GET') return json(res, 200, veri);
  if (yol === '/api/yedek' && m === 'GET') {
    basliklar(res, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="okul-takip-yedek-${new Date().toISOString().slice(0, 10)}.json"` });
    res.writeHead(200);
    return res.end(JSON.stringify(veri, null, 2));
  }
  const vm = yol.match(/^\/api\/veri\/([^/]+)\/([^/]+)$/);
  if (vm) {
    const kol = decodeURIComponent(vm[1]), id = decodeURIComponent(vm[2]);
    if (!KOLEKSIYONLAR.includes(kol) || !KIMLIK.test(id)) return json(res, 400, { hata: 'Geçersiz yol' });
    if (m === 'DELETE') { delete veri[kol][id]; await kaydet(); return json(res, 204); }
    if (m !== 'PUT' && m !== 'PATCH') return json(res, 405, { hata: 'İzin verilmeyen yöntem' });
    const govde = await govdeOku(req);
    if (!nesneMi(govde)) return json(res, 400, { hata: 'Belge bir nesne olmalı' });
    if (m === 'PATCH' && !veri[kol][id]) return json(res, 404, { hata: 'Belge yok' });
    const yeni = m === 'PUT' ? govde : birlestir(structuredClone(veri[kol][id]), govde);
    if (Buffer.byteLength(JSON.stringify(yeni)) > BELGE_SINIRI) return json(res, 413, { hata: 'Belge çok büyük' });
    veri[kol][id] = yeni;
    await kaydet();
    return json(res, 200, { tamam: true });
  }
  if (yol === '/api/ai' && m === 'POST') return yapayZeka(req, res);
  return json(res, 404, { hata: 'Bulunamadı' });
}

async function yapayZeka(req, res) {
  if (!AI) return json(res, 503, { hata: 'Yapay zekâ anahtarı tanımlı değil' });
  const govde = await govdeOku(req);
  const prompt = typeof govde.prompt === 'string' ? govde.prompt : '';
  if (!prompt.trim() || Buffer.byteLength(prompt) > 262144) return json(res, 400, { hata: 'İstem boş ya da çok uzun' });
  const ctl = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
  const yaz = parca => {
    if (!res.headersSent) { basliklar(res, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); res.writeHead(200); }
    res.write(parca);
  };
  try {
    await aiAkit(AI, { prompt, json: !!govde.json }, yaz, ctl.signal);
    if (!res.headersSent) yaz('');
    res.end();
  } catch (e) {
    if (e.kod === 'cancelled') return;
    console.error(`[yapay zekâ] ${e.message}`);
    if (!res.headersSent) return json(res, e.durum === 429 ? 429 : 502, { hata: e.message, kod: e.kod });
    res.end('\u0000HATA:' + (e.kod || 'upstream_error'));
  }
}

await veriYukle();
IMZA_ANAHTARI = crypto.createHash('sha256').update((await gizliAnahtar()) + '|' + SIFRE).digest();
const sunucu = http.createServer((req, res) => {
  yonlendir(req, res).catch(e => {
    if (e && e.durum) return json(res, e.durum, { hata: e.hata });
    console.error(e);
    if (!res.headersSent) json(res, 500, { hata: 'Sunucu hatası' }); else res.end();
  });
});
sunucu.listen(PORT, HOST, () => {
  const adres = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`Okul Takip Sistemi çalışıyor: ${adres}`);
  console.log(SIFRE ? 'Panel şifresi etkin.' : 'Panel şifresi yok: sunucu yalnızca bu bilgisayardan açılabilir.');
  console.log(AI ? `Yapay zekâ: ${AI.ad} · ${AI.model}${AI.ad === 'google' && AI.vertex ? ' (Vertex AI express)' : ''}` : 'Yapay zekâ kapalı: .env dosyasına GOOGLE_API_KEY ya da ANTHROPIC_API_KEY ekleyin.');
  console.log(`Kayıtlar: ${VERI_DOSYASI}`);
});
const kapat = () => { sunucu.close(); yazmaSirasi.finally(() => process.exit(0)); };
process.on('SIGINT', kapat);
process.on('SIGTERM', kapat);
