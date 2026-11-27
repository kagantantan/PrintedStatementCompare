import { afterEach, describe, expect, it } from "vitest";
import { IsKuyrugu, KuyrukDolu } from "../src/isler.js";
import type { KarsilastirIstegi, Rapor } from "../src/tipler.js";

const istek = (ad: string) => ({ mod: "donusum", a: { ad }, b: { ad } }) as KarsilastirIstegi;
const rapor = (ad: string) => ({ ozet: ad }) as Rapor;
const bekle = (ms = 5) => new Promise((tamam) => setTimeout(tamam, ms));

/** Elle bitirilen işler: her çağrı, testin çözeceği bir söz döner. */
function elle() {
  const bekleyenler: { ad: string; bitir(r?: Rapor): void; patlat(mesaj: string): void }[] = [];
  const calistir = (i: KarsilastirIstegi) =>
    new Promise<Rapor>((tamam, hata) => {
      bekleyenler.push({ ad: i.a.ad, bitir: (r) => tamam(r ?? rapor(i.a.ad)), patlat: (m) => hata(new Error(m)) });
    });
  return { bekleyenler, calistir };
}

let kuyruk: IsKuyrugu | undefined;
afterEach(() => kuyruk?.kapat());

describe("iş kuyruğu", () => {
  it("işi sıraya alır, çalıştırır, sonucu sahibine verir", async () => {
    const { bekleyenler, calistir } = elle();
    kuyruk = new IsKuyrugu(calistir, { es_zamanli: 1, azami_sira: 5, omur_ms: 60_000 });
    const is = kuyruk.ekle("ali", istek("bir"));
    expect(is.durum).toBe("calisiyor"); // boşta olduğu için hemen başlar
    expect(is.rapor).toBeUndefined();
    bekleyenler[0]!.bitir();
    await bekle();
    const biten = kuyruk.al("ali", is.kimlik)!;
    expect(biten.durum).toBe("bitti");
    expect(biten.rapor).toEqual(rapor("bir"));
    expect(biten.sure_ms).toBeGreaterThanOrEqual(0);
    expect(biten.bitis).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("aynı anda yalnızca izin verilen kadar iş çalışır; gerisi sırasını bekler", async () => {
    const { bekleyenler, calistir } = elle();
    kuyruk = new IsKuyrugu(calistir, { es_zamanli: 1, azami_sira: 5, omur_ms: 60_000 });
    const bir = kuyruk.ekle("ali", istek("bir"));
    const iki = kuyruk.ekle("ali", istek("iki"));
    const uc = kuyruk.ekle("ali", istek("üç"));
    expect([bir.durum, iki.durum, uc.durum]).toEqual(["calisiyor", "sirada", "sirada"]);
    expect([iki.sira, uc.sira]).toEqual([1, 2]);
    expect(bekleyenler.map((b) => b.ad)).toEqual(["bir"]);
    expect(kuyruk.durum()).toEqual({ sirada: 2, calisan: 1 });

    bekleyenler[0]!.bitir();
    await bekle();
    expect(bekleyenler.map((b) => b.ad)).toEqual(["bir", "iki"]); // sırayla
    expect(kuyruk.al("ali", uc.kimlik)).toMatchObject({ durum: "sirada", sira: 1 });
  });

  it("kuyruk dolunca yeni iş almaz", () => {
    const { calistir } = elle();
    kuyruk = new IsKuyrugu(calistir, { es_zamanli: 1, azami_sira: 2, omur_ms: 60_000 });
    kuyruk.ekle("ali", istek("çalışan"));
    kuyruk.ekle("ali", istek("sırada 1"));
    kuyruk.ekle("ali", istek("sırada 2"));
    expect(() => kuyruk!.ekle("ali", istek("fazla"))).toThrow(KuyrukDolu);
  });

  it("bir işi yalnızca sahibi görebilir ve silebilir", async () => {
    const { bekleyenler, calistir } = elle();
    kuyruk = new IsKuyrugu(calistir, { es_zamanli: 1, azami_sira: 5, omur_ms: 60_000 });
    const is = kuyruk.ekle("ali", istek("gizli"));
    expect(kuyruk.al("veli", is.kimlik)).toBeNull();
    expect(kuyruk.sil("veli", is.kimlik)).toBe(false);
    expect(kuyruk.al("ali", "olmayan-kimlik")).toBeNull();
    bekleyenler[0]!.bitir();
    await bekle();
    expect(kuyruk.al("veli", is.kimlik)).toBeNull();
    expect(kuyruk.al("ali", is.kimlik)!.durum).toBe("bitti");
  });

  it("hata veren iş kuyruğu kilitlemez; hata sahibine söylenir", async () => {
    const { bekleyenler, calistir } = elle();
    kuyruk = new IsKuyrugu(calistir, { es_zamanli: 1, azami_sira: 5, omur_ms: 60_000 });
    const bozuk = kuyruk.ekle("ali", istek("bozuk"));
    const saglam = kuyruk.ekle("ali", istek("sağlam"));
    bekleyenler[0]!.patlat("a.pdf: Dosya PDF olarak okunamadı.");
    await bekle();
    expect(kuyruk.al("ali", bozuk.kimlik)).toMatchObject({ durum: "hata", hata: "a.pdf: Dosya PDF olarak okunamadı." });
    expect(kuyruk.al("ali", saglam.kimlik)!.durum).toBe("calisiyor");
  });

  it("silinen iş sıradan düşer; çalışırken silinen işin sonucu saklanmaz", async () => {
    const { bekleyenler, calistir } = elle();
    kuyruk = new IsKuyrugu(calistir, { es_zamanli: 1, azami_sira: 5, omur_ms: 60_000 });
    const calisan = kuyruk.ekle("ali", istek("çalışan"));
    const bekleyen = kuyruk.ekle("ali", istek("bekleyen"));
    const sonraki = kuyruk.ekle("ali", istek("sonraki"));
    expect(kuyruk.sil("ali", bekleyen.kimlik)).toBe(true);
    expect(kuyruk.sil("ali", calisan.kimlik)).toBe(true);
    bekleyenler[0]!.bitir();
    await bekle();
    expect(kuyruk.al("ali", calisan.kimlik)).toBeNull();
    expect(bekleyenler.map((b) => b.ad)).toEqual(["çalışan", "sonraki"]); // silinen hiç çalışmadı
    expect(kuyruk.al("ali", sonraki.kimlik)!.durum).toBe("calisiyor");
  });

  it("biten işin sonucu süresi dolunca silinir", async () => {
    let saat = 1_000_000;
    const { bekleyenler, calistir } = elle();
    kuyruk = new IsKuyrugu(calistir, { es_zamanli: 1, azami_sira: 5, omur_ms: 10_000, simdi: () => saat });
    const is = kuyruk.ekle("ali", istek("eski"));
    bekleyenler[0]!.bitir();
    await bekle();
    saat += 9_000;
    expect(kuyruk.al("ali", is.kimlik)!.durum).toBe("bitti");
    saat += 2_000;
    expect(kuyruk.al("ali", is.kimlik)).toBeNull();
  });
});
