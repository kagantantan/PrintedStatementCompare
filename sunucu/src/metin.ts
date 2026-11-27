// Metin yardımcıları: karşılaştırma için sadeleştirme, tutar ve tarih tanıma, benzerlik, maskeleme.

/** Karşılaştırmada kullanılan biçim: birleşik Unicode, tek boşluk, kenarlar kırpık. */
export function sade(metin: string): string {
  return metin.normalize("NFC").replace(/[  -​ ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Yazım farkını (büyük-küçük harf, boşluk, noktalama) yok sayan biçim.
 * Rakamların yanındaki işaretlere dokunmaz: "1.000,00" ile "100.000", "-86,42" ile "86,42" aynı sayılmamalı.
 */
export function yazimsiz(metin: string): string {
  return sade(metin)
    .toLocaleLowerCase("tr")
    .replace(/[!?'"’`´()]/g, "")
    .replace(/(?<!\d)[.,:;/]|[.,:;/](?!\d)/g, "")
    .replace(/[-–—](?!\d)/g, "")
    .replace(/(?<!\d)\s+|\s+(?!\d)/g, "");
}

const AYLAR = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];
const AY_DESENI = AYLAR.join("|");

/** Yalnızca şablonu karşılaştırırken: rakamları ve ay adlarını tek kalıba indirir. */
export function veriGizle(metin: string): string {
  return sade(metin)
    .replace(new RegExp(`\\b(${AY_DESENI})\\b`, "giu"), "AY")
    .replace(/[+-]?\d[\d.,]*/g, "9");
}

/** "1.234,56", "1,234.56", "+99,99", "%20", "12.450,75 TL" gibi bir sayıyı çözer; sayı değilse null. */
export function sayiCoz(ham: string): number | null {
  let m = sade(ham).replace(/\s*(TL|TRY|USD|EUR|GBP)$/i, "").replace(/[₺$€£%\s]/g, "");
  if (!/^[+-]?\d[\d.,]*$/.test(m)) return null;
  const eksi = m.startsWith("-");
  m = m.replace(/^[+-]/, "").replace(/[.,]+$/, "");
  const son = Math.max(m.lastIndexOf(","), m.lastIndexOf("."));
  let tam = m;
  let kesir = "";
  if (son >= 0) {
    const kuyruk = m.slice(son + 1);
    const ayrac = m[son];
    const ayniAyracSayisi = m.split(ayrac!).length - 1;
    // Son ayraçtan sonra 3 hane varsa ve başka ondalık işareti yoksa binlik ayracıdır ("1.234").
    const binlik = kuyruk.length === 3 && (ayniAyracSayisi > 1 || !/[.,]/.test(m.slice(0, son).replace(new RegExp(`\\${ayrac}`, "g"), "")));
    if (!binlik) {
      tam = m.slice(0, son);
      kesir = kuyruk;
    }
  }
  const sayi = Number(`${tam.replace(/[.,]/g, "")}${kesir ? `.${kesir}` : ""}`);
  if (!Number.isFinite(sayi)) return null;
  return eksi ? -sayi : sayi;
}

/** "09.12.2026", "9/12/2026", "2026-12-09", "9 Aralık 2026" → "2026-12-09"; tarih değilse null. */
export function tarihCoz(ham: string): string | null {
  const m = sade(ham).replace(/^[:\s]+/, "");
  const iso = (y: number, a: number, g: number) => {
    if (a < 1 || a > 12 || g < 1 || g > 31) return null;
    return `${String(y).padStart(4, "0")}-${String(a).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
  };
  let e = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(m);
  if (e) return iso(yil(e[3]!), Number(e[2]), Number(e[1]));
  e = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(m);
  if (e) return iso(Number(e[1]), Number(e[2]), Number(e[3]));
  e = new RegExp(`^(\\d{1,2})\\s+(${AY_DESENI})\\s+(\\d{4})$`, "iu").exec(m.toLocaleLowerCase("tr"));
  if (e) return iso(Number(e[3]), AYLAR.indexOf(e[2]!) + 1, Number(e[1]));
  return null;
}

function yil(ham: string): number {
  const y = Number(ham);
  return ham.length <= 2 ? 2000 + y : y;
}

/** Metinde tarih izi var mı (ay adı ya da gg.aa.yyyy)? */
export function tarihIzi(metin: string): boolean {
  return new RegExp(`\\b(${AY_DESENI})\\b`, "iu").test(metin.toLocaleLowerCase("tr")) || /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(metin);
}

/** 0..1 benzerlik (Levenshtein). Uzun metinlerde maliyeti sınırlamak için ilk 200 karaktere bakar. */
export function benzerlik(a: string, b: string): number {
  if (a === b) return 1;
  const x = a.slice(0, 200);
  const y = b.slice(0, 200);
  if (!x.length || !y.length) return 0;
  let onceki = new Uint16Array(y.length + 1);
  let simdiki = new Uint16Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) onceki[j] = j;
  for (let i = 1; i <= x.length; i++) {
    simdiki[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const bedel = x.charCodeAt(i - 1) === y.charCodeAt(j - 1) ? 0 : 1;
      simdiki[j] = Math.min(onceki[j]! + 1, simdiki[j - 1]! + 1, onceki[j - 1]! + bedel);
    }
    [onceki, simdiki] = [simdiki, onceki];
  }
  return 1 - onceki[y.length]! / Math.max(x.length, y.length);
}

/**
 * LLM'e giden metinde uzun rakam dizilerini (kart, hesap, kimlik, IBAN) maskeler; son dört hane kalır.
 * Tutarlar maskelenmez: içinde nokta ya da virgül olan sayılara dokunulmaz.
 */
export function maskele(metin: string): string {
  return metin.replace(/(?<![\d.,])(?:\d[ -]?){9,26}(?![\d.,]*\d)/g, (dizi) => {
    const haneler = dizi.replace(/\D/g, "");
    if (haneler.length < 10) return dizi;
    const kuyruk = /[ -]$/.test(dizi) ? dizi.slice(-1) : "";
    return `****${haneler.slice(-4)}${kuyruk}`;
  });
}

/** Maskeleme iki farklı metni aynı gösteriyorsa LLM'in yanılmaması için not düşer. */
export function maskeliCift(a: string, b: string): [string, string] {
  const ma = maskele(a);
  const mb = maskele(b);
  if (ma === mb && a !== b) return [ma, `${mb} [maskeli hanelerde fark var]`];
  return [ma, mb];
}

export function kisalt(metin: string, sinir: number): string {
  return metin.length <= sinir ? metin : `${metin.slice(0, sinir - 1)}…`;
}
