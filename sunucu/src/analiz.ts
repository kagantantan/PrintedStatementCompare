// Bir karşılaştırmanın tamamı: PDF'leri oku, ham farkları çıkar, LLM'e yorumlat, raporu kur.
//
// LLM'e güven sınırı:
//   - LLM fark silemez: değinmediği her ham fark kural bulgusu olarak rapora girer.
//   - LLM fark uyduramaz: bilinmeyen kimlikler atılır; hiçbir farka dayanmayan bulgu "kanıtsız" işaretlenir.
//   - Dönüşüm modunda kuralın verdiği önem tabandır: LLM yükseltebilir, düşüremez;
//     tek istisna kullanıcının "bilinen farklar" notunun o farkı kapsamasıdır.
//   - LLM bir bulguda yalnızca aynı türden farkları toplayabilir; tutar ile biçimi aynı başlığa koyarsa o bulgu alınmaz.
//   - Hüküm LLM'in sözünden değil, bulgulardan kuralla hesaplanır.
import { gorselBolgeler } from "./ciz.js";
import { farkBul, tarafAdlari } from "./fark.js";
import { istemKur } from "./istem.js";
import { jsonAyikla, sohbet, type Mesaj } from "./llm.js";
import { kisalt } from "./metin.js";
import { pdfOku } from "./pdf.js";
import type { Ayar, Belge, Bulgu, DosyaGirdisi, Fark, Hukum, KarsilastirIstegi, Kategori, LlmKullanimi, Mod, Onem, Rapor } from "./tipler.js";

export class IstekHatasi extends Error {}

const ONEM_SIRASI: Onem[] = ["kritik", "orta", "dusuk", "bilgi"];
const onemSira = (o: Onem) => ONEM_SIRASI.indexOf(o);
const dahaOnemli = (x: Onem, y: Onem): Onem => (onemSira(x) <= onemSira(y) ? x : y);

const AZAMI_GORUNTU = 6;

const pdfVerisi = (girdi: DosyaGirdisi) => new Uint8Array(Buffer.from(girdi.pdf_base64 ?? "", "base64"));

async function belgeOku(girdi: DosyaGirdisi, taraf: string): Promise<Belge> {
  if (!girdi || typeof girdi.ad !== "string") throw new IstekHatasi(`${taraf} dosyası eksik.`);
  if (girdi.pdf_base64) return pdfOku(pdfVerisi(girdi), girdi.ad);
  // Resim dosyası: metin katmanı yok, yalnızca sayfa boyutları bilinir.
  const sayfalar = (girdi.sayfalar ?? []).map((s, i) => ({ no: i + 1, en: Number(s.en) || 595, boy: Number(s.boy) || 842 }));
  if (!sayfalar.length) throw new IstekHatasi(`${taraf} dosyası okunamadı: ${girdi.ad}`);
  return { ad: girdi.ad, sayfalar, parcalar: [] };
}

export async function karsilastir(istek: KarsilastirIstegi, ayar: Ayar, anahtar: string | null): Promise<Rapor> {
  if (istek.mod !== "donusum" && istek.mod !== "sablon") throw new IstekHatasi("Mod donusum ya da sablon olmalı.");
  const mod = istek.mod;
  const ad = tarafAdlari(mod);
  const [a, b] = await Promise.all([belgeOku(istek.a, ad.a), belgeOku(istek.b, ad.b)]);
  const yalnizYapi = mod === "sablon" && istek.yalniz_yapi === true;
  const not = typeof istek.not === "string" ? istek.not.slice(0, 4000) : "";

  const uyarilar: string[] = [];
  for (const [belge, taraf] of [[a, ad.a], [b, ad.b]] as const) {
    if (!belge.parcalar.length) uyarilar.push(`${taraf} (${belge.ad}) içinde metin katmanı yok; taranmış görüntü ya da resim olabilir. Bu taraf için yalnızca görsel farklar çıkarıldı.`);
  }

  // Görüntü farkı: arayüz kendi hesapladığını gönderir; göndermeyen (API) için sunucu sayfaları çizer.
  let bolgeler = Array.isArray(istek.gorsel_bolgeler) ? istek.gorsel_bolgeler : undefined;
  if (!bolgeler && istek.gorsel_fark !== false && istek.a.pdf_base64 && istek.b.pdf_base64) {
    const gorsel = await gorselBolgeler(pdfVerisi(istek.a), pdfVerisi(istek.b));
    bolgeler = gorsel.bolgeler;
    if (gorsel.uyari) uyarilar.push(gorsel.uyari);
  }

  const farklar = farkBul(a, b, { mod, yalniz_yapi: yalnizYapi, konum_toleransi: ayar.karsilastirma.konum_toleransi, punto_toleransi: ayar.karsilastirma.punto_toleransi }, bolgeler ?? []);

  let bulgular: Bulgu[] = [];
  let ozet = "";
  let karsilanmayan: string[] = [];
  const llm: LlmKullanimi = { kullanildi: false };
  const llmHazir = Boolean(ayar.llm.adres && ayar.llm.model);

  if (istek.llm === false) llm.hata = "LLM yorumu bu karşılaştırmada kapatıldı.";
  else if (!llmHazir) llm.hata = "LLM ayarlanmamış; yalnızca makine farkları gösteriliyor. Ayarlar ekranından kurum LLM'ini tanımlayın.";
  else if (farklar.length) {
    const secilen = llmIcinSec(farklar, ayar.karsilastirma.llm_azami_fark);
    const goruntuler = ayar.llm.gorsel && istek.goruntuler ? { a: goruntuSuz(istek.goruntuler.a), b: goruntuSuz(istek.goruntuler.b) } : undefined;
    const gorselVar = Boolean(goruntuler && goruntuler.a.length + goruntuler.b.length);
    const mesajlar = istemKur({ mod, yalniz_yapi: yalnizYapi, not, farklar: secilen, toplam: farklar.length, maskele: ayar.karsilastirma.maskele, ek_istem: ayar.llm.ek_istem, goruntuler: gorselVar ? goruntuler : undefined });
    const basla = Date.now();
    try {
      const yanit = await jsonSohbet(ayar, anahtar, mesajlar);
      const islenen = yanitiIsle(yanit, farklar, mod, Boolean(not.trim()));
      bulgular = islenen.bulgular;
      ozet = islenen.ozet;
      karsilanmayan = mod === "sablon" && not.trim() ? islenen.karsilanmayan : [];
      Object.assign(llm, { kullanildi: true, model: ayar.llm.model, sure_ms: Date.now() - basla, gorsel: gorselVar, gonderilen: secilen.length });
      if (islenen.karisik) uyarilar.push(`LLM'in ${islenen.karisik} bulgusu farklı türden farkları aynı başlıkta topladığı için alınmadı; o farklar makine bulgusu olarak gösteriliyor.`);
      if (secilen.length < farklar.length) uyarilar.push(`${farklar.length} farkın en önemli ${secilen.length} tanesi LLM'e gönderildi; gerisi kuralla değerlendirildi.`);
    } catch (e) {
      llm.hata = `LLM yorumu alınamadı; makine farkları gösteriliyor. ${(e as Error).message}`;
    }
  }

  // LLM'in değinmediği her fark kural bulgusu olarak eklenir.
  const kullanilan = new Set(bulgular.flatMap((x) => x.farklar));
  // Her sayfada tekrarlayan aynı fark (üst bilgi, dipnot) tek bulguda toplanır.
  const tekrarlar = new Map<string, Bulgu>();
  for (const f of farklar) {
    if (kullanilan.has(f.kimlik)) continue;
    const yer = f.tur === "gorsel" && f.a ? `${Math.round(f.a.kutu.x)},${Math.round(f.a.kutu.y)}` : "";
    const anahtar = [f.tur, f.kategori, f.a?.metin ?? "", f.b?.metin ?? "", f.ayrinti, yer].join("\u0001");
    const onceki = tekrarlar.get(anahtar);
    if (onceki) onceki.farklar.push(f.kimlik);
    else {
      const bulgu = kuralBulgusu(f);
      tekrarlar.set(anahtar, bulgu);
      bulgular.push(bulgu);
    }
  }
  for (const bulgu of tekrarlar.values()) if (bulgu.farklar.length > 1) bulgu.aciklama += ` (${bulgu.farklar.length} sayfada tekrarlıyor.)`;

  const sayfaSirasi = new Map(farklar.map((f, i) => [f.kimlik, i]));
  bulgular.sort((x, y) => onemSira(x.onem) - onemSira(y.onem) || (sayfaSirasi.get(x.farklar[0] ?? "") ?? 1e9) - (sayfaSirasi.get(y.farklar[0] ?? "") ?? 1e9));
  bulgular.forEach((x, i) => (x.kimlik = `B${i + 1}`));

  const hukum = hukumVer(mod, bulgular, karsilanmayan, Boolean(not.trim()) && llm.kullanildi);
  return {
    mod,
    yalniz_yapi: yalnizYapi,
    hukum,
    ozet: ozet || kuralOzeti(bulgular, mod),
    bulgular,
    farklar,
    karsilanmayan,
    uyarilar,
    belgeler: { a: { ad: a.ad, sayfa: a.sayfalar.length, parca: a.parcalar.length }, b: { ad: b.ad, sayfa: b.sayfalar.length, parca: b.parcalar.length } },
    llm,
    tarih: new Date().toISOString(),
  };
}

function goruntuSuz(liste: unknown): string[] {
  if (!Array.isArray(liste)) return [];
  return liste.filter((u): u is string => typeof u === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u)).slice(0, AZAMI_GORUNTU);
}

/** Üst sınır aşılırsa en önemli farklar gider; sıra belgedeki sıradır. */
function llmIcinSec(farklar: Fark[], sinir: number): Fark[] {
  if (farklar.length <= sinir) return farklar;
  const secili = new Set([...farklar].sort((x, y) => onemSira(x.onem) - onemSira(y.onem)).slice(0, sinir).map((f) => f.kimlik));
  return farklar.filter((f) => secili.has(f.kimlik));
}

/** JSON bekleyen sohbet: yanıt JSON değilse bir kez daha, hatasını söyleyerek dener. */
async function jsonSohbet(ayar: Ayar, anahtar: string | null, mesajlar: Mesaj[]): Promise<Record<string, unknown>> {
  const ilk = await sohbet(ayar.llm, anahtar, mesajlar, { json: true });
  const cozulen = jsonAyikla(ilk);
  if (cozulen) return cozulen as Record<string, unknown>;
  const ikinci = await sohbet(ayar.llm, anahtar, [...mesajlar, { role: "assistant", content: kisalt(ilk, 2000) }, { role: "user", content: "Yanıtın geçerli bir JSON nesnesi değildi. Açıklama, kod çiti ya da ek metin olmadan yalnızca istenen JSON nesnesini yaz." }], { json: true });
  const tekrar = jsonAyikla(ikinci);
  if (tekrar) return tekrar as Record<string, unknown>;
  throw new Error("Model iki denemede de geçerli JSON üretmedi.");
}

const BASLIKLAR: Record<Kategori, string> = {
  tutar: "Tutar ya da sayı farkı",
  tarih: "Tarih farkı",
  metin: "Metin farkı",
  yazim: "Yazım farkı",
  yerlesim: "Yerleşim kayması",
  bicim: "Biçim farkı",
  gorsel: "Görsel fark",
  sayfa: "Sayfa farkı",
};

export function kuralBulgusu(f: Fark): Bulgu {
  let baslik = BASLIKLAR[f.kategori];
  if (f.tur === "eksik") baslik = `Eksik: ${kisalt(f.a?.metin ?? "", 70)}`;
  else if (f.tur === "fazla") baslik = `Fazla: ${kisalt(f.b?.metin ?? "", 70)}`;
  else if (f.tur === "degisti" && f.a) baslik = `${baslik}: ${kisalt(f.etiket ?? f.a.metin.replace(/^:\s*/, ""), 60)}`;
  return { kimlik: "", baslik, aciklama: f.ayrinti.charAt(0).toLocaleUpperCase("tr") + f.ayrinti.slice(1), onem: f.onem, kategori: f.kategori, farklar: [f.kimlik], beklenen: null, kaynak: "kural" };
}

interface IslenenYanit {
  bulgular: Bulgu[];
  ozet: string;
  karsilanmayan: string[];
  /** Farklı türden farkları karıştırdığı için alınmayan bulgu sayısı. */
  karisik: number;
}

/** LLM yanıtını doğrular ve güven sınırlarını uygular (dosyanın başındaki kurallar). */
export function yanitiIsle(yanit: Record<string, unknown>, farklar: Fark[], mod: Mod, notVar: boolean): IslenenYanit {
  const harita = new Map(farklar.map((f) => [f.kimlik, f]));
  const kullanilan = new Set<string>();
  const bulgular: Bulgu[] = [];
  let kanitsiz = 0;
  let karisik = 0;
  const ham = Array.isArray(yanit.bulgular) ? yanit.bulgular : [];
  for (const oge of ham.slice(0, 200)) {
    if (!oge || typeof oge !== "object") continue;
    const b = oge as Record<string, unknown>;
    const kimlikler = (Array.isArray(b.farklar) ? b.farklar : [])
      .map((k) => String(k).trim().toUpperCase())
      .filter((k) => harita.has(k) && !kullanilan.has(k));
    const tekil = [...new Set(kimlikler)];
    const baslik = kisalt(String(b.baslik ?? "").trim(), 140);
    const aciklama = kisalt(String(b.aciklama ?? "").trim(), 700);
    if (!baslik && !aciklama) continue;
    const dayanak = tekil.map((k) => harita.get(k)!);
    // Bir bulgu yalnızca aynı türden farkları toplar. Model türleri karıştırdıysa (ör. tutar farkını bir biçim
    // farkıyla aynı başlığa koyduysa) başlığı ve açıklaması güvenilmezdir: bulgu alınmaz, farklar kural bulgusu olur.
    if (new Set(dayanak.map((f) => f.kategori)).size > 1) {
      karisik++;
      continue;
    }
    if (!dayanak.length) {
      // Hiçbir farka dayanmıyor: görüntüden bir gözlem olabilir, ama kanıtı yok. En fazla beş tane ve en çok "orta".
      if (++kanitsiz > 5) continue;
      bulgular.push({ kimlik: "", baslik: baslik || "LLM gözlemi", aciklama, onem: "bilgi", kategori: "gorsel", farklar: [], beklenen: null, kaynak: "llm" });
      continue;
    }
    tekil.forEach((k) => kullanilan.add(k));
    const beklenen = notVar && typeof b.beklenen === "boolean" ? b.beklenen : null;
    let onem: Onem = ONEM_SIRASI.includes(b.onem as Onem) ? (b.onem as Onem) : dayanak.map((f) => f.onem).reduce(dahaOnemli);
    // Dönüşümde kuralın verdiği önem tabandır: model yükseltebilir, düşüremez.
    if (mod === "donusum" && beklenen !== true) onem = dayanak.map((f) => f.onem).reduce(dahaOnemli, onem);
    if (beklenen === true) onem = "bilgi";
    bulgular.push({ kimlik: "", baslik: baslik || kuralBulgusu(dayanak[0]!).baslik, aciklama, onem, kategori: baskinKategori(dayanak), farklar: tekil, beklenen, kaynak: "llm" });
  }
  const karsilanmayan = (Array.isArray(yanit.karsilanmayan) ? yanit.karsilanmayan : [])
    .map((k) => kisalt(String(k).trim(), 300))
    .filter(Boolean)
    .slice(0, 30);
  return { bulgular, ozet: kisalt(String(yanit.ozet ?? "").trim(), 1500), karsilanmayan, karisik };
}

function baskinKategori(farklar: Fark[]): Kategori {
  const sirali = [...farklar].sort((x, y) => onemSira(x.onem) - onemSira(y.onem));
  return sirali[0]!.kategori;
}

export function hukumVer(mod: Mod, bulgular: Bulgu[], karsilanmayan: string[], istekDegerlendirildi: boolean): Hukum {
  const sayilan = bulgular.filter((b) => b.beklenen !== true);
  const say = (o: Onem) => sayilan.filter((b) => b.onem === o).length;
  if (mod === "donusum") {
    if (!bulgular.length) return { durum: "temiz", metin: "Fark bulunamadı: iki ekstre eşdeğer." };
    if (say("kritik")) return { durum: "sorun", metin: `Ekstreler eşdeğer değil: ${say("kritik")} kritik fark var.` };
    if (say("orta")) return { durum: "dikkat", metin: `Kritik fark yok; bakılması gereken ${say("orta")} fark var.` };
    if (say("dusuk")) return { durum: "dikkat", metin: `İçerik aynı; ${say("dusuk")} küçük biçim ya da yerleşim farkı var.` };
    return { durum: "temiz", metin: "Yalnızca bilinen ya da müşteriyi etkilemeyen farklar var." };
  }
  if (!bulgular.length && !karsilanmayan.length) return { durum: "temiz", metin: "Fark bulunamadı: iki şablon aynı." };
  if (istekDegerlendirildi) {
    const istenmeyen = bulgular.filter((b) => b.beklenen === false && b.onem !== "bilgi").length;
    // LLM'in istekle eşleştirmediği değişiklikler: "uyumlu" denemez, elle bakılmalı.
    const belirsiz = bulgular.filter((b) => b.beklenen === null && b.onem !== "bilgi" && b.farklar.length > 0).length;
    const belirsizNotu = belirsiz ? ` ${belirsiz} değişiklik istekle eşleştirilemedi; elle bakın.` : "";
    if (istenmeyen || karsilanmayan.length) {
      const parcalar = [istenmeyen ? `${istenmeyen} istenmemiş değişiklik` : "", karsilanmayan.length ? `${karsilanmayan.length} karşılanmamış istek` : ""].filter(Boolean);
      return { durum: "sorun", metin: `İstekle uyuşmuyor: ${parcalar.join(", ")}.${belirsizNotu}` };
    }
    if (belirsiz) return { durum: "dikkat", metin: `İstenmemiş değişiklik ya da karşılanmamış istek görülmedi.${belirsizNotu}` };
    return { durum: "temiz", metin: `Değişiklikler istekle uyumlu (${bulgular.length} bulgu).` };
  }
  return { durum: "dikkat", metin: `Şablonda ${sayilan.length} değişiklik bulundu.` };
}

function kuralOzeti(bulgular: Bulgu[], mod: Mod): string {
  if (!bulgular.length) return mod === "donusum" ? "İki ekstre arasında fark bulunamadı." : "İki şablon arasında fark bulunamadı.";
  const sayilar = new Map<string, number>();
  for (const b of bulgular) sayilar.set(BASLIKLAR[b.kategori], (sayilar.get(BASLIKLAR[b.kategori]) ?? 0) + 1);
  const dokum = [...sayilar].map(([ad, n]) => `${n} ${ad.toLocaleLowerCase("tr")}`).join(", ");
  return `${bulgular.length} bulgu: ${dokum}.`;
}
