// Sunucuda sayfa çizimi ve görüntü farkı: API'yi arayüzsüz çağıranlar için.
// Arayüz bu işi tarayıcıda yapıp bölgeleri kendisi gönderir; o zaman bu dosya hiç çalışmaz.
//
// Çizim için @napi-rs/canvas gerekir. pdf.js'in isteğe bağlı bağımlılığıdır ve Windows, Linux, macOS için hazır
// derlenmiş gelir. Kurulamadıysa karşılaştırma yine çalışır: yalnızca görüntü farkı çıkmaz ve rapor bunu söyler.
import { createRequire } from "node:module";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { bolgeleriBul, hucreFarki, OLCEK } from "./gorsel-fark.js";
import type { GorselBolge } from "./tipler.js";

/** Sunucuda en fazla bu kadar sayfanın görüntüsü karşılaştırılır; fazlası için rapor uyarır. */
export const AZAMI_GORSEL_SAYFA = 60;

export interface GorselSonuc {
  bolgeler: GorselBolge[];
  uyari?: string;
}

interface Tuval {
  width: number;
  height: number;
  getContext(tur: "2d"): any;
}

type TuvalUret = (en: number, boy: number) => Tuval;

let tuvalUret: TuvalUret | null | undefined;

async function tuvalYukle(): Promise<TuvalUret | null> {
  if (tuvalUret !== undefined) return tuvalUret;
  try {
    const modul = (await import("@napi-rs/canvas")) as unknown as { createCanvas: TuvalUret };
    tuvalUret = modul.createCanvas;
  } catch {
    tuvalUret = null;
  }
  return tuvalUret;
}

/**
 * pdf.js'e verilecek yardımcı klasör yolu. pdf.js yolun "/" ile bitmesini şart koşar ve dosya adını sonuna ekleyip
 * okur; Windows'un "\" ayracıyla biten yolu reddeder. Node, Windows'ta da "/" ayraçlı yolu okuyabilir.
 */
export function pdfjsKlasoru(kok: string, ad: string): string {
  return `${kok.replace(/\\/g, "/").replace(/\/+$/, "")}/${ad}/`;
}

const pdfjsKoku = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const klasor = (ad: string) => pdfjsKlasoru(pdfjsKoku, ad);

async function belgeAc(veri: Uint8Array) {
  const gorev = getDocument({ data: veri.slice(), verbosity: 0, standardFontDataUrl: klasor("standard_fonts"), cMapUrl: klasor("cmaps"), cMapPacked: true, wasmUrl: klasor("wasm"), iccUrl: klasor("iccs") });
  return { gorev, pdf: await gorev.promise };
}

/** İki PDF'in ortak sayfalarını çizer ve metinden bağımsız görüntü farkı bölgelerini döner. */
export async function gorselBolgeler(a: Uint8Array, b: Uint8Array): Promise<GorselSonuc> {
  const uret = await tuvalYukle();
  if (!uret) return { bolgeler: [], uyari: "Görüntü farkı hesaplanamadı: sunucuda çizim kütüphanesi (@napi-rs/canvas) kurulu değil. Yalnızca metin farkları çıkarıldı." };
  let ba;
  let bb;
  try {
    ba = await belgeAc(a);
    bb = await belgeAc(b);
    const ortak = Math.min(ba.pdf.numPages, bb.pdf.numPages);
    const sayfa = Math.min(ortak, AZAMI_GORSEL_SAYFA);
    const bolgeler: GorselBolge[] = [];
    for (let no = 1; no <= sayfa; no++) {
      const sa = await ba.pdf.getPage(no);
      const sb = await bb.pdf.getPage(no);
      const ga = sa.getViewport({ scale: OLCEK });
      const en = Math.max(1, Math.round(ga.width));
      const boy = Math.max(1, Math.round(ga.height));
      const ciz = async (s: typeof sa) => {
        const g = s.getViewport({ scale: OLCEK });
        const t = uret(Math.max(1, Math.round(g.width)), Math.max(1, Math.round(g.height)));
        const c = t.getContext("2d");
        c.fillStyle = "#fff";
        c.fillRect(0, 0, t.width, t.height);
        await s.render({ canvas: t as never, canvasContext: c, viewport: g }).promise;
        if (t.width === en && t.height === boy) return c.getImageData(0, 0, en, boy).data as Uint8ClampedArray;
        // Sayfa boyutu farklıysa A'nın boyutuna getirilir (arayüzdeki davranışın aynısı).
        const olcekli = uret(en, boy);
        const oc = olcekli.getContext("2d");
        oc.drawImage(t, 0, 0, en, boy);
        return oc.getImageData(0, 0, en, boy).data as Uint8ClampedArray;
      };
      const pa = await ciz(sa);
      const pb = await ciz(sb);
      bolgeler.push(...bolgeleriBul(hucreFarki(pa, pb, en, boy), no));
      sa.cleanup();
      sb.cleanup();
    }
    return { bolgeler, uyari: ortak > sayfa ? `Görüntü farkı yalnızca ilk ${sayfa} sayfada arandı (belge ${ortak} sayfa).` : undefined };
  } catch (e) {
    return { bolgeler: [], uyari: `Görüntü farkı hesaplanamadı (${(e as Error).message.slice(0, 120)}). Yalnızca metin farkları çıkarıldı.` };
  } finally {
    await ba?.gorev.destroy();
    await bb?.gorev.destroy();
  }
}
