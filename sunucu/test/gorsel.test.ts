import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { karsilastir } from "../src/analiz.js";
import { gorselBolgeler, pdfjsKlasoru } from "../src/ciz.js";
import { bolgeleriBul, HUCRE, hucreFarki, OLCEK } from "../src/gorsel-fark.js";
import { ayar, KOK, ornek } from "./yardimci/ortam.js";

const pdf = (ad: string) => new Uint8Array(fs.readFileSync(path.join(KOK, "ornekler", ad)));

/** Beyaz bir sayfa; verilen dikdörtgenler (piksel) siyaha boyanır. */
function sayfa(en: number, boy: number, kutular: [number, number, number, number][] = [], renk = 0): Uint8ClampedArray {
  const p = new Uint8ClampedArray(en * boy * 4).fill(255);
  for (const [x0, y0, g, y] of kutular) {
    for (let j = y0; j < y0 + y; j++) for (let i = x0; i < x0 + g; i++) p.fill(renk, (j * en + i) * 4, (j * en + i) * 4 + 3);
  }
  return p;
}

describe("görüntü farkı hesabı", () => {
  it("aynı iki görüntüde fark bulmaz", () => {
    const a = sayfa(200, 200, [[40, 40, 30, 30]]);
    const h = hucreFarki(a, a.slice(), 200, 200);
    expect(h.farkli).toBe(0);
    expect(bolgeleriBul(h, 1)).toEqual([]);
  });

  it("eksik bir şekli tek bölge olarak, nokta biriminde bulur", () => {
    const h = hucreFarki(sayfa(400, 400, [[80, 160, 64, 48]]), sayfa(400, 400), 400, 400);
    const bolgeler = bolgeleriBul(h, 3);
    expect(bolgeler).toHaveLength(1);
    // 80 piksel = 40 nokta (ölçek 2); hücre 4 nokta.
    expect(bolgeler[0]).toMatchObject({ sayfa: 3, x: 80 / OLCEK, y: 160 / OLCEK, en: 64 / OLCEK, boy: 48 / OLCEK });
    expect(bolgeler[0]!.x % HUCRE).toBe(0);
    expect(bolgeler[0]!.siddet).toBeGreaterThan(0.5);
  });

  it("uzak iki farkı ayrı bölge sayar; tek hücrelik soluk farkı gürültü sayar", () => {
    const iki = hucreFarki(sayfa(400, 400, [[16, 16, 32, 32], [320, 320, 32, 32]]), sayfa(400, 400), 400, 400);
    expect(bolgeleriBul(iki, 1)).toHaveLength(2);
    const soluk = hucreFarki(sayfa(400, 400, [[100, 100, 3, 3]], 200), sayfa(400, 400), 400, 400);
    expect(bolgeleriBul(soluk, 1)).toEqual([]);
  });

  it("renk değişimini de fark sayar", () => {
    const kirmizi = sayfa(200, 200);
    for (let j = 40; j < 80; j++) for (let i = 40; i < 80; i++) kirmizi.set([220, 20, 20], (j * 200 + i) * 4);
    const h = hucreFarki(sayfa(200, 200, [[40, 40, 40, 40]], 20), kirmizi, 200, 200);
    expect(bolgeleriBul(h, 1)).toHaveLength(1);
  });
});

describe("sunucuda sayfa çizimi", () => {
  it("pdf.js'e verilen klasör yolu her işletim sisteminde / ile biter", () => {
    expect(pdfjsKlasoru("D:\\a\\proje\\node_modules\\pdfjs-dist", "cmaps")).toBe("D:/a/proje/node_modules/pdfjs-dist/cmaps/");
    expect(pdfjsKlasoru("/home/kullanici/proje/node_modules/pdfjs-dist/", "standard_fonts")).toBe("/home/kullanici/proje/node_modules/pdfjs-dist/standard_fonts/");
  });


  it("örnek ekstrelerde eksik logoyu bulur", async () => {
    const sonuc = await gorselBolgeler(pdf("ekstre-eski.pdf"), pdf("ekstre-yeni.pdf"));
    expect(sonuc.uyari).toBeUndefined();
    // Logo her sayfanın sol üstünde, yaklaşık (28, 26) noktasında 30 × 30 nokta.
    for (const no of [1, 2]) {
      const logo = sonuc.bolgeler.find((b) => b.sayfa === no && b.x <= 30 && b.y <= 30 && b.x + b.en >= 56 && b.y + b.boy >= 54);
      expect(logo, `sayfa ${no}: ${JSON.stringify(sonuc.bolgeler.filter((b) => b.sayfa === no).slice(0, 3))}`).toBeDefined();
    }
  });

  it("aynı dosyada bölge bulmaz; bozuk dosyada hata atmaz, uyarır", async () => {
    expect((await gorselBolgeler(pdf("ekstre-eski.pdf"), pdf("ekstre-eski.pdf"))).bolgeler).toEqual([]);
    const bozuk = await gorselBolgeler(new TextEncoder().encode("pdf değil"), pdf("ekstre-eski.pdf"));
    expect(bozuk.bolgeler).toEqual([]);
    expect(bozuk.uyari).toContain("Görüntü farkı hesaplanamadı");
  });
});

describe("karşılaştırmada görüntü farkı", () => {
  const cift = { mod: "donusum" as const, a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf") };
  const gorselSayisi = async (ek: object) => (await karsilastir({ ...cift, ...ek }, ayar(), null)).farklar.filter((f) => f.tur === "gorsel").length;

  it("bölge gönderilmezse sunucu kendisi hesaplar (arayüzsüz çağrı)", async () => {
    expect(await gorselSayisi({})).toBe(2);
  });

  it("arayüz bölgeleri gönderdiyse onlar kullanılır, sunucu yeniden çizmez", async () => {
    expect(await gorselSayisi({ gorsel_bolgeler: [] })).toBe(0);
    expect(await gorselSayisi({ gorsel_bolgeler: [{ sayfa: 1, x: 400, y: 700, en: 60, boy: 30, siddet: 1 }] })).toBe(1);
  });

  it("gorsel_fark false ise hesaplanmaz", async () => {
    expect(await gorselSayisi({ gorsel_fark: false })).toBe(0);
  });
});
