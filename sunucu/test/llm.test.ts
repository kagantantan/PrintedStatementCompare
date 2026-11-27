import { afterEach, describe, expect, it } from "vitest";
import { baglantiSina, basliklar, dusunceyiAt, jsonAyikla, LlmHatasi, modeller, sohbet } from "../src/llm.js";
import { ayar, sahteLlm, type SahteLlm } from "./yardimci/ortam.js";

let llm: SahteLlm | undefined;
afterEach(async () => {
  await llm?.kapat();
  llm = undefined;
});

describe("anahtar başlığı", () => {
  it("seçilen başlık türüne göre gider", () => {
    expect(basliklar("bearer", "GIZLI").authorization).toBe("Bearer GIZLI");
    expect(basliklar("api-key", "GIZLI")["api-key"]).toBe("GIZLI");
    expect(basliklar("x-api-key", "GIZLI")["x-api-key"]).toBe("GIZLI");
    expect(JSON.stringify(basliklar("yok", "GIZLI"))).not.toContain("GIZLI");
    expect(basliklar("bearer", null).authorization).toBeUndefined();
  });

  it("istekte gerçekten o başlıkla gider", async () => {
    llm = await sahteLlm(() => "TAMAM");
    await sohbet(ayar(llm.adres, { baslik: "x-api-key" }).llm, "GIZLI-123", [{ role: "user", content: "selam" }]);
    const istek = llm.istekler[0]!;
    expect(istek.yol).toBe("/v1/chat/completions");
    expect(istek.basliklar["x-api-key"]).toBe("GIZLI-123");
    expect(istek.basliklar.authorization).toBeUndefined();
    expect(istek.govde).toMatchObject({ model: "kurum-model", stream: false, temperature: 0 });
  });
});

describe("istek gövdesine ek", () => {
  it("her isteğe eklenir ama modeli ve mesajları ezemez", async () => {
    llm = await sahteLlm(() => "TAMAM");
    // Doğrulama yasak alanları zaten reddeder; istemci yine de kendi alanlarını sona yazar.
    const a = { ...ayar(llm.adres).llm, ek_govde: { reasoning_effort: "none", model: "baska", stream: true } };
    await sohbet(a, null, [{ role: "user", content: "selam" }]);
    expect(llm.istekler[0]!.govde).toMatchObject({ reasoning_effort: "none", model: "kurum-model", stream: false });
  });
});

describe("sohbet", () => {
  it("düşünme bloğunu atar", async () => {
    llm = await sahteLlm(() => "<think>uzun uzun düşünüyorum</think>\nTAMAM");
    expect(await sohbet(ayar(llm.adres).llm, null, [{ role: "user", content: "x" }])).toBe("TAMAM");
    expect(dusunceyiAt("yarım kalmış düşünce</think> sonuç")).toBe("sonuç");
  });

  it("response_format desteklenmiyorsa onsuz yeniden dener ve bunu hatırlar", async () => {
    llm = await sahteLlm((istek) => (istek.govde.response_format ? { durum: 400, govde: { error: "response_format desteklenmiyor" } } : '{"ozet":"tamam"}'));
    const a = ayar(llm.adres).llm;
    expect(await sohbet(a, null, [{ role: "user", content: "x" }], { json: true })).toBe('{"ozet":"tamam"}');
    expect(llm.istekler).toHaveLength(2);
    await sohbet(a, null, [{ role: "user", content: "x" }], { json: true });
    expect(llm.istekler).toHaveLength(3);
    expect(llm.istekler[2]!.govde.response_format).toBeUndefined();
  });

  it("hata mesajları anlaşılırdır ve anahtarı sızdırmaz", async () => {
    llm = await sahteLlm((istek) => ({ durum: 401, govde: { error: `geçersiz anahtar: ${istek.basliklar.authorization}` } }));
    await expect(sohbet(ayar(llm.adres).llm, "COK-GIZLI", [{ role: "user", content: "x" }])).rejects.toThrow(/anahtarı kabul etmedi \(401\)/);

    await llm.kapat();
    llm = await sahteLlm((istek) => ({ durum: 500, ham: `patladı, başlık: ${istek.basliklar.authorization}` }));
    const hata = await sohbet(ayar(llm.adres).llm, "COK-GIZLI", [{ role: "user", content: "x" }]).then(() => new Error("hata bekleniyordu"), (e) => e as Error);
    expect(hata).toBeInstanceOf(LlmHatasi);
    expect(hata.message).toContain("500");
    expect(hata.message).not.toContain("COK-GIZLI");
  });

  it("kapalı servise ulaşılamadığını söyler", async () => {
    await expect(sohbet(ayar("http://127.0.0.1:9/v1").llm, null, [{ role: "user", content: "x" }])).rejects.toThrow(/ulaşılamadı|bağlanılamadı/);
  });

  it("adres ya da model yoksa istek atmadan söyler", async () => {
    await expect(sohbet(ayar("").llm, null, [])).rejects.toThrow(/Model adı|adresi/);
  });
});

describe("JSON ayıklama", () => {
  it("kod çitini, öndeki açıklamayı ve sondaki virgülü hoş görür", () => {
    expect(jsonAyikla('```json\n{"ozet": "a"}\n```')).toEqual({ ozet: "a" });
    expect(jsonAyikla('İşte sonuç:\n{"ozet": "a", "bulgular": [1, 2,],}\nUmarım yardımcı olur.')).toEqual({ ozet: "a", bulgular: [1, 2] });
    expect(jsonAyikla('<think>{"yanlis": 1}</think>{"ozet": "a"}')).toEqual({ ozet: "a" });
  });
  it("JSON yoksa null döner", () => {
    expect(jsonAyikla("JSON yok")).toBeNull();
    expect(jsonAyikla("[1, 2]")).toBeNull();
  });
});

describe("bağlantı sınama", () => {
  it("model listesini ve sohbeti dener", async () => {
    llm = await sahteLlm(() => "TAMAM");
    const sonuc = await baglantiSina(ayar(llm.adres).llm, null);
    expect(sonuc.tamam).toBe(true);
    expect(sonuc.modeller).toEqual(["baska-model", "kurum-model"]);
    expect(sonuc.adimlar.map((a) => a.ad)).toEqual(["Model listesi", "Sohbet"]);
    expect(await modeller(ayar(llm.adres).llm, null)).toHaveLength(2);
  });

  it("görsel girdi açıksa onu da dener; model görmüyorsa söyler", async () => {
    llm = await sahteLlm((istek) => (Array.isArray(istek.govde.messages[0].content) ? "Görsel göremiyorum." : "TAMAM"));
    const sonuc = await baglantiSina(ayar(llm.adres, { gorsel: true }).llm, null);
    expect(sonuc.tamam).toBe(false);
    const gorsel = sonuc.adimlar.find((a) => a.ad === "Görsel girdi")!;
    expect(gorsel.tamam).toBe(false);
    expect(gorsel.ayrinti).toContain("desteklemiyor olabilir");
    const gonderilen = llm.istekler.at(-1)!.govde.messages[0].content;
    expect(gonderilen[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("anahtar yanlışsa sohbet adımı başarısız olur", async () => {
    llm = await sahteLlm(() => ({ durum: 403, govde: {} }));
    const sonuc = await baglantiSina(ayar(llm.adres).llm, "yanlis");
    expect(sonuc.tamam).toBe(false);
    expect(sonuc.adimlar.find((a) => a.ad === "Sohbet")!.ayrinti).toContain("403");
  });
});
