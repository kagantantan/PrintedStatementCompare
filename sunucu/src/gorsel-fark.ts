// İki sayfa görüntüsünü hücre hücre karşılaştıran saf hesap. Hem tarayıcıda (arayüz) hem sunucuda (API) kullanılır;
// bu yüzden Node'a ya da tarayıcıya özgü hiçbir şey içe almaz.
//
// Tek tek piksellere değil hücrenin ortalama rengine bakar: kenar yumuşatma gibi çizim gürültüsü fark sayılmaz,
// eksik bir logo ya da çizgi sayılır.
import type { GorselBolge } from "./tipler.js";

/** Karşılaştırma çözünürlüğü: nokta başına piksel. */
export const OLCEK = 2;
/** Hücre kenarı, nokta. */
export const HUCRE = 4;
/** Hücrenin ortalama renginde bu kadar fark (0..1) varsa hücre farklıdır. */
export const ESIK = 0.04;

export interface HucreFarki {
  sutun: number;
  satir: number;
  /** Hücre başına fark (0: aynı). */
  fark: Float32Array;
  farkli: number;
}

/** pa ve pb aynı boyutta (en × boy), RGBA sıralı piksel dizileridir. */
export function hucreFarki(pa: ArrayLike<number>, pb: ArrayLike<number>, en: number, boy: number): HucreFarki {
  const kenar = HUCRE * OLCEK;
  const sutun = Math.ceil(en / kenar);
  const satir = Math.ceil(boy / kenar);
  const fark = new Float32Array(sutun * satir);
  let farkli = 0;
  for (let hy = 0; hy < satir; hy++) {
    for (let hx = 0; hx < sutun; hx++) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let br = 0;
      let bg = 0;
      let bb = 0;
      let adet = 0;
      const ySon = Math.min(boy, (hy + 1) * kenar);
      const xSon = Math.min(en, (hx + 1) * kenar);
      for (let y = hy * kenar; y < ySon; y++) {
        let i = (y * en + hx * kenar) * 4;
        for (let x = hx * kenar; x < xSon; x++, i += 4) {
          ar += pa[i]!;
          ag += pa[i + 1]!;
          ab += pa[i + 2]!;
          br += pb[i]!;
          bg += pb[i + 1]!;
          bb += pb[i + 2]!;
          adet++;
        }
      }
      const d = Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb)) / (adet * 255);
      if (d >= ESIK) {
        fark[hy * sutun + hx] = d;
        farkli++;
      }
    }
  }
  return { sutun, satir, fark, farkli };
}

/** Komşu farklı hücreleri tek bölgede toplar; en büyük ve en belirgin bölgeler başta. */
export function bolgeleriBul(h: HucreFarki, sayfa: number, azami = 120): GorselBolge[] {
  if (!h.farkli) return [];
  const { sutun, satir, fark } = h;
  const bolgeler: GorselBolge[] = [];
  const gorulen = new Uint8Array(sutun * satir);
  for (let bas = 0; bas < fark.length; bas++) {
    if (!fark[bas] || gorulen[bas]) continue;
    let x0 = sutun;
    let x1 = 0;
    let y0 = satir;
    let y1 = 0;
    let toplam = 0;
    let adet = 0;
    const yigin = [bas];
    gorulen[bas] = 1;
    while (yigin.length) {
      const k0 = yigin.pop()!;
      const hx = k0 % sutun;
      const hy = (k0 - hx) / sutun;
      x0 = Math.min(x0, hx);
      x1 = Math.max(x1, hx);
      y0 = Math.min(y0, hy);
      y1 = Math.max(y1, hy);
      toplam += fark[k0]!;
      adet++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const kx = hx + dx;
          const ky = hy + dy;
          if (kx < 0 || ky < 0 || kx >= sutun || ky >= satir) continue;
          const k = ky * sutun + kx;
          if (fark[k] && !gorulen[k]) {
            gorulen[k] = 1;
            yigin.push(k);
          }
        }
      }
    }
    if (adet < 2 && toplam < 0.15) continue; // tek hücrelik soluk fark: gürültü
    bolgeler.push({ sayfa, x: x0 * HUCRE, y: y0 * HUCRE, en: (x1 - x0 + 1) * HUCRE, boy: (y1 - y0 + 1) * HUCRE, siddet: Math.min(1, toplam / adet / 0.5) });
  }
  bolgeler.sort((p, q) => q.en * q.boy * q.siddet - p.en * p.boy * p.siddet);
  return bolgeler.slice(0, azami);
}
