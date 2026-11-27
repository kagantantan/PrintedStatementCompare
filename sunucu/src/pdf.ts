// PDF'in metin katmanını konumlarıyla okur. Görüntü üretmez (o iş arayüzde, tarayıcıda yapılır);
// bu yüzden sunucunun yerel derlenen bir bağımlılığı yoktur.
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { sade } from "./metin.js";
import type { Belge, Parca, SayfaBilgisi } from "./tipler.js";

export class PdfHatasi extends Error {}

interface Oge {
  metin: string;
  x: number;
  /** Taban çizgisi, sayfanın üstünden. */
  taban: number;
  en: number;
  punto: number;
}

const AZAMI_SAYFA = 200;

export async function pdfOku(veri: Uint8Array, ad: string): Promise<Belge> {
  // pdf.js verdiğimiz tamponu sahiplenir; çağıranın elindeki bozulmasın diye kopyasını veriyoruz.
  const gorev = getDocument({ data: veri.slice(), verbosity: 0, useSystemFonts: false, disableFontFace: true });
  let pdf;
  try {
    pdf = await gorev.promise;
  } catch (e) {
    await gorev.destroy();
    const mesaj = (e as Error).name === "PasswordException" ? "PDF parola korumalı; parolasız halini verin." : "Dosya PDF olarak okunamadı.";
    throw new PdfHatasi(`${ad}: ${mesaj}`);
  }
  try {
    if (pdf.numPages > AZAMI_SAYFA) throw new PdfHatasi(`${ad}: ${pdf.numPages} sayfa var; en fazla ${AZAMI_SAYFA} sayfa karşılaştırılır.`);
    const sayfalar: SayfaBilgisi[] = [];
    const parcalar: Parca[] = [];
    for (let no = 1; no <= pdf.numPages; no++) {
      const sayfa = await pdf.getPage(no);
      const gorunum = sayfa.getViewport({ scale: 1 });
      sayfalar.push({ no, en: gorunum.width, boy: gorunum.height });
      const icerik = await sayfa.getTextContent();
      const ogeler: Oge[] = [];
      for (const ham of icerik.items) {
        if (!("str" in ham) || !ham.str.trim()) continue;
        const t = Util.transform(gorunum.transform, ham.transform);
        const punto = Math.hypot(t[2], t[3]) || ham.height || 1;
        ogeler.push({ metin: ham.str, x: t[4], taban: t[5], en: ham.width, punto });
      }
      parcalar.push(...parcala(ogeler, no));
      sayfa.cleanup();
    }
    parcalar.forEach((p, i) => (p.no = i));
    return { ad, sayfalar, parcalar };
  } finally {
    await gorev.destroy();
  }
}

/**
 * Sayfadaki metin öğelerini satırlara, satırları parçalara böler.
 * Aynı satırda birbirine yakın öğeler tek parça olur ("Dönem" + "Borcu", ":" + "12.450,75 TL");
 * aralarında büyük boşluk olanlar ayrı kalır (etiket ile değeri, tablo hücreleri).
 * Böylece iki sistemin metni farklı yerlerden bölmesi sonucu değiştirmez.
 */
export function parcala(ogeler: Oge[], sayfa: number): Parca[] {
  const sirali = [...ogeler].sort((p, q) => p.taban - q.taban || p.x - q.x);
  const satirlar: Oge[][] = [];
  for (const oge of sirali) {
    const son = satirlar[satirlar.length - 1];
    const esik = 0.35 * Math.min(oge.punto, son?.[0]?.punto ?? oge.punto);
    if (son && Math.abs(son[0]!.taban - oge.taban) <= esik) son.push(oge);
    else satirlar.push([oge]);
  }
  const parcalar: Parca[] = [];
  for (const satir of satirlar) {
    satir.sort((p, q) => p.x - q.x);
    const gruplar: Oge[][] = [];
    for (const oge of satir) {
      const grup = gruplar[gruplar.length - 1];
      const onceki = grup?.[grup.length - 1];
      const bosluk = onceki ? oge.x - (onceki.x + onceki.en) : 0;
      if (grup && onceki && bosluk <= 1.2 * Math.max(oge.punto, onceki.punto)) grup.push(oge);
      else gruplar.push([oge]);
    }
    const satirParcalari: Parca[] = [];
    for (const grup of gruplar) {
      let metin = "";
      for (let i = 0; i < grup.length; i++) {
        const oge = grup[i]!;
        const onceki = grup[i - 1];
        // Arada boşluk varsa ya da öğeler üst üste biniyorsa (sıkışmış sütun başlıkları) kelimeler yapışmasın.
        const ara = onceki ? oge.x - (onceki.x + onceki.en) : 0;
        if (onceki && (ara > 0.1 * oge.punto || ara < -0.3 * oge.punto) && !metin.endsWith(" ") && !oge.metin.startsWith(" ")) metin += " ";
        metin += oge.metin;
      }
      metin = sade(metin);
      if (!metin) continue;
      const ilk = grup[0]!;
      const sonOge = grup[grup.length - 1]!;
      const punto = Math.max(...grup.map((o) => o.punto));
      satirParcalari.push({
        no: 0,
        sayfa,
        metin,
        x: ilk.x,
        y: ilk.taban - punto * 0.8,
        en: Math.max(1, sonOge.x + sonOge.en - ilk.x),
        boy: punto,
        punto: Math.round(punto * 10) / 10,
        satir: "",
      });
    }
    const satirMetni = satirParcalari.map((p) => p.metin).join("  |  ");
    for (const p of satirParcalari) p.satir = satirMetni;
    parcalar.push(...satirParcalari);
  }
  return parcalar;
}
