import { describe, expect, it } from "vitest";
import { benzerlik, maskele, maskeliCift, sayiCoz, tarihCoz, veriGizle, yazimsiz } from "../src/metin.js";

describe("sayı çözme", () => {
  it("Türkçe ve İngilizce yazılışları aynı sayıya çözer", () => {
    expect(sayiCoz("12.450,75")).toBe(12450.75);
    expect(sayiCoz("12,450.75")).toBe(12450.75);
    expect(sayiCoz("12.450,75 TL")).toBe(12450.75);
    expect(sayiCoz("12.450,75TL")).toBe(12450.75);
    expect(sayiCoz("+8.250,00")).toBe(8250);
    expect(sayiCoz("-86,42")).toBe(-86.42);
    expect(sayiCoz("%40")).toBe(40);
    expect(sayiCoz("1.234")).toBe(1234);
    expect(sayiCoz("1.234.567")).toBe(1234567);
    expect(sayiCoz("4,5")).toBe(4.5);
  });
  it("sayı olmayanı sayı sanmaz", () => {
    expect(sayiCoz("KKDF")).toBeNull();
    expect(sayiCoz("12a")).toBeNull();
    expect(sayiCoz("")).toBeNull();
  });
});

describe("tarih çözme", () => {
  it("farklı yazılışları aynı güne çözer", () => {
    expect(tarihCoz("7 Aralık 2026")).toBe("2026-12-07");
    expect(tarihCoz(": 07.12.2026")).toBe("2026-12-07");
    expect(tarihCoz("07/12/2026")).toBe("2026-12-07");
    expect(tarihCoz("2026-12-07")).toBe("2026-12-07");
    expect(tarihCoz("7 ARALIK 2026")).toBe("2026-12-07");
  });
  it("tarih olmayanı tarih sanmaz", () => {
    expect(tarihCoz("12.450,75")).toBeNull();
    expect(tarihCoz("45.13.2026")).toBeNull();
  });
});

describe("maskeleme", () => {
  it("uzun rakam dizilerini maskeler, son dört haneyi bırakır", () => {
    expect(maskele("Kart 5400 1234 5678 3456 ile")).toBe("Kart ****3456 ile");
    expect(maskele("Müşteri No 1234567890")).toBe("Müşteri No ****7890");
    expect(maskele("TR12 0001 0002 0003 0004 0005 06")).toContain("****");
  });
  it("tutarlara ve tarihlere dokunmaz", () => {
    expect(maskele("Dönem Borcu 1.234.567.890,75 TL")).toBe("Dönem Borcu 1.234.567.890,75 TL");
    expect(maskele("07.12.2026 tarihinde 12.450,75")).toBe("07.12.2026 tarihinde 12.450,75");
    expect(maskele("0850 000")).toBe("0850 000");
  });
  it("maske farkı gizliyorsa not düşer", () => {
    const [a, b] = maskeliCift("5400 1234 5678 3456", "5400 9999 5678 3456");
    expect(a).toBe("****3456");
    expect(b).toContain("maskeli hanelerde fark var");
  });
});

describe("diğer", () => {
  it("yalnızca şablon karşılaştırırken veriyi gizler", () => {
    expect(veriGizle(": 12.450,75 TL")).toBe(veriGizle(": 9.870,10 TL"));
    expect(veriGizle("7 Aralık 2026")).toBe(veriGizle("27 Kasım 2025"));
    expect(veriGizle("Dönem Borcu")).not.toBe(veriGizle("Dönem Borcunuz"));
  });
  it("yazım farkını yok sayar", () => {
    expect(yazimsiz("HESAP BİLGİLERİ")).toBe(yazimsiz("Hesap Bilgileri"));
    expect(yazimsiz("Tutar (TL)")).toBe(yazimsiz("Tutar(TL)"));
  });
  it("benzerlik 0 ile 1 arasında", () => {
    expect(benzerlik("abc", "abc")).toBe(1);
    expect(benzerlik("abc", "xyz")).toBe(0);
    expect(benzerlik("Kalan Toplam Taksit Tutarı", "Kalan Taksit Tutarı")).toBeGreaterThan(0.6);
  });
});

describe("yazım farkı sayıları eşitlemez", () => {
  it("binlik ve ondalık ayraçları, eksi işareti korunur", () => {
    expect(yazimsiz("1.000,00")).not.toBe(yazimsiz("1,000.00"));
    expect(yazimsiz("12.450,75")).not.toBe(yazimsiz("1.245.075"));
    expect(yazimsiz("-86,42")).not.toBe(yazimsiz("86,42"));
    expect(yazimsiz(": 12.450,75 TL")).toBe(yazimsiz(":12.450,75 TL"));
  });
});
