# Servis API'si (v1)

Başka uygulamaların Ekstre Karşılaştır'ı ağdan çağırması içindir. İki PDF gönderilir, bir iş numarası alınır, sonuç sonra sorulur.

- Taban adres: `http://<sunucu>:8790/api/v1`
- Biçim: JSON (`content-type: application/json`), UTF-8
- Kimlik doğrulama: her istekte servis anahtarı (sağlık ucu hariç)

Arayüzün kullandığı `/api/karsilastir`, `/api/ayar` gibi uçlar bu belgenin kapsamında değildir: yalnızca sunucunun çalıştığı bilgisayardan çağrılabilir ve sürümler arasında değişebilir.

## Sunucuyu servis olarak açmak

Varsayılan kurulum yalnızca kendi bilgisayarını dinler. Ağa açmak iki şey ister; ikincisi yoksa sunucu başlamaz.

1. Servis anahtarı üretin (çağıran her uygulama için ayrı bir tane):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

2. Anahtarları tanıtın ve dinlenecek adresi verin:

```bash
EKSTRE_SERVIS_ANAHTARLARI=<anahtar1>,<anahtar2> npm start -- --dinle 0.0.0.0
```

Anahtarları ortam değişkeni yerine ayar klasöründeki `servis-anahtarlari` dosyasına da yazabilirsiniz (her satıra bir anahtar; `#` ile başlayan satır yorumdur).

| Ayar | Ne yapar | Varsayılan |
|---|---|---|
| `--dinle <adres>` ya da `EKSTRE_DINLE` | Dinlenecek adres. `0.0.0.0` bütün ağ arayüzleri demektir. | `127.0.0.1` |
| `EKSTRE_SERVIS_ANAHTARLARI` | Virgülle ayrılmış servis anahtarları; her biri en az 24 karakter | yok |
| `EKSTRE_ES_ZAMANLI` | Aynı anda çalışan iş sayısı | 1 |
| `EKSTRE_AZAMI_SIRA` | Sırada bekleyebilecek en fazla iş | 20 |
| `EKSTRE_SONUC_OMRU_DK` | Biten işin sonucunun saklanma süresi (dakika) | 30 |

Bilinmesi gerekenler:

- **Bağlantı şifresizdir (HTTP).** Ekstreler ağdan geçeceği için sunucunun önüne TLS sonlandıran bir vekil (nginx, IIS, kurumun API geçidi) koyun. Uygulamanın kendi TLS desteği yoktur.
- **Servis anahtarı LLM anahtarı değildir.** Servis anahtarı bu servisi çağıranı tanır; LLM anahtarı bu servisin kurum LLM'ine bağlanırken kullandığıdır.
- **LLM ayarı tektir ve sunucuda yapılır.** Çağıran uygulama LLM adresini ya da modelini değiştiremez. Ayarlar ekranı yalnızca sunucunun kendi bilgisayarından (`http://127.0.0.1:8790`) açılır.
- **Eş zamanlı iş sayısını LLM'e göre seçin.** LLM tek istek işliyorsa 1 bırakın; artırmak işleri hızlandırmaz, yalnızca LLM'de sıraya sokar.
- **İşler bellekte durur.** Sunucu yeniden başlarsa sıradaki ve bitmiş işler kaybolur; çağıran uygulama 404 alırsa işi yeniden göndermelidir.

## Kimlik doğrulama

Anahtar iki başlıktan biriyle gönderilir:

```
Authorization: Bearer <servis anahtarı>
```

```
x-api-key: <servis anahtarı>
```

Anahtar yoksa ya da yanlışsa yanıt `401` olur. Bir işi yalnızca onu gönderen anahtar görebilir ve silebilir; başka anahtar için o iş "yok"tur (`404`).

## Uçlar

| Yöntem | Yol | Ne yapar | Başarılı yanıt |
|---|---|---|---|
| `GET` | `/saglik` | Sunucu ayakta mı (anahtarsız) | `200` |
| `POST` | `/karsilastirmalar` | Yeni karşılaştırma işi | `202` + iş |
| `GET` | `/karsilastirmalar/{kimlik}` | İşin durumu ve bittiyse raporu | `200` + iş |
| `DELETE` | `/karsilastirmalar/{kimlik}` | İşi ve sonucunu siler | `204` |

### `POST /karsilastirmalar`

İstek gövdesi:

| Alan | Tür | Zorunlu | Açıklama |
|---|---|---|---|
| `mod` | `"donusum"` ya da `"sablon"` | evet | Dönüşüm karşılaştırma ya da şablon fark analizi |
| `a` | `{ "ad": string, "pdf_base64": string }` | evet | Eski sistem ya da referans şablon. `ad` raporda görünen dosya adıdır. |
| `b` | `{ "ad": string, "pdf_base64": string }` | evet | Yeni sistem ya da yeni şablon |
| `not` | string | hayır | `donusum`: bilinen, kabul edilen farklar. `sablon`: istenen değişiklikler. En fazla 4000 karakter; LLM gerektirir. |
| `yalniz_yapi` | boolean | hayır | Yalnızca `sablon`: iki belgedeki veriler farklı, rakam ve tarihleri karşılaştırma |
| `llm` | boolean | hayır | `false` ise LLM çağrılmaz; yalnızca makine farkları döner (saniyeler sürer) |
| `gorsel_fark` | boolean | hayır | `false` ise sayfa görüntüleri karşılaştırılmaz; yalnızca metin |

Sınırlar: gövde en fazla 150 MB, belge en fazla 200 sayfa; görüntü farkı ilk 60 sayfada aranır. Yalnızca PDF kabul edilir.

Yanıt `202 Accepted`; `Location` başlığı işin adresidir:

```json
{
  "kimlik": "0b7d0c1e-5a53-4c0e-9d2b-6a1f1f4d2c11",
  "durum": "sirada",
  "sira": 1,
  "olusturma": "2026-11-27T12:00:00.000Z"
}
```

### `GET /karsilastirmalar/{kimlik}`

| `durum` | Anlamı |
|---|---|
| `sirada` | Bekliyor; `sira` kaçıncı olduğunu söyler |
| `calisiyor` | İşleniyor |
| `bitti` | `rapor` alanı dolu |
| `hata` | `hata` alanı nedeni söyler (ör. dosya PDF olarak okunamadı) |

Sonuç gelene kadar birkaç saniyede bir sorun. LLM'siz iş genellikle bir saniyeden kısa sürer; LLM'li iş modelin hızına göre dakikalar alabilir. LLM yanıt vermezse iş yine `bitti` olur: rapor makine farklarıyla döner ve `rapor.llm.hata` nedeni söyler.

Biten işin yanıtı:

```json
{
  "kimlik": "0b7d0c1e-5a53-4c0e-9d2b-6a1f1f4d2c11",
  "durum": "bitti",
  "olusturma": "2026-11-27T12:00:00.000Z",
  "baslama": "2026-11-27T12:00:00.004Z",
  "bitis": "2026-11-27T12:00:00.512Z",
  "sure_ms": 508,
  "rapor": {
    "mod": "donusum",
    "hukum": { "durum": "sorun", "metin": "Ekstreler eşdeğer değil: 4 kritik fark var." },
    "ozet": "…",
    "bulgular": [
      {
        "kimlik": "B1",
        "baslik": "Tutar ya da sayı farkı: Dönem Borcu",
        "aciklama": "Dönem Borcu: tutar ya da sayı farklı: “12.450,75 TL” → “12.450,57 TL” (fark -0,18)",
        "onem": "kritik",
        "kategori": "tutar",
        "farklar": ["F4"],
        "beklenen": null,
        "kaynak": "kural"
      }
    ],
    "farklar": [
      {
        "kimlik": "F4",
        "tur": "degisti",
        "kategori": "tutar",
        "etiket": "Dönem Borcu",
        "a": { "metin": ": 12.450,75 TL", "satir": "Dönem Borcu  |  : 12.450,75 TL", "kutu": { "sayfa": 1, "x": 198, "y": 126.4, "en": 61.2, "boy": 8.5 } },
        "b": { "metin": ": 12.450,57 TL", "satir": "Dönem Borcu  |  : 12.450,57 TL", "kutu": { "sayfa": 1, "x": 198, "y": 126.4, "en": 61.2, "boy": 8.5 } },
        "ayrinti": "Dönem Borcu: tutar ya da sayı farklı: “12.450,75 TL” → “12.450,57 TL” (fark -0,18)",
        "onem": "kritik"
      }
    ],
    "karsilanmayan": [],
    "uyarilar": [],
    "belgeler": { "a": { "ad": "eski.pdf", "sayfa": 2, "parca": 144 }, "b": { "ad": "yeni.pdf", "sayfa": 2, "parca": 141 } },
    "llm": { "kullanildi": false, "hata": "LLM yorumu bu karşılaştırmada kapatıldı." },
    "tarih": "2026-11-27T12:00:00.512Z"
  }
}
```

Raporu okurken:

| Alan | Nasıl kullanılır |
|---|---|
| `rapor.hukum.durum` | Tek bakışta sonuç: `temiz`, `dikkat` ya da `sorun`. Otomatik karar için buna bakın. |
| `rapor.bulgular[]` | İnsana gösterilecek liste; en önemlisi başta. `onem`: `kritik`, `orta`, `dusuk`, `bilgi`. |
| `rapor.bulgular[].kaynak` | `kural`: makine yazdı. `llm`: LLM yazdı; dayandığı ham farklar `farklar` dizisindedir. |
| `rapor.bulgular[].beklenen` | Not yazıldıysa: `true` bilinen fark ya da istenen değişiklik, `false` istenmemiş. Bu LLM'in kararıdır. |
| `rapor.farklar[]` | Makinenin bulduğu ham farklar. `kutu` sayfadaki yeridir: birim PDF noktası (1/72 inç), köşe sol üst. |
| `rapor.karsilanmayan[]` | Yalnızca `sablon` ve not yazıldıysa: istenip de görülmeyen değişiklikler (LLM'in kararı). |
| `rapor.uyarilar[]` | Sonucu sınırlayan durumlar (metin katmanı yok, görüntü farkı hesaplanamadı...). Boş değilse okuyun. |

Alanların tam tanımı: [`sunucu/src/tipler.ts`](../sunucu/src/tipler.ts) (`Rapor`, `Bulgu`, `Fark`, `IsYaniti`).

### `DELETE /karsilastirmalar/{kimlik}`

İşi ve sonucunu bellekten siler. Sonucu aldıktan sonra silmek iyi bir alışkanlıktır: rapor ekstre içeriği taşır. Silmezseniz saklanma süresi dolunca kendiliğinden silinir. Çalışmakta olan iş durdurulamaz; bitince sonucu saklanmadan atılır.

### `GET /saglik`

Anahtar istemez; yük dengeleyici ve izleme araçları içindir. Ekstre ya da ayar bilgisi vermez.

```json
{ "durum": "ayakta", "surum": "0.2.0", "llm_tanimli": true, "sirada": 0, "calisan": 1 }
```

## Hata yanıtları

Hatalar `{ "detail": "açıklama" }` biçimindedir.

| Kod | Ne zaman |
|---|---|
| `400` | İstek hatalı: `mod` yanlış, `a` ya da `b` eksik, dosya PDF değil |
| `401` | Servis anahtarı eksik, yanlış ya da sunucuda hiç anahtar tanımlı değil |
| `403` | Arayüze ya da ayarlara ağdan erişilmeye çalışıldı |
| `404` | İş yok, başka bir anahtara ait ya da saklanma süresi doldu |
| `413` | Gövde çok büyük |
| `429` | Kuyruk dolu; `Retry-After` başlığı kaç saniye sonra deneneceğini söyler |

## Örnek: curl

Anahtarı ve dosyaları kendi değerlerinizle değiştirin. Büyük dosyalarda gövdeyi komut satırına değil dosyaya yazın:

```bash
node -e "const fs=require('fs');const d=(y)=>({ad:y,pdf_base64:fs.readFileSync(y).toString('base64')});fs.writeFileSync('istek.json',JSON.stringify({mod:'donusum',llm:false,a:d('eski.pdf'),b:d('yeni.pdf')}))"
```

```bash
curl -s -X POST http://127.0.0.1:8790/api/v1/karsilastirmalar -H "Authorization: Bearer $EKSTRE_ANAHTAR" -H "content-type: application/json" --data-binary @istek.json
```

```bash
curl -s http://127.0.0.1:8790/api/v1/karsilastirmalar/<kimlik> -H "Authorization: Bearer $EKSTRE_ANAHTAR"
```

## Örnek: Node.js

```js
import fs from "node:fs";

const taban = "http://127.0.0.1:8790/api/v1";
const basliklar = { authorization: `Bearer ${process.env.EKSTRE_ANAHTAR}`, "content-type": "application/json" };
const dosya = (yol) => ({ ad: yol, pdf_base64: fs.readFileSync(yol).toString("base64") });

const kabul = await fetch(`${taban}/karsilastirmalar`, {
  method: "POST",
  headers: basliklar,
  body: JSON.stringify({ mod: "donusum", a: dosya("eski.pdf"), b: dosya("yeni.pdf") }),
});
if (kabul.status !== 202) throw new Error((await kabul.json()).detail);
let is = await kabul.json();

while (is.durum === "sirada" || is.durum === "calisiyor") {
  await new Promise((bekle) => setTimeout(bekle, 3000));
  is = await (await fetch(`${taban}/karsilastirmalar/${is.kimlik}`, { headers: basliklar })).json();
}
if (is.durum === "hata") throw new Error(is.hata);

console.log(is.rapor.hukum.durum, is.rapor.hukum.metin);
for (const b of is.rapor.bulgular) console.log(b.onem, b.baslik);

await fetch(`${taban}/karsilastirmalar/${is.kimlik}`, { method: "DELETE", headers: basliklar });
```

Aynı akışın çalışan ve her gönderimde sınanan hali: [`araclar/duman.ts`](../araclar/duman.ts).
