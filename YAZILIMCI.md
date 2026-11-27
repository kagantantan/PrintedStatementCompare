# Yazılımcı için çalıştırma notu

Bu not projeyi ilk kez indiren yazılımcı içindir: kurulum, çalıştırma, kurum LLM'ine bağlama ve kodda nereden başlanacağı. Uygulamanın ne yaptığı ve ayarların tamamı için [README.md](README.md).

## 1. Gerekenler

| Gereken | Not |
|---|---|
| Node.js 22.13+ (24 ve sonrası da olur) | `node -v` ile bakın. Node 20 yetmez: PDF kütüphanesi 22.13+ ister. `npm install` yalnızca uyarı verir ama testler geçmez; `npm start` eski sürümü açıkça söyleyip durur. |
| npm | Node ile gelir. |
| npm paket deposuna erişim | İnternet ya da kurumun iç deposu (Nexus, Artifactory). Yalnızca kurulumda gerekir. |
| Güncel bir tarayıcı | Chrome, Edge, Firefox ya da Safari. |

Docker, Python, Java ya da yerel derleyici gerekmez. Uygulama çalışırken internete çıkmaz; tek dış bağlantısı sizin tanımladığınız LLM servisidir.

## 2. Kurulum ve ilk çalıştırma

```bash
git clone <depo adresi>
cd PrintedStatementCompare
npm install
npm run build
npm start
```

Tarayıcıda http://127.0.0.1:8790 adresini açın.

Kurum iç deposu kullanıyorsanız `npm install`'dan önce depoyu tanıtın:

```bash
npm config set registry https://<kurum-deposu>/repository/npm/
```

### Çalıştığını doğrulamak

1. Giriş ekranında **Dönüşüm örneği**'ne tıklayın; iki uydurma ekstre yüklenir.
2. **Karşılaştır**'a basın.
3. Birkaç saniyede "Ekstreler eşdeğer değil: 4 kritik fark var." hükmü ve sayfaların üstünde kutular görünmeli.

Bu adım LLM gerektirmez. Çalışıyorsa kurulum tamamdır.

## 3. Kurum LLM'ine bağlamak

Servisin OpenAI uyumlu olması gerekir (`POST <adres>/chat/completions`).

1. Sağ üstten **Ayarlar**'ı açın.
2. **Servis adresi**: taban adres, genellikle `/v1` ile biter. Örnek: `http://llm.kurum.local/v1`
3. **Bağlantıyı sına**'ya basın; model listesi gelirse **Model** kutusundan seçin.
4. **Anahtar nasıl gönderilsin**: servisi yöneten ekibin söylediği başlık. 401 ya da 403 alırsanız diğer seçenekleri deneyin.
5. Yeniden **Bağlantıyı sına**; "Bağlantı çalışıyor." yazınca **Kaydet**.

Anahtarı ekrana yazmak yerine ortam değişkeniyle de verebilirsiniz; bu durumda hiçbir dosyaya yazılmaz:

```bash
EKSTRE_LLM_ANAHTAR=<anahtar> npm start
```

Windows'ta (komut istemi; bu satırlar elle denenmedi):

```bat
set EKSTRE_LLM_ANAHTAR=<anahtar>
npm start
```

Servis kurum içi bir sertifika kullanıyorsa Node onu tanımaz; kök sertifikayı gösterin:

```bash
NODE_EXTRA_CA_CERTS=/yol/kurum-kok.pem npm start
```

Model yanıttan önce uzun uzun düşünüyorsa (Qwen3 gibi) README'deki "Düşünen modeller" başlığına bakın.

## 4. Ortam değişkenleri ve seçenekler

| Ad | Ne yapar | Varsayılan |
|---|---|---|
| `--port <n>` ya da `EKSTRE_PORT` | Sunucunun portu | 8790 |
| `EKSTRE_LLM_ANAHTAR` | API anahtarı; dosyadaki ve bellekteki anahtardan önceliklidir | yok |
| `EKSTRE_AYAR_KLASORU` | Ayar dosyasının durduğu klasör | `~/.ekstre-karsilastir` |
| `NODE_EXTRA_CA_CERTS` | Node'un tanıyacağı ek kök sertifika | yok |

Ayar dosyası `ayar.json`'dır; elle de düzenlenebilir, açılışta doğrulanır. Anahtarı bu dosyaya yazmayın: uygulama reddeder.

## 5. Geliştirme döngüsü

İki pencere açın:

```bash
npm start
```

```bash
npm run gelistir
```

Arayüzü http://127.0.0.1:5190 adresinden kullanın: Vite değişiklikleri anında yansıtır, API isteklerini 8790'daki sunucuya yönlendirir. Sunucu kodunu değiştirince `npm start`'ı yeniden başlatın (izleme modu yok).

Bir değişikliği bitmiş saymadan önce:

```bash
npm run typecheck && npm test && npm run build
```

| Komut | Ne yapar |
|---|---|
| `npm test` | Bütün testler. Ağa çıkmaz; LLM yerine sahte bir sunucu açar. |
| `npx vitest run sunucu/test/fark.test.ts` | Tek test dosyası |
| `npx tsx sunucu/test/yardimci/dene.ts a.pdf b.pdf` | Arayüzsüz, LLM'siz karşılaştırma; ham farkları terminale yazar |
| `npm run duman` | Uygulamayı gerçekten açar ve örnek ekstreleri LLM'siz karşılaştırır; kurulumun sağlam olduğunu tek komutla gösterir (önce `npm run build`) |
| `npm run ornek` | `ornekler/` altındaki uydurma PDF'leri yeniden üretir |

## 6. Kodda nereden başlanır

Bir karşılaştırmanın yolu tek fonksiyondadır: `sunucu/src/analiz.ts` içindeki `karsilastir`. Oradan aşağı inin.

| Yapmak istediğiniz | Bakacağınız yer |
|---|---|
| Bir fark neden bulunmadı ya da yanlış sınıflandı | `sunucu/src/fark.ts`: `farkBul` (eşleştirme), `sinifla` (tür), `onemBelirle` (önem) |
| PDF'ten metin yanlış bölünüyor | `sunucu/src/pdf.ts`: `parcala` |
| Tutar ya da tarih tanınmıyor | `sunucu/src/metin.ts`: `sayiCoz`, `tarihCoz` |
| LLM'e giden metni değiştirmek | `sunucu/src/istem.ts` |
| LLM yanıtının nasıl denetlendiği, hüküm | `sunucu/src/analiz.ts`: `yanitiIsle`, `hukumVer` |
| Servise bağlantı, hata mesajları | `sunucu/src/llm.ts` |
| Yeni bir ayar eklemek | `sunucu/src/tipler.ts` (tip), `sunucu/src/ayarlar.ts` (varsayılan ve doğrulama), `arayuz/src/Ayarlar.tsx` (ekran), README (belge) |
| Görüntü farkının eşiği | `arayuz/src/belge.ts`: `OLCEK`, `HUCRE`, `ESIK` |
| Ekranlar | `arayuz/src/Giris.tsx`, `Sonuc.tsx`, `Ayarlar.tsx` |

Sunucu ile arayüzün paylaştığı bütün veri biçimleri `sunucu/src/tipler.ts` dosyasındadır; arayüz onu yalnızca tip olarak içe alır.

## 7. Uyulacak kurallar

- **Gerçek ekstre depoya girmez.** Denemek için `gercek/` klasörünü kullanın; `.gitignore` onu dışarıda tutar. Örnekler ve testler uydurma veriyle çalışır.
- **Anahtar hiçbir yere yazılmaz:** ayar dosyasına, koda, günlüğe, API yanıtına, hata mesajına. Bunu koruyan testler var (`sunucu/test/sunucu.test.ts`, `llm.test.ts`); gevşetmeyin.
- **LLM'e güven sınırı gevşetilmez.** `analiz.ts`'in başındaki kurallar (LLM fark silemez, uyduramaz, dönüşümde önemi düşüremez, türleri karıştıramaz) testlerle korunur. Bunları değiştiren bir iş ayrıca konuşulmalı.
- **Testler ağa çıkmaz.** LLM gerektiren test `sunucu/test/yardimci/ortam.ts` içindeki `sahteLlm` ile yazılır.
- **Davranış değişikliği test ister.** Yeni fark türü, yeni kural, yeni hata mesajı: önce testi.
- **Dil:** tanımlayıcılar, yorumlar, ekran metinleri ve test adları Türkçe; yerleşmiş teknik terimler İngilizce kalır.
- **Belge:** yeni ayar ya da hata mesajı eklediğinizde README'nin ilgili tablosunu güncelleyin.

## 8. Bilinmesi gerekenler

- Proje gerçek bir eski/yeni ekstre çiftiyle henüz denenmedi. İlk gerçek denemede en olası sorun, iki sistemin farklı yazı tipi ve çizim motoru kullanması yüzünden çok sayıda "kayma" bulgusudur; Ayarlar'daki konum toleransıyla başlayın, yetmezse `fark.ts`'teki eşleştirme eşiklerine bakın.
- Metnin rengi ve kalınlığı karşılaştırılmıyor; toplu (çok dosyalı) çalıştırma yok. Sınırların tamamı README'de.
- Windows: kurulum, testler, derleme ve sunucunun açılışı her gönderimde GitHub'ın Windows makinesinde otomatik sınanıyor. Ekran bir Windows tarayıcısında elle denenmedi. Anahtar dosyasının "yalnızca sahibi okur" izni Windows'ta uygulanmaz.
- Arayüzün otomatik testi yok; ekran değişikliklerini elle deneyin.
