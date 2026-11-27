// Tarayıcı tarafı: dosyayı açar, sayfaları çizer, iki sayfanın görüntüsünü karşılaştırır.
// Sayfa çizimi tarayıcıda yapılır; böylece sunucunun yerel derlenen bir bağımlılığı olmaz.
import * as pdfjs from "pdfjs-dist";
import isciUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { bolgeleriBul, hucreFarki, OLCEK } from "../../sunucu/src/gorsel-fark";
import type { DosyaGirdisi, GorselBolge, SayfaBilgisi } from "../../sunucu/src/tipler";

pdfjs.GlobalWorkerOptions.workerSrc = isciUrl;

export interface YukluBelge {
  ad: string;
  tur: "pdf" | "resim";
  boyut: number;
  sayfalar: SayfaBilgisi[];
  /** Sayfayı verilen ölçekte çizer (1 = 1 nokta 1 piksel). */
  ciz(no: number, olcek: number): Promise<HTMLCanvasElement>;
  girdi(): Promise<DosyaGirdisi>;
  kapat(): void;
}

const A4_EN = 595.28;

function tuval(en: number, boy: number): HTMLCanvasElement {
  const t = document.createElement("canvas");
  t.width = Math.max(1, Math.round(en));
  t.height = Math.max(1, Math.round(boy));
  return t;
}

export async function belgeAc(dosya: File): Promise<YukluBelge> {
  const pdfMi = dosya.type === "application/pdf" || /\.pdf$/i.test(dosya.name);
  const resimMi = /^image\/(png|jpeg)$/.test(dosya.type) || /\.(png|jpe?g)$/i.test(dosya.name);
  if (!pdfMi && !resimMi) throw new Error(`${dosya.name}: PDF, PNG ya da JPG dosyası verin.`);
  if (dosya.size > 40 * 1024 * 1024) throw new Error(`${dosya.name}: dosya 40 MB'tan büyük.`);

  if (resimMi) {
    const bit = await createImageBitmap(dosya).catch(() => {
      throw new Error(`${dosya.name}: resim açılamadı.`);
    });
    // Resimlerde ölçü bilinmez: genişliği A4 sayılır, böylece iki taraf aynı ölçekte karşılaştırılır.
    const sayfa: SayfaBilgisi = { no: 1, en: A4_EN, boy: (A4_EN * bit.height) / bit.width };
    return {
      ad: dosya.name,
      tur: "resim",
      boyut: dosya.size,
      sayfalar: [sayfa],
      async ciz(_no, olcek) {
        const t = tuval(sayfa.en * olcek, sayfa.boy * olcek);
        const c = t.getContext("2d")!;
        c.fillStyle = "#fff";
        c.fillRect(0, 0, t.width, t.height);
        c.drawImage(bit, 0, 0, t.width, t.height);
        return t;
      },
      girdi: async () => ({ ad: dosya.name, sayfalar: [sayfa] }),
      kapat: () => bit.close(),
    };
  }

  const veri = new Uint8Array(await dosya.arrayBuffer());
  const gorev = pdfjs.getDocument({
    data: veri.slice(),
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  let pdf: pdfjs.PDFDocumentProxy;
  try {
    pdf = await gorev.promise;
  } catch (e) {
    throw new Error(`${dosya.name}: ${(e as Error).name === "PasswordException" ? "PDF parola korumalı; parolasız halini verin." : "dosya PDF olarak açılamadı."}`);
  }
  const sayfalar: SayfaBilgisi[] = [];
  for (let no = 1; no <= pdf.numPages; no++) {
    const g = (await pdf.getPage(no)).getViewport({ scale: 1 });
    sayfalar.push({ no, en: g.width, boy: g.height });
  }
  // Aynı sayfayı aynı anda iki kez çizmek pdf.js'te hataya yol açar; çizimler sıraya girer.
  let kuyruk: Promise<unknown> = Promise.resolve();
  return {
    ad: dosya.name,
    tur: "pdf",
    boyut: dosya.size,
    sayfalar,
    ciz(no, olcek) {
      const is = kuyruk.then(async () => {
        const sayfa = await pdf.getPage(no);
        const gorunum = sayfa.getViewport({ scale: olcek });
        const t = tuval(gorunum.width, gorunum.height);
        const c = t.getContext("2d")!;
        c.fillStyle = "#fff";
        c.fillRect(0, 0, t.width, t.height);
        await sayfa.render({ canvas: t, canvasContext: c, viewport: gorunum }).promise;
        return t;
      });
      kuyruk = is.catch(() => undefined);
      return is;
    },
    async girdi() {
      // Büyük dosyada String.fromCharCode yığını taşırır; FileReader güvenli yoldur.
      const url = await new Promise<string>((tamam, hata) => {
        const okuyucu = new FileReader();
        okuyucu.onload = () => tamam(String(okuyucu.result));
        okuyucu.onerror = () => hata(new Error(`${dosya.name} okunamadı.`));
        okuyucu.readAsDataURL(new Blob([veri]));
      });
      return { ad: dosya.name, pdf_base64: url.slice(url.indexOf(",") + 1) };
    },
    kapat: () => void gorev.destroy(),
  };
}

export interface SayfaFarki {
  no: number;
  bolgeler: GorselBolge[];
  /** Farklı hücreleri boyayan saydam katman (PNG veri adresi); fark yoksa null. */
  katman: string | null;
  /** 0..1: sayfadaki hücrelerin ne kadarı farklı. */
  oran: number;
}

/** İki sayfayı karşılaştırır. Hesabın kendisi sunucuyla ortaktır (gorsel-fark.ts); burada yalnızca tuval ve boyama var. */
export function sayfalariKarsilastir(a: HTMLCanvasElement, bHam: HTMLCanvasElement, no: number): SayfaFarki {
  // B'nin boyutu farklıysa A'nın boyutuna getirilir.
  let b = bHam;
  if (b.width !== a.width || b.height !== a.height) {
    b = tuval(a.width, a.height);
    b.getContext("2d")!.drawImage(bHam, 0, 0, a.width, a.height);
  }
  const en = a.width;
  const boy = a.height;
  const pa = a.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, en, boy).data;
  const pb = b.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, en, boy).data;
  const h = hucreFarki(pa, pb, en, boy);
  if (!h.farkli) return { no, bolgeler: [], katman: null, oran: 0 };

  const katman = tuval(h.sutun, h.satir);
  const kc = katman.getContext("2d")!;
  const kd = kc.createImageData(h.sutun, h.satir);
  for (let i = 0; i < h.fark.length; i++) {
    if (!h.fark[i]) continue;
    kd.data[i * 4] = 214;
    kd.data[i * 4 + 1] = 36;
    kd.data[i * 4 + 2] = 159;
    kd.data[i * 4 + 3] = Math.round(90 + 120 * Math.min(1, h.fark[i]! / 0.4));
  }
  kc.putImageData(kd, 0, 0);
  return { no, bolgeler: bolgeleriBul(h, no), katman: katman.toDataURL("image/png"), oran: h.farkli / h.fark.length };
}

/** İki belgenin ortak sayfalarını karşılaştırır. */
export async function gorselFark(a: YukluBelge, b: YukluBelge, ilerleme: (sayfa: number, toplam: number) => void): Promise<SayfaFarki[]> {
  const toplam = Math.min(a.sayfalar.length, b.sayfalar.length);
  const sonuc: SayfaFarki[] = [];
  for (let no = 1; no <= toplam; no++) {
    ilerleme(no, toplam);
    const [ta, tb] = await Promise.all([a.ciz(no, OLCEK), b.ciz(no, OLCEK)]);
    sonuc.push(sayfalariKarsilastir(ta, tb, no));
    // Arayüz donmasın: her sayfadan sonra tarayıcıya nefes aldır.
    await new Promise((tamam) => setTimeout(tamam));
  }
  return sonuc;
}

/** Görsel girdi kabul eden model için sayfa görüntüleri (ilk altı sayfa). */
export async function sayfaGoruntuleri(belge: YukluBelge, azami = 6): Promise<string[]> {
  const liste: string[] = [];
  for (const sayfa of belge.sayfalar.slice(0, azami)) {
    const t = await belge.ciz(sayfa.no, 1.5);
    liste.push(t.toDataURL("image/jpeg", 0.8));
  }
  return liste;
}
