// LLM'e giden istem. Model belgeleri baştan okumaz: makinenin bulduğu ham farkları yorumlar.
// Böylece küçük bir yerel model de iş görür ve fark uydurma riski azalır.
import { tarafAdlari } from "./fark.js";
import { kisalt, maskele, maskeliCift } from "./metin.js";
import type { Fark, Mod } from "./tipler.js";
import type { IcerikParcasi, Mesaj } from "./llm.js";

export interface IstemGirdisi {
  mod: Mod;
  yalniz_yapi: boolean;
  not: string;
  farklar: Fark[];
  /** Toplam fark sayısı (üst sınır yüzünden farklar bundan az olabilir). */
  toplam: number;
  maskele: boolean;
  ek_istem: string;
  goruntuler?: { a: string[]; b: string[] };
}

const CIKTI = `Yalnızca şu biçimde tek bir JSON nesnesi döndür, başka hiçbir şey yazma:
{"ozet": "2-4 cümle Türkçe özet", "bulgular": [{"farklar": ["F1", "F2"], "baslik": "kısa başlık", "aciklama": "bir iki cümle: ne farklı, neden önemli", "onem": "kritik|orta|dusuk|bilgi", "beklenen": true|false|null}], "karsilanmayan": ["..."]}`;

const ORTAK_KURALLAR = `Kurallar:
- Fark uydurma. Her bulgu listedeki fark kimliklerine (F1, F2...) dayanmalı.
- Yalnızca aynı türden ve aynı nedenden doğan farkları tek bulguda topla (aynı değerin iki sayfadaki tekrarı, birlikte kayan bloklar). Farklı türleri birleştirme: tutar farkı, tarih farkı, biçim farkı, eksik satır ve kayma ayrı bulgulardır.
- Açıklamada yalnızca fark satırında yazanı söyle; neden ya da sonuç uydurma.
- Bir fark kimliği en fazla bir bulguda geçsin. Hiçbir farkı atlama.
- Başlık ve açıklama Türkçe, kısa ve somut olsun; etiketi ve iki değeri yaz.`;

function sistemIstemi(g: IstemGirdisi): string {
  const ad = tarafAdlari(g.mod);
  if (g.mod === "donusum") {
    return `Sen kredi kartı ekstresi dönüşüm testlerinde uzman bir test analistisin.
A = ${ad.a} (eski uygulamanın ürettiği ekstre), B = ${ad.b} (yeni uygulamanın ürettiği ekstre). İkisi aynı müşterinin aynı dönem ekstresi; müşterinin gördüğü her şey aynı olmalı.
Bir karşılaştırma aracı iki PDF arasındaki ham farkları çıkardı. Görevin bu farkları anlamlı bulgulara çevirmek.

Önem:
- kritik: müşterinin gördüğü tutar, tarih, oran, isim, adres, kart ya da hesap bilgisi yanlış, eksik ya da fazla; eksik ya da fazla işlem satırı.
- orta: etiket ya da açıklama metni farklı, görsel öğe (logo, çizgi, kutu) farklı, sayı ya da tarih biçimi farklı.
- dusuk: küçük kayma, punto, yazım (büyük-küçük harf, boşluk).
- bilgi: müşteriyi etkilemeyen teknik fark.

"beklenen": kullanıcının "bilinen farklar" notu bu farkı açıkça kapsıyorsa true, kapsamıyorsa false; not yoksa null.
"karsilanmayan": her zaman boş dizi.

${ORTAK_KURALLAR}

${CIKTI}${g.ek_istem ? `\n${g.ek_istem}` : ""}`;
  }
  return `Sen kredi kartı ekstresi şablonlarını inceleyen bir analistsin.
A = ${ad.a} (bugünkü şablon ya da "böyle olsun" denen örnek), B = ${ad.b} (hazırlanan şablon).
Bir karşılaştırma aracı iki PDF arasındaki ham farkları çıkardı. Görevin şablonda neyin değiştiğini anlaşılır bulgulara çevirmek: eklenen, kaldırılan, yeri değişen, metni değişen bölümler ve alanlar.
${g.yalniz_yapi ? "İki belgedeki müşteri verileri farklı: tutar, tarih, isim ve işlem satırı farklarını şablon değişikliği sayma; yalnızca başlık, etiket, bölüm, sıra ve yerleşim farklarına bak. Yalnızca veri farkı olan bulgulara \"bilgi\" de.\n" : ""}
Önem:
- kritik: zorunlu bir bilgi alanı ya da bölüm kaybolmuş.
- orta: bölüm ya da alan eklenmiş, kaldırılmış, metni ya da yeri belirgin biçimde değişmiş.
- dusuk: küçük kayma, punto, yazım.
- bilgi: şablonu etkilemeyen fark.

"beklenen": kullanıcı "istenen değişiklikler" yazdıysa: fark istenenlerden biriyse true, istenmemiş bir değişiklikse false. İstek yazılmadıysa null.
"karsilanmayan": istenen değişikliklerden, farklar arasında karşılığı görülmeyenler (kullanıcının sözleriyle, kısa). İstek yoksa boş dizi.

${ORTAK_KURALLAR}

${CIKTI}${g.ek_istem ? `\n${g.ek_istem}` : ""}`;
}

/** Bir ham farkın LLM'e giden tek satırlık hali. */
export function farkSatiri(f: Fark, maskeli: boolean): string {
  const m = (metin: string) => kisalt(maskeli ? maskele(metin) : metin, 160);
  const sayfa = f.a?.kutu.sayfa ?? f.b?.kutu.sayfa;
  const bas = `${f.kimlik} [${f.tur}/${f.kategori}${sayfa ? `, s.${sayfa}` : ""}]`;
  const satir = f.a?.satir || f.b?.satir;
  const baglam = satir && satir !== f.a?.metin && satir !== f.b?.metin ? ` satır: "${m(satir)}"` : "";
  if (f.tur === "degisti" && f.a && f.b) {
    const [x, y] = maskeli ? maskeliCift(f.a.metin, f.b.metin) : [f.a.metin, f.b.metin];
    return `${bas}${f.etiket ? ` ${m(f.etiket)}:` : ""} A: "${kisalt(x, 160)}" → B: "${kisalt(y, 160)}"${f.etiket ? "" : baglam}`;
  }
  if (f.tur === "eksik" && f.a) return `${bas} A'da var, B'de yok: "${m(f.a.metin)}"${baglam}`;
  if (f.tur === "fazla" && f.b) return `${bas} B'de var, A'da yok: "${m(f.b.metin)}"${baglam}`;
  // Kayma ve punto farklarında örnek metinler zaten ayrıntının içinde; yinelenmesin.
  const ornek = f.a?.metin && !f.ayrinti.includes(f.a.metin) ? ` örnek: ${m(f.a.metin)}` : "";
  return `${bas} ${maskeli ? maskele(f.ayrinti) : f.ayrinti}${ornek}`;
}

export function istemKur(g: IstemGirdisi): Mesaj[] {
  const notBasligi = g.mod === "donusum" ? "Bilinen ve kabul edilen farklar (kullanıcının notu)" : "İstenen değişiklikler (kullanıcının notu)";
  const satirlar = g.farklar.map((f) => farkSatiri(f, g.maskele));
  const metin = [
    `${notBasligi}:\n${g.not.trim() ? g.not.trim() : "(yazılmadı)"}`,
    `Ham farklar (${g.farklar.length}${g.toplam > g.farklar.length ? `; toplam ${g.toplam} farkın en önemlileri` : ""}):\n${satirlar.join("\n")}`,
    g.goruntuler ? "Ekte sayfa görüntüleri var: önce A'nın, sonra B'nin sayfaları. Görüntüde gördüğün ama listede olmayan belirgin bir görsel fark varsa \"farklar\" dizisini boş bırakarak ayrı bir bulgu olarak yazabilirsin." : "",
    "Şimdi JSON'u yaz.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const kullanici: IcerikParcasi[] = [{ type: "text", text: metin }];
  if (g.goruntuler) {
    for (const url of [...g.goruntuler.a, ...g.goruntuler.b]) kullanici.push({ type: "image_url", image_url: { url } });
  }
  return [
    { role: "system", content: sistemIstemi(g) },
    { role: "user", content: g.goruntuler ? kullanici : metin },
  ];
}
