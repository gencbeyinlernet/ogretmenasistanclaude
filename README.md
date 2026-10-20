# Burak TURGUT Okul Takip Sistemi

Öğrenci takibi, Google Drive bağlantıları, yıllık planlar ve TEKNOFEST / TÜBİTAK proje hazırlama paneli. Projeler adım adım hazırlanır, metin yapay zekâ desteğiyle yazılır ve şablona uygun Word (.docx) dosyası olarak indirilir.

Bu klasör, uygulamayı kendi sunucunuzda çalıştırmak ve GitHub'a yüklemek için gereken her şeyi içerir.

## Klasörde neler var

| Dosya | Görevi |
| --- | --- |
| `public/index.html` | Uygulamanın kendisi (tek sayfa) |
| `public/vendor/jszip.min.js` | Word dosyası oluşturucu; internet yokken de çalışsın diye klasörde durur |
| `sunucu.js` | Sayfayı sunar, kayıtları tutar, panel şifresiyle korur |
| `ai.js` | Yapay zekâ isteklerini Google ya da Anthropic'e iletir |
| `.env.example` | Ayar şablonu |
| `package.json`, `package-lock.json` | Node.js bağımlılıkları |

## Gereksinim

[Node.js](https://nodejs.org) 20.12 ya da üstü (22 LTS önerilir).

## Bilgisayarınızda çalıştırma

1. Terminali bu klasörde açıp bağımlılıkları kurun:

   ```bash
   npm install
   ```

2. Ayar şablonunu `.env` adıyla kopyalayın:

   ```bash
   cp .env.example .env
   ```

   Windows PowerShell'de: `Copy-Item .env.example .env`

3. `.env` dosyasını açıp en az şunları doldurun:
   - `PANEL_SIFRESI`: panele girerken soracağı şifre
   - `GOOGLE_API_KEY` ya da `ANTHROPIC_API_KEY`: yapay zekâ anahtarınız

4. Sunucuyu başlatın:

   ```bash
   npm start
   ```

5. Tarayıcıda `http://localhost:3000` adresini açın.

Terminalde hangi yapay zekâ modelinin kullanıldığı ve kayıtların nerede tutulduğu yazar.

## GitHub'a yükleme

Bu klasörün içeriği deponun kendisidir. Klasörde terminal açıp:

```bash
git init
git add .
git commit -m "Okul Takip Sistemi"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADINIZ/okul-takip-sistemi.git
git push -u origin main
```

`.env` (şifre ve anahtarlar), `veri/` (öğrenci kayıtları) ve `node_modules/` `.gitignore` dosyasında listelidir; GitHub'a gitmez. Depoyu **Private** olarak açmanızı öneririm.

## İnternette yayınlama

GitHub kodu saklar ama Node.js sunucusu çalıştırmaz. Sunucu için Render, Railway, Fly.io gibi bir servis ya da kendi sunucunuz (VPS) gerekir. Servise GitHub deponuzu bağlayıp şunları girin:

- Kurulum komutu: `npm install`
- Başlatma komutu: `npm start`
- Ortam değişkenleri: `PANEL_SIFRESI`, `GOOGLE_API_KEY` (ya da `ANTHROPIC_API_KEY`), `VEKIL_ARKASINDA=1`
- **Kalıcı disk:** Kayıtlar `veri/` klasöründe tutulur. Servisin kalıcı disk özelliğini kullanın ve `VERI_DIZINI` ile o diski gösterin. Kalıcı diski olmayan planlarda kayıtlar her yeniden başlatmada silinebilir.

**GitHub Pages:** Yalnızca `public/` klasörünü yayınlarsanız sayfa sunucusuz açılır: kayıtlar o tarayıcıda tutulur, yapay zekâ kapalı kalır. Öğrenci bilgileri için sunucu sürümünü kullanın.

## Yapay zekâ

- **Google:** `GOOGLE_API_KEY`. "AQ." ile başlayan anahtarlar Vertex AI express mode anahtarı olarak otomatik tanınır; diğerleri Gemini API anahtarı sayılır. Varsayılan model `gemini-3.5-flash`; başka bir model için `GOOGLE_MODEL` yazın.
- **Anthropic (Claude):** `ANTHROPIC_API_KEY`. Varsayılan model `claude-opus-5-5`. Güvenlik filtresi bir isteği reddederse istek sunucu tarafında uygun bir modelle yeniden denenir.
- İki anahtar da varsa `AI_SAGLAYICI` ile hangisinin kullanılacağını seçin.
- Anahtar yalnızca sunucuda durur, tarayıcıya hiç gönderilmez. Bir anahtar herhangi bir yerde açıkça paylaşıldıysa sağlayıcının panelinden iptal edip yenisini oluşturun.

## Kayıtlar ve yedek

- Tüm kayıtlar `veri/veri.json` dosyasındadır. Her gün `veri/yedekler/` klasörüne bir kopya alınır (son 30 gün saklanır).
- Giriş yaptıktan sonra `/api/yedek` adresini açarsanız tüm kayıtlar JSON dosyası olarak iner.
- Geri yüklemek için sunucuyu durdurun, yedek dosyasını `veri/veri.json` adıyla kopyalayın ve yeniden başlatın.

## Güvenlik

- `PANEL_SIFRESI` boşsa sunucu yalnızca bu bilgisayardan açılır; dışarıya açmak için şifre zorunludur.
- Oturum 30 gün sürer. Şifreyi değiştirince açık oturumların hepsi kapanır.
- 15 dakika içinde 10 hatalı şifre denemesinden sonra giriş geçici olarak durur.

## Word şablonları

- **TEKNOFEST:** Proje sunum şablonunun sırası: kapak, takım tanıtımı, özet, problem, çözüm, yöntem, prototip durumu, ticarileşme, özgünlük, hedef kitle, proje takvimi, SWOT, teşekkürler. Her bölüm yeni sayfadan başlar.
- **TÜBİTAK:** 2026–2027 proje yazma şablonu: Times New Roman 12 punto, 2,5 cm kenar boşluğu, tek satır aralığı, iki yana yaslı; yapay zekâ kullanım beyanı ve iş-zaman çizelgesi tablosuyla.

Doldurulması gereken yerler Word dosyasında kırmızı köşeli parantezle görünür.
