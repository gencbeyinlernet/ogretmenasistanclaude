// Yapay zekâ sağlayıcıları: Google (Gemini API ya da Vertex AI express mode) ve Anthropic (Claude).
// Anahtarlar yalnızca sunucuda, .env dosyasında durur; tarayıcıya hiçbir zaman gönderilmez.

const SERVER_FALLBACK_MODELLERI = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'];

export function aiAyarlari() {
  const secim = (process.env.AI_SAGLAYICI || '').trim().toLowerCase();
  const google = (process.env.GOOGLE_API_KEY || '').trim();
  const anthropic = (process.env.ANTHROPIC_API_KEY || '').trim();
  const googleAyar = () => ({
    ad: 'google',
    anahtar: google,
    model: (process.env.GOOGLE_MODEL || 'gemini-3.5-flash').trim(),
    // Vertex AI express mode anahtarları "AQ." ile başlar; GOOGLE_VERTEX=1/0 ile elle de seçilebilir
    vertex: process.env.GOOGLE_VERTEX ? process.env.GOOGLE_VERTEX === '1' : google.startsWith('AQ.'),
    taban: (process.env.GOOGLE_TABAN_URL || '').trim()
  });
  const anthropicAyar = () => ({ ad: 'anthropic', anahtar: anthropic, model: (process.env.ANTHROPIC_MODEL || 'claude-opus-5-5').trim() });
  if (secim === 'google') return google ? googleAyar() : null;
  if (secim === 'anthropic') return anthropic ? anthropicAyar() : null;
  if (anthropic) return anthropicAyar();
  if (google) return googleAyar();
  return null;
}

class AiHatasi extends Error {
  constructor(kod, durum, mesaj) { super(mesaj || kod); this.kod = kod; this.durum = durum; }
}

// Metni parça parça yaz(parca) ile iletir; hata olursa AiHatasi fırlatır.
export async function aiAkit(ai, istek, yaz, signal) {
  if (ai.ad === 'anthropic') return anthropicAkit(ai, istek, yaz, signal);
  return googleAkit(ai, istek, yaz, signal);
}

let anthropicIstemci = null;
async function anthropicAkit(ai, { prompt }, yaz, signal) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  anthropicIstemci = anthropicIstemci || new Anthropic({ apiKey: ai.anahtar });
  const params = {
    model: ai.model,
    max_tokens: 64000,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: prompt }]
  };
  // Güvenlik sınıflandırıcısı reddederse istek sunucu tarafında uygun bir modele yönlendirilir
  if (SERVER_FALLBACK_MODELLERI.includes(ai.model)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  try {
    const stream = anthropicIstemci.beta.messages.stream(params, { signal });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yaz(event.delta.text);
    }
    const son = await stream.finalMessage();
    if (son.stop_reason === 'refusal') throw new AiHatasi('refused', 502, 'İstek yanıtlanmadı');
  } catch (e) {
    if (e instanceof AiHatasi) throw e;
    if (signal.aborted) throw new AiHatasi('cancelled', 499);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiHatasi('anahtar', 502, 'ANTHROPIC_API_KEY geçersiz ya da yetkisiz');
    if (e instanceof Anthropic.NotFoundError) throw new AiHatasi('model', 502, `Model bulunamadı: ${ai.model}`);
    if (e instanceof Anthropic.RateLimitError) throw new AiHatasi('rate_limited', 429, 'İstek sınırı aşıldı');
    if (e instanceof Anthropic.APIError) throw new AiHatasi('upstream_error', 502, `Anthropic hatası (${e.status}): ${e.message}`);
    throw new AiHatasi('upstream_error', 502, e.message);
  }
}

function googleHatasi(durum, govde) {
  const metin = String(govde || '').slice(0, 400);
  if (durum === 429) return new AiHatasi('rate_limited', 429, 'Google istek sınırı aşıldı');
  if (durum === 401 || durum === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(metin)) return new AiHatasi('anahtar', 502, 'GOOGLE_API_KEY geçersiz ya da bu modele yetkisi yok');
  if (durum === 404) return new AiHatasi('model', 502, 'Model bulunamadı; .env dosyasındaki GOOGLE_MODEL değerini kontrol edin');
  return new AiHatasi('upstream_error', 502, `Google hatası (${durum}): ${metin}`);
}

async function googleAkit(ai, { prompt, json }, yaz, signal) {
  const model = encodeURIComponent(ai.model);
  const taban = ai.taban || (ai.vertex ? 'https://aiplatform.googleapis.com/v1' : 'https://generativelanguage.googleapis.com/v1beta');
  const url = ai.vertex
    ? `${taban}/publishers/google/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(ai.anahtar)}`
    : `${taban}/models/${model}:streamGenerateContent?alt=sse`;
  const govde = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: Object.assign({ maxOutputTokens: 16384 }, json ? { responseMimeType: 'application/json' } : {})
  };
  let r;
  try {
    r = await fetch(url, { method: 'POST', signal, headers: Object.assign({ 'Content-Type': 'application/json' }, ai.vertex ? {} : { 'x-goog-api-key': ai.anahtar }), body: JSON.stringify(govde) });
  } catch (e) {
    if (signal.aborted) throw new AiHatasi('cancelled', 499);
    throw new AiHatasi('upstream_error', 502, 'Google sunucusuna ulaşılamadı: ' + e.message);
  }
  if (!r.ok) throw googleHatasi(r.status, await r.text().catch(() => ''));
  const okuyucu = r.body.getReader(), dec = new TextDecoder();
  let tampon = '', yazildi = false, engellendi = false;
  const satir = s => {
    s = s.trim();
    if (!s.startsWith('data:')) return;
    const veri = s.slice(5).trim();
    if (!veri || veri === '[DONE]') return;
    let j;
    try { j = JSON.parse(veri); } catch (e) { return; }
    if (j.error) throw googleHatasi(j.error.code || 500, JSON.stringify(j.error));
    if (j.promptFeedback && j.promptFeedback.blockReason) engellendi = true;
    const aday = (j.candidates || [])[0];
    if (!aday) return;
    for (const parca of (aday.content && aday.content.parts) || []) {
      if (parca.text && !parca.thought) { yaz(parca.text); yazildi = true; }
    }
    if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(aday.finishReason)) engellendi = true;
  };
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      let i;
      while ((i = tampon.indexOf('\n')) >= 0) { satir(tampon.slice(0, i)); tampon = tampon.slice(i + 1); }
    }
    if (tampon) satir(tampon);
  } catch (e) {
    if (e instanceof AiHatasi) throw e;
    if (signal.aborted) throw new AiHatasi('cancelled', 499);
    throw new AiHatasi('upstream_error', 502, 'Google yanıtı yarıda kesildi: ' + e.message);
  }
  if (engellendi && !yazildi) throw new AiHatasi('refused', 502, 'İstek güvenlik filtresine takıldı');
}
