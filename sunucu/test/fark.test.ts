import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { farkBul, type FarkSecenekleri } from "../src/fark.js";
import { parcala, pdfOku, PdfHatasi } from "../src/pdf.js";
import type { Belge, Fark } from "../src/tipler.js";
import { KOK } from "./yardimci/ortam.js";

const oku = (ad: string) => pdfOku(new Uint8Array(fs.readFileSync(path.join(KOK, "ornekler", ad))), ad);
const SEC: FarkSecenekleri = { mod: "donusum", yalniz_yapi: false, konum_toleransi: 2, punto_toleransi: 0.4 };

/** Satırlardan belge kurar: her satır [x, metin] hücreleri. */
function belge(satirlar: [number, string][][], sec: { punto?: number; ilkY?: number } = {}): Belge {
  const punto = sec.punto ?? 8.5;
  const ogeler = satirlar.flatMap((satir, s) => satir.map(([x, metin]) => ({ metin, x, taban: (sec.ilkY ?? 100) + s * 12, en: metin.length * punto * 0.5, punto })));
  const parcalar = parcala(ogeler, 1);
  parcalar.forEach((p, i) => (p.no = i));
  return { ad: "test", sayfalar: [{ no: 1, en: 595, boy: 842 }], parcalar };
}

const bul = (farklar: Fark[], tur: Fark["tur"], kategori?: Fark["kategori"]) => farklar.filter((f) => f.tur === tur && (!kategori || f.kategori === kategori));

describe("PDF okuma", () => {
  it("Türkçe karakterleri ve konumları okur; etiket ile değeri ayrı parçalardır", async () => {
    const b = await oku("ekstre-eski.pdf");
    expect(b.sayfalar).toHaveLength(2);
    expect(b.sayfalar[0]!.en).toBeCloseTo(595.28, 1);
    const etiket = b.parcalar.find((p) => p.metin === "Dönem Borcu")!;
    const deger = b.parcalar.find((p) => p.metin === ": 12.450,75 TL")!;
    expect(etiket.sayfa).toBe(1);
    expect(deger.x).toBeGreaterThan(etiket.x + etiket.en);
    expect(Math.abs(deger.y - etiket.y)).toBeLessThan(2);
    expect(deger.satir).toBe("Dönem Borcu  |  : 12.450,75 TL");
    expect(b.parcalar.some((p) => p.metin === "ŞEHİR İÇİ ULAŞIM KARTI DOLUM")).toBe(true);
  });

  it("PDF olmayan dosyayı anlaşılır hatayla reddeder", async () => {
    await expect(pdfOku(new TextEncoder().encode("bu bir pdf değil"), "bozuk.pdf")).rejects.toThrow(PdfHatasi);
  });

  it("yakın öğeleri birleştirir, uzak olanları ayırır", () => {
    const p = parcala(
      [
        { metin: "Dönem", x: 28, taban: 100, en: 25, punto: 8.5 },
        { metin: "Borcu", x: 55, taban: 100, en: 24, punto: 8.5 },
        { metin: ":", x: 198, taban: 100.4, en: 3, punto: 8.5 },
        { metin: "12.450,75 TL", x: 202, taban: 100, en: 50, punto: 8.5 },
      ],
      1,
    );
    expect(p.map((x) => x.metin)).toEqual(["Dönem Borcu", ": 12.450,75 TL"]);
  });
});

describe("fark motoru: örnek ekstreler (dönüşüm)", () => {
  it("aynı dosyada fark bulmaz", async () => {
    const a = await oku("ekstre-eski.pdf");
    expect(farkBul(a, await oku("ekstre-eski.pdf"), SEC)).toEqual([]);
  });

  it("yeni sistemdeki bütün hataları bulur ve doğru sınıflar", async () => {
    const farklar = farkBul(await oku("ekstre-eski.pdf"), await oku("ekstre-yeni.pdf"), SEC);
    const ayrintilar = farklar.map((f) => `${f.tur}/${f.kategori}/${f.onem}: ${f.ayrinti}`).join("\n");

    const tutar = bul(farklar, "degisti", "tutar");
    expect(tutar, ayrintilar).toHaveLength(2); // bilgi bloğunda ve tablo sonunda
    expect(tutar.every((f) => f.onem === "kritik")).toBe(true);
    expect(tutar[0]!.ayrinti).toContain("Dönem Borcu");
    expect(tutar[0]!.ayrinti).toContain("fark -0,18");

    const tarih = bul(farklar, "degisti", "tarih");
    expect(tarih, ayrintilar).toHaveLength(1);
    expect(tarih[0]!.a!.metin).toBe("07 Kasım 2026");
    expect(tarih[0]!.onem).toBe("kritik");

    const bicim = bul(farklar, "degisti", "bicim");
    expect(bicim, ayrintilar).toHaveLength(1);
    expect(bicim[0]!.ayrinti).toContain("tarih aynı, yazılışı farklı");

    const eksik = bul(farklar, "eksik");
    expect(eksik, ayrintilar).toHaveLength(1); // işlem satırının üç hücresi tek fark
    expect(eksik[0]!.a!.metin).toBe("04 Kasım 2026  |  ŞEHİR İÇİ ULAŞIM KARTI DOLUM  |  500,00");
    expect(eksik[0]!.onem).toBe("kritik");
    expect(bul(farklar, "fazla")).toHaveLength(0);

    const metin = bul(farklar, "degisti", "metin").map((f) => f.b!.metin);
    expect(metin).toContain("ORNEK MARKET ALISVERISI ANKARA");
    expect(metin).toContain("Kalan Taksit Tutarı");

    const yazim = bul(farklar, "degisti", "yazim");
    expect(yazim.map((f) => f.b!.metin)).toEqual(["Hesap Bilgileri"]);
    expect(yazim[0]!.onem).toBe("dusuk");

    const adres = bul(farklar, "kaydi").find((f) => f.a!.metin.includes("AYŞE ÖRNEK"))!;
    expect(adres.adet).toBe(5);
    expect(adres.ayrinti).toContain("3,2 mm aşağı");

    expect(bul(farklar, "bicim").every((f) => f.ayrinti.includes("7 → 6.2"))).toBe(true);
    expect(bul(farklar, "bicim").length).toBeGreaterThan(0);
    expect(new Set(farklar.map((f) => f.kimlik)).size).toBe(farklar.length);
  });
});

describe("fark motoru: örnek şablonlar", () => {
  it("şablon değişikliklerini bulur", async () => {
    const farklar = farkBul(await oku("sablon-referans.pdf"), await oku("sablon-yeni.pdf"), { ...SEC, mod: "sablon" });
    expect(bul(farklar, "fazla").map((f) => f.b!.metin)).toContain("KAMPANYA");
    expect(bul(farklar, "eksik").map((f) => f.a!.metin)).toEqual(["Nakit Çekim Limiti  |  : 30.000,00 TL"]);
    const degisen = bul(farklar, "degisti").map((f) => `${f.a!.metin} → ${f.b!.metin}`);
    expect(degisen).toContain("Puan → Kazanılan Puan");
    expect(degisen).toContain("Ödenmesi Gereken Asgari Tutar/Oran → Asgari Ödeme Tutarı/Oranı");
    expect(farklar.some((f) => f.ayrinti.includes("444 0 000"))).toBe(true);
    expect(bul(farklar, "kaydi").some((f) => f.a!.metin.includes("ÖRNEK BANKA") && f.ayrinti.includes("sola"))).toBe(true);
    // Şablon modunda hiçbir fark "kritik" değildir: değişiklik hata sayılmaz.
    expect(farklar.some((f) => f.onem === "kritik")).toBe(false);
  });
});

describe("fark motoru: kurallar", () => {
  const A = belge([
    [[28, "Dönem Borcu"], [198, ": 1.000,00 TL"]],
    [[28, "Son Ödeme Tarihi"], [198, ": 07.12.2026"]],
    [[28, "01.11.2026"], [110, "MARKET"], [400, "150,00"]],
    [[28, "02.11.2026"], [110, "AKARYAKIT"], [400, "900,00"]],
  ]);

  it("etiketi eşleşen değeri, metni bambaşka olsa da değişiklik sayar (eksik + fazla değil)", () => {
    const B = belge([
      [[28, "Dönem Borcu"], [198, ": 987,65 TL"]],
      [[28, "Son Ödeme Tarihi"], [198, ": 07.12.2026"]],
      [[28, "01.11.2026"], [110, "MARKET"], [400, "150,00"]],
      [[28, "02.11.2026"], [110, "AKARYAKIT"], [400, "900,00"]],
    ]);
    const farklar = farkBul(A, B, SEC);
    expect(farklar).toHaveLength(1);
    expect(farklar[0]).toMatchObject({ tur: "degisti", kategori: "tutar", onem: "kritik" });
  });

  it("sayı aynı, yazılışı farklıysa tutar farkı demez", () => {
    const B = belge([
      [[28, "Dönem Borcu"], [198, ": 1,000.00 TL"]],
      [[28, "Son Ödeme Tarihi"], [198, ": 07.12.2026"]],
      [[28, "01.11.2026"], [110, "MARKET"], [400, "150,00"]],
      [[28, "02.11.2026"], [110, "AKARYAKIT"], [400, "900,00"]],
    ]);
    const farklar = farkBul(A, B, SEC);
    expect(farklar).toHaveLength(1);
    expect(farklar[0]).toMatchObject({ tur: "degisti", kategori: "bicim", onem: "orta" });
  });

  it("satır sırası değişirse eksik ve fazla demez, kayma der", () => {
    const B = belge([
      [[28, "Dönem Borcu"], [198, ": 1.000,00 TL"]],
      [[28, "Son Ödeme Tarihi"], [198, ": 07.12.2026"]],
      [[28, "02.11.2026"], [110, "AKARYAKIT"], [400, "900,00"]],
      [[28, "01.11.2026"], [110, "MARKET"], [400, "150,00"]],
    ]);
    const farklar = farkBul(A, B, SEC);
    expect(bul(farklar, "eksik")).toHaveLength(0);
    expect(bul(farklar, "fazla")).toHaveLength(0);
    expect(bul(farklar, "kaydi").length).toBeGreaterThan(0);
  });

  it("tolerans içindeki kaymayı fark saymaz, dışındakini tek farkta toplar", () => {
    const satirlar: [number, string][][] = [
      [[28, "Dönem Borcu"], [198, ": 1.000,00 TL"]],
      [[28, "Son Ödeme Tarihi"], [198, ": 07.12.2026"]],
    ];
    expect(farkBul(belge(satirlar), belge(satirlar, { ilkY: 101.5 }), SEC)).toEqual([]);
    const farklar = farkBul(belge(satirlar), belge(satirlar, { ilkY: 120 }), SEC);
    expect(farklar).toHaveLength(1);
    expect(farklar[0]).toMatchObject({ tur: "kaydi", kategori: "yerlesim", adet: 4, onem: "orta" });
    expect(farklar[0]!.ayrinti).toContain("7,1 mm aşağı");
  });

  it("punto farkını bulur", () => {
    const satirlar: [number, string][][] = [[[28, "Önemli bilgiler"]]];
    const farklar = farkBul(belge(satirlar, { punto: 8 }), belge(satirlar, { punto: 7 }), { ...SEC, konum_toleransi: 5 });
    expect(farklar).toHaveLength(1);
    expect(farklar[0]).toMatchObject({ tur: "bicim", kategori: "bicim" });
  });

  it("yalnızca şablon karşılaştırılırken veri farkı fark sayılmaz, etiket farkı sayılır", () => {
    const B = belge([
      [[28, "Dönem Borcunuz"], [198, ": 7.654,32 TL"]],
      [[28, "Son Ödeme Tarihi"], [198, ": 15.01.2027"]],
      [[28, "05.12.2026"], [110, "MARKET"], [400, "99,90"]],
      [[28, "09.12.2026"], [110, "AKARYAKIT"], [400, "1.250,00"]],
    ]);
    const farklar = farkBul(A, B, { ...SEC, mod: "sablon", yalniz_yapi: true });
    expect(farklar).toHaveLength(1);
    expect(farklar[0]!.b!.metin).toBe("Dönem Borcunuz");
  });

  it("sayfa sayısı farkını kritik sayar", () => {
    const B: Belge = { ...A, sayfalar: [...A.sayfalar, { no: 2, en: 595, boy: 842 }] };
    const farklar = farkBul(A, B, SEC);
    expect(farklar).toHaveLength(1);
    expect(farklar[0]).toMatchObject({ tur: "sayfa", onem: "kritik" });
  });

  it("görsel bölgelerden yalnızca metnin açıklamadıklarını fark sayar", () => {
    const farklar = farkBul(A, A, SEC, [
      { sayfa: 1, x: 28, y: 92, en: 60, boy: 10, siddet: 0.5 }, // "Dönem Borcu" metninin üstünde
      { sayfa: 1, x: 400, y: 600, en: 80, boy: 40, siddet: 0.8 }, // boş alanda: logo ya da çizgi
    ]);
    expect(farklar).toHaveLength(1);
    expect(farklar[0]).toMatchObject({ tur: "gorsel", kategori: "gorsel", onem: "orta" });
    expect(farklar[0]!.a!.kutu.y).toBe(600);
  });
});
