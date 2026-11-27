import { afterEach, describe, expect, it } from "vitest";
import { hukumVer, karsilastir } from "../src/analiz.js";
import { farkSatiri } from "../src/istem.js";
import type { Bulgu, Fark, Rapor } from "../src/tipler.js";
import { ayar, ornek, sahteLlm, type SahteLlm } from "./yardimci/ortam.js";

let llm: SahteLlm | undefined;
afterEach(async () => {
  await llm?.kapat();
  llm = undefined;
});

const donusum = (ek = {}) => ({ mod: "donusum" as const, a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf"), ...ek });
const sablon = (ek = {}) => ({ mod: "sablon" as const, a: ornek("sablon-referans.pdf"), b: ornek("sablon-yeni.pdf"), ...ek });
const kapsayan = (r: Rapor, kimlik: string) => r.bulgular.filter((b) => b.farklar.includes(kimlik));

describe("LLM olmadan", () => {
  it("ayarlanmamışsa makine farklarıyla rapor verir ve nedenini söyler", async () => {
    const r = await karsilastir(donusum(), ayar(), null);
    expect(r.llm.kullanildi).toBe(false);
    expect(r.llm.hata).toContain("LLM ayarlanmamış");
    expect(r.hukum.durum).toBe("sorun");
    expect(r.hukum.metin).toMatch(/\d+ kritik fark/);
    expect(r.bulgular.every((b) => b.kaynak === "kural")).toBe(true);
    // Her ham fark bir bulguda yer alır.
    expect(new Set(r.bulgular.flatMap((b) => b.farklar))).toEqual(new Set(r.farklar.map((f) => f.kimlik)));
    // En önemliler başta.
    expect(r.bulgular[0]!.onem).toBe("kritik");
    expect(r.belgeler.a).toMatchObject({ ad: "ekstre-eski.pdf", sayfa: 2 });
  });

  it("aynı iki dosyada temiz hüküm verir ve LLM'i çağırmaz", async () => {
    llm = await sahteLlm(() => "{}");
    const r = await karsilastir({ mod: "donusum", a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-eski.pdf") }, ayar(llm.adres), null);
    expect(r.hukum).toEqual({ durum: "temiz", metin: "Fark bulunamadı: iki ekstre eşdeğer." });
    expect(llm.istekler).toHaveLength(0);
  });

  it("her sayfada tekrarlayan aynı farkı tek bulguda toplar", async () => {
    const r = await karsilastir(sablon(), ayar(), null);
    const iletisim = r.bulgular.filter((b) => b.aciklama.includes("444 0 000"));
    expect(iletisim).toHaveLength(1);
    expect(iletisim[0]!.farklar).toHaveLength(2);
    expect(iletisim[0]!.aciklama).toContain("2 sayfada tekrarlıyor");
  });

  it("metin katmanı olmayan dosyada uyarır", async () => {
    const r = await karsilastir({ mod: "donusum", a: ornek("ekstre-eski.pdf"), b: { ad: "tarama.png", sayfalar: [{ no: 1, en: 595, boy: 842 }] } }, ayar(), null);
    expect(r.uyarilar.join(" ")).toContain("metin katmanı yok");
  });
});

describe("LLM'e güven sınırı", () => {
  it("LLM fark gizleyemez: değinmediği farklar kural bulgusu olarak kalır", async () => {
    llm = await sahteLlm(() => JSON.stringify({ ozet: "Her şey yolunda, fark yok.", bulgular: [] }));
    const r = await karsilastir(donusum(), ayar(llm.adres), null);
    expect(r.llm.kullanildi).toBe(true);
    expect(new Set(r.bulgular.flatMap((b) => b.farklar))).toEqual(new Set(r.farklar.map((f) => f.kimlik)));
    expect(r.hukum.durum).toBe("sorun"); // hüküm LLM'in özetinden değil bulgulardan çıkar
  });

  it("LLM kritik bir tutar farkının önemini düşüremez", async () => {
    let tutarKimligi = "";
    llm = await sahteLlm((istek) => {
      const metin: string = istek.govde.messages[1].content;
      tutarKimligi = /^(F\d+) \[degisti\/tutar/m.exec(metin)![1]!;
      return JSON.stringify({ ozet: "Önemsiz.", bulgular: [{ farklar: [tutarKimligi], baslik: "Küçük yuvarlama", aciklama: "Önemsiz.", onem: "dusuk", beklenen: null }] });
    });
    const r = await karsilastir(donusum(), ayar(llm.adres), null);
    const bulgu = kapsayan(r, tutarKimligi)[0]!;
    expect(bulgu.kaynak).toBe("llm");
    expect(bulgu.baslik).toBe("Küçük yuvarlama");
    expect(bulgu.onem).toBe("kritik");
  });

  it("kullanıcının notu farkı kapsıyorsa LLM onu bilinen fark sayabilir; not yoksa sayamaz", async () => {
    const yanitla = (istek: any) => {
      const kimlik = /^(F\d+) \[degisti\/tutar/m.exec(istek.govde.messages[1].content)![1]!;
      return JSON.stringify({ ozet: "", bulgular: [{ farklar: [kimlik], baslik: "Bilinen yuvarlama", aciklama: "", onem: "bilgi", beklenen: true }] });
    };
    llm = await sahteLlm(yanitla);
    const notlu = await karsilastir(donusum({ not: "Dönem borcundaki kuruş farkı biliniyor, kabul edildi." }), ayar(llm.adres), null);
    const b1 = notlu.bulgular.find((b) => b.baslik === "Bilinen yuvarlama")!;
    expect(b1).toMatchObject({ beklenen: true, onem: "bilgi" });
    expect(llm.istekler[0]!.govde.messages[1].content).toContain("kuruş farkı biliniyor");

    const notsuz = await karsilastir(donusum(), ayar(llm.adres), null);
    const b2 = notsuz.bulgular.find((b) => b.baslik === "Bilinen yuvarlama")!;
    expect(b2).toMatchObject({ beklenen: null, onem: "kritik" });
  });

  it("uydurma kimlikler atılır; hiçbir farka dayanmayan bulgu kanıtsız kalır ve hükmü etkilemez", async () => {
    llm = await sahteLlm(() =>
      JSON.stringify({ ozet: "", bulgular: [{ farklar: ["F999", "X1"], baslik: "Uydurma fark", aciklama: "Faiz oranı yanlış.", onem: "kritik", beklenen: null }] }),
    );
    const r = await karsilastir({ mod: "donusum", a: ornek("ekstre-eski.pdf"), b: ornek("sablon-referans.pdf") }, ayar(llm.adres), null);
    expect(r.farklar).toHaveLength(0);
    expect(llm.istekler).toHaveLength(0); // fark yoksa LLM çağrılmaz

    const r2 = await karsilastir(donusum(), ayar(llm.adres), null);
    const uydurma = r2.bulgular.find((b) => b.baslik === "Uydurma fark")!;
    expect(uydurma).toMatchObject({ farklar: [], onem: "bilgi", kaynak: "llm" });
  });

  it("LLM farklı türden farkları tek bulguda toplayamaz: o bulgu alınmaz, farklar makine bulgusu olur", async () => {
    let kimlikler: string[] = [];
    llm = await sahteLlm((istek) => {
      const metin: string = istek.govde.messages[1].content;
      const bul = (desen: RegExp) => desen.exec(metin)![1]!;
      kimlikler = [bul(/^(F\d+) \[degisti\/yazim/m), bul(/^(F\d+) \[degisti\/bicim/m), bul(/^(F\d+) \[degisti\/tutar/m), bul(/^(F\d+) \[kaydi\/yerlesim/m)];
      return JSON.stringify({ ozet: "", bulgular: [{ farklar: kimlikler, baslik: "Biçim farklılıkları", aciklama: "Küçük biçim farkları.", onem: "dusuk", beklenen: null }] });
    });
    const r = await karsilastir(donusum(), ayar(llm.adres), null);
    expect(r.bulgular.some((b) => b.baslik === "Biçim farklılıkları")).toBe(false);
    for (const k of kimlikler) {
      expect(kapsayan(r, k)).toHaveLength(1);
      expect(kapsayan(r, k)[0]!.kaynak).toBe("kural");
    }
    expect(kapsayan(r, kimlikler[2]!)[0]!.onem).toBe("kritik");
    expect(r.uyarilar.join(" ")).toContain("1 bulgusu farklı türden farkları");
  });

  it("dönüşümde LLM kuralın verdiği önemi düşüremez; şablonda düşürebilir", async () => {
    const yanitla = (istek: any) => {
      const kimlik = /^(F\d+) \[degisti\/metin/m.exec(istek.govde.messages[1].content)![1]!;
      return JSON.stringify({ ozet: "", bulgular: [{ farklar: [kimlik], baslik: "Önemsiz metin", aciklama: "", onem: "bilgi", beklenen: null }] });
    };
    llm = await sahteLlm(yanitla);
    const d = await karsilastir(donusum(), ayar(llm.adres), null);
    expect(d.bulgular.find((b) => b.baslik === "Önemsiz metin")!.onem).toBe("orta");
    const s = await karsilastir(sablon(), ayar(llm.adres), null);
    expect(s.bulgular.find((b) => b.baslik === "Önemsiz metin")!.onem).toBe("bilgi");
  });

  it("bir fark kimliği yalnızca bir bulguda geçer", async () => {
    let tutarlar: string[] = [];
    llm = await sahteLlm((istek) => {
      tutarlar = [...(istek.govde.messages[1].content as string).matchAll(/^(F\d+) \[degisti\/tutar/gm)].map((e) => e[1]!);
      const [x, y] = tutarlar;
      return JSON.stringify({ ozet: "", bulgular: [{ farklar: [x, x!.toLowerCase()], baslik: "Birinci", aciklama: "a", onem: "orta" }, { farklar: [x, y], baslik: "İkinci", aciklama: "b", onem: "orta" }] });
    });
    const r = await karsilastir(donusum(), ayar(llm.adres), null);
    const [x, y] = tutarlar as [string, string];
    expect(kapsayan(r, x)).toHaveLength(1);
    expect(kapsayan(r, x)[0]!.baslik).toBe("Birinci");
    expect(kapsayan(r, y)[0]!.baslik).toBe("İkinci");
  });
});

describe("LLM hataları", () => {
  it("servis hata verirse makine farklarıyla rapor yine çıkar", async () => {
    llm = await sahteLlm(() => ({ durum: 500, ham: "patladı" }));
    const r = await karsilastir(donusum(), ayar(llm.adres), null);
    expect(r.llm.kullanildi).toBe(false);
    expect(r.llm.hata).toContain("LLM yorumu alınamadı");
    expect(r.bulgular.length).toBeGreaterThan(5);
  });

  it("yanıt JSON değilse bir kez daha dener, yine olmazsa makine farklarına düşer", async () => {
    llm = await sahteLlm((_istek, sira) => (sira === 1 ? "Farkları inceledim, hepsi önemli." : '{"ozet": "İkinci denemede oldu.", "bulgular": []}'));
    const r = await karsilastir(donusum(), ayar(llm.adres), null);
    expect(r.ozet).toBe("İkinci denemede oldu.");
    expect(llm.istekler).toHaveLength(2);
    expect(llm.istekler[1]!.govde.messages.at(-1).content).toContain("geçerli bir JSON nesnesi değildi");

    await llm.kapat();
    llm = await sahteLlm(() => "yine düz metin");
    const r2 = await karsilastir(donusum(), ayar(llm.adres), null);
    expect(r2.llm.hata).toContain("geçerli JSON üretmedi");
  });

  it("istek.llm false ise LLM çağrılmaz", async () => {
    llm = await sahteLlm(() => "{}");
    const r = await karsilastir(donusum({ llm: false }), ayar(llm.adres), null);
    expect(llm.istekler).toHaveLength(0);
    expect(r.llm.hata).toContain("kapatıldı");
  });
});

describe("LLM'e giden içerik", () => {
  it("kart numarası gibi uzun rakam dizileri maskeli gider; ayardan kapatılırsa açık gider", () => {
    const kutu = { sayfa: 1, x: 0, y: 0, en: 10, boy: 10 };
    const f: Fark = {
      kimlik: "F1",
      tur: "degisti",
      kategori: "metin",
      onem: "kritik",
      ayrinti: "",
      a: { metin: "Kart No: 5400 1234 5678 3456", satir: "Kart No: 5400 1234 5678 3456  |  12.450,75 TL", kutu },
      b: { metin: "Kart No: 5400 9999 5678 3456", satir: "", kutu },
    };
    const maskeli = farkSatiri(f, true);
    expect(maskeli).not.toContain("1234 5678");
    expect(maskeli).not.toContain("9999");
    expect(maskeli).toContain("****3456");
    expect(maskeli).toContain("maskeli hanelerde fark var");
    expect(maskeli).toContain("12.450,75"); // tutarlar maskelenmez
    expect(farkSatiri(f, false)).toContain("5400 1234 5678 3456");
  });

  it("görsel bölge farkı da LLM'e gider (metin katmanı olmayan dosyalar)", async () => {
    llm = await sahteLlm(() => "{}");
    const a = { ad: "a.png", sayfalar: [{ no: 1, en: 595, boy: 842 }] };
    const r = await karsilastir({ mod: "donusum", a, b: a, gorsel_bolgeler: [{ sayfa: 1, x: 10, y: 10, en: 50, boy: 50, siddet: 1 }] }, ayar(llm.adres), null);
    expect(llm.istekler).toHaveLength(1);
    expect(llm.istekler[0]!.govde.messages[1].content).toContain("F1 [gorsel/gorsel, s.1]");
    expect(r.bulgular).toHaveLength(1);
  });

  it("görsel girdi yalnızca ayarda açıksa ve en fazla altışar sayfa gider", async () => {
    llm = await sahteLlm(() => "{}");
    const goruntu = "data:image/jpeg;base64,AAAA";
    const goruntuler = { a: Array(9).fill(goruntu), b: [goruntu, "javascript:alert(1)", "data:text/html;base64,AAAA"] };
    await karsilastir(donusum({ goruntuler }), ayar(llm.adres), null);
    expect(typeof llm.istekler[0]!.govde.messages[1].content).toBe("string");

    const r = await karsilastir(donusum({ goruntuler }), ayar(llm.adres, { gorsel: true }), null);
    const icerik = llm.istekler[1]!.govde.messages[1].content as { type: string }[];
    expect(icerik.filter((p) => p.type === "image_url")).toHaveLength(7);
    expect(r.llm.gorsel).toBe(true);
  });

  it("şablon modunda istek notu gider; karşılanmayanlar rapora girer ve hüküm sorun olur", async () => {
    llm = await sahteLlm((istek) => {
      const metin: string = istek.govde.messages[1].content;
      const kampanya = /^(F\d+) \[fazla\/metin[^\n]*KAMPANYA/m.exec(metin)![1]!;
      const asgari = /^(F\d+) \[degisti\/metin[^\n]*Asgari Ödeme/m.exec(metin)![1]!;
      return JSON.stringify({
        ozet: "Çoğu istek karşılanmış.",
        bulgular: [
          { farklar: [kampanya], baslik: "Kampanya kutusu eklendi", aciklama: "İstek 1.", onem: "orta", beklenen: true },
          { farklar: [asgari], baslik: "Asgari etiketi değişti", aciklama: "İstenmemişti.", onem: "orta", beklenen: false },
        ],
        karsilanmayan: ["Yıllık Maliyet Oranı satırı eklenmemiş"],
      });
    });
    const istekNotu = "1. Kampanya kutusu eklensin.\n6. Yıllık Maliyet Oranı satırı eklensin.";
    const r = await karsilastir(sablon({ not: istekNotu }), ayar(llm.adres), null);
    expect(llm.istekler[0]!.govde.messages[0].content).toContain("şablon");
    expect(llm.istekler[0]!.govde.messages[1].content).toContain("Yıllık Maliyet Oranı satırı eklensin");
    expect(r.karsilanmayan).toEqual(["Yıllık Maliyet Oranı satırı eklenmemiş"]);
    expect(r.bulgular.find((b) => b.baslik === "Kampanya kutusu eklendi")).toMatchObject({ beklenen: true, onem: "bilgi" });
    expect(r.bulgular.find((b) => b.baslik === "Asgari etiketi değişti")).toMatchObject({ beklenen: false });
    expect(r.hukum.durum).toBe("sorun");
    expect(r.hukum.metin).toContain("1 karşılanmamış istek");
  });
});

describe("hüküm", () => {
  const b = (onem: Bulgu["onem"], beklenen: Bulgu["beklenen"] = null): Bulgu => ({ kimlik: "", baslik: "", aciklama: "", onem, kategori: "metin", farklar: ["F1"], beklenen, kaynak: "kural" });
  it("dönüşüm: kritik varsa sorun, yalnızca küçük farklarda dikkat, bilinenlerde temiz", () => {
    expect(hukumVer("donusum", [b("kritik"), b("dusuk")], [], false).durum).toBe("sorun");
    expect(hukumVer("donusum", [b("orta")], [], false).durum).toBe("dikkat");
    expect(hukumVer("donusum", [b("dusuk")], [], false).durum).toBe("dikkat");
    expect(hukumVer("donusum", [b("bilgi", true)], [], true).durum).toBe("temiz");
  });
  it("şablon: istek değerlendirildiyse istenmeyen ya da karşılanmayan sorun, hepsi istenense temiz", () => {
    expect(hukumVer("sablon", [b("bilgi", true)], [], true).durum).toBe("temiz");
    expect(hukumVer("sablon", [b("orta", false)], [], true).durum).toBe("sorun");
    expect(hukumVer("sablon", [b("bilgi", true)], ["eksik"], true).durum).toBe("sorun");
    expect(hukumVer("sablon", [b("orta")], [], false).durum).toBe("dikkat");
    // LLM bir değişikliği istekle eşleştirmediyse "uyumlu" denmez.
    const belirsiz = hukumVer("sablon", [b("bilgi", true), b("orta", null)], [], true);
    expect(belirsiz.durum).toBe("dikkat");
    expect(belirsiz.metin).toContain("1 değişiklik istekle eşleştirilemedi");
  });
});
