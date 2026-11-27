import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANAHTAR_DEGISKENI, ayarDogrula, AyarDeposu, AyarHatasi, VARSAYILAN_AYAR } from "../src/ayarlar.js";
import { sunucuKur } from "../src/sunucu.js";
import type { AyarYaniti, Rapor, SinamaSonucu } from "../src/tipler.js";
import { geciciKlasor, KOK, ornek, sahteLlm, type SahteLlm } from "./yardimci/ortam.js";

const PORT = 8790;
const HOST = { host: `127.0.0.1:${PORT}` };
let klasor: string;
let app: FastifyInstance;
let depo: AyarDeposu;
let llm: SahteLlm | undefined;
let eskiOrtam: string | undefined;

beforeEach(async () => {
  // Geliştiricinin kendi anahtarı testlere sızmasın.
  eskiOrtam = process.env[ANAHTAR_DEGISKENI];
  delete process.env[ANAHTAR_DEGISKENI];
  klasor = geciciKlasor();
  depo = new AyarDeposu(klasor);
  app = await sunucuKur({ kok: KOK, port: PORT, depo });
});
afterEach(async () => {
  await app.close();
  await llm?.kapat();
  llm = undefined;
  fs.rmSync(klasor, { recursive: true, force: true });
  if (eskiOrtam === undefined) delete process.env[ANAHTAR_DEGISKENI];
  else process.env[ANAHTAR_DEGISKENI] = eskiOrtam;
});

const llmAyari = (adres: string) => ({ ...VARSAYILAN_AYAR, llm: { ...VARSAYILAN_AYAR.llm, adres, model: "kurum-model", sure_sn: 20 } });
const klasorIcerigi = () => fs.readdirSync(klasor).map((ad) => fs.readFileSync(path.join(klasor, ad), "utf8")).join("\n");

describe("ayar doğrulama", () => {
  it("adresi sadeleştirir", () => {
    expect(ayarDogrula({ llm: { adres: " http://llm.kurum.local/v1/chat/completions/ " } }).llm.adres).toBe("http://llm.kurum.local/v1");
    expect(ayarDogrula({}).llm.adres).toBe("");
  });
  it("geçersiz değerleri anlaşılır hatayla reddeder", () => {
    expect(() => ayarDogrula({ llm: { adres: "llm.kurum.local" } })).toThrow(AyarHatasi);
    expect(() => ayarDogrula({ llm: { adres: "ftp://llm.kurum.local" } })).toThrow(/http/);
    expect(() => ayarDogrula({ llm: { adres: "http://kullanici:parola@llm.kurum.local/v1" } })).toThrow(/parola/);
    expect(() => ayarDogrula({ llm: { baslik: "cookie" } })).toThrow(/başlığı/);
    expect(() => ayarDogrula({ llm: { sicaklik: 9 } })).toThrow(/Sıcaklık/);
    expect(() => ayarDogrula({ karsilastirma: { konum_toleransi: -1 } })).toThrow(/Konum toleransı/);
  });
  it("istek gövdesine eki doğrular: nesne olmalı, uygulamanın alanlarını ve anahtarı taşıyamaz", () => {
    expect(ayarDogrula({ llm: { ek_govde: { reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } } } }).llm.ek_govde).toEqual({ reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } });
    expect(ayarDogrula({ llm: { ek_govde: { max_completion_tokens: 2000 } } }).llm.ek_govde).toEqual({ max_completion_tokens: 2000 });
    expect(() => ayarDogrula({ llm: { ek_govde: "reasoning_effort=none" } })).toThrow(/JSON nesnesi/);
    expect(() => ayarDogrula({ llm: { ek_govde: [1] } })).toThrow(/JSON nesnesi/);
    for (const alan of ["model", "messages", "stream", "api_key", "Authorization", "anahtar"]) {
      expect(() => ayarDogrula({ llm: { ek_govde: { [alan]: "x" } } })).toThrow(/kullanılamaz/);
    }
  });

  it("anahtarı ayarın içinde kabul etmez", () => {
    expect(() => ayarDogrula({ llm: { adres: "http://llm.kurum.local/v1", anahtar: "sk-gizli" } })).toThrow(/ayar dosyasına yazılmaz/);
    expect(() => ayarDogrula({ api_key: "sk-gizli" })).toThrow(/ayar dosyasına yazılmaz/);
  });
});

describe("ayar API'si ve anahtar", () => {
  it("varsayılan ayarı döner; anahtar yok", async () => {
    const yanit = (await app.inject({ url: "/api/ayar", headers: HOST })).json<AyarYaniti>();
    expect(yanit.ayar).toEqual(VARSAYILAN_AYAR);
    expect(yanit.anahtar).toEqual({ var: false, kaynak: null });
    expect(yanit.surum).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("anahtar hiçbir yanıtta ve ayar dosyasında yer almaz; oturumluk anahtar diske yazılmaz", async () => {
    const yanit = await app.inject({ method: "PUT", url: "/api/ayar", headers: HOST, payload: { ayar: llmAyari("http://llm.kurum.local/v1"), anahtar: { deger: "sk-COK-GIZLI-1", kalici: false } } });
    expect(yanit.statusCode).toBe(200);
    expect(yanit.body).not.toContain("sk-COK-GIZLI-1");
    expect(yanit.json<AyarYaniti>().anahtar).toEqual({ var: true, kaynak: "bellek" });
    expect(klasorIcerigi()).not.toContain("sk-COK-GIZLI-1");
    expect(fs.readFileSync(path.join(klasor, "ayar.json"), "utf8")).toContain("llm.kurum.local");
    expect((await app.inject({ url: "/api/ayar", headers: HOST })).body).not.toContain("sk-COK-GIZLI-1");
    expect(depo.anahtar()).toBe("sk-COK-GIZLI-1");
  });

  it("kalıcı anahtar ayrı dosyaya, yalnızca sahibinin okuyacağı izinle yazılır; silinebilir", async () => {
    const yanit = await app.inject({ method: "PUT", url: "/api/ayar", headers: HOST, payload: { ayar: VARSAYILAN_AYAR, anahtar: { deger: "sk-KALICI-2", kalici: true } } });
    expect(yanit.json<AyarYaniti>().anahtar).toEqual({ var: true, kaynak: "dosya" });
    expect(yanit.body).not.toContain("sk-KALICI-2");
    expect(fs.readFileSync(path.join(klasor, "ayar.json"), "utf8")).not.toContain("sk-KALICI-2");
    const anahtarDosyasi = path.join(klasor, "anahtar");
    expect(fs.readFileSync(anahtarDosyasi, "utf8")).toBe("sk-KALICI-2");
    if (process.platform !== "win32") expect(fs.statSync(anahtarDosyasi).mode & 0o777).toBe(0o600);

    const silindi = await app.inject({ method: "PUT", url: "/api/ayar", headers: HOST, payload: { ayar: VARSAYILAN_AYAR, anahtar: { sil: true } } });
    expect(silindi.json<AyarYaniti>().anahtar.var).toBe(false);
    expect(fs.existsSync(anahtarDosyasi)).toBe(false);
  });

  it("ortam değişkenindeki anahtar önceliklidir", async () => {
    depo.anahtarYaz("bellekteki", false);
    process.env[ANAHTAR_DEGISKENI] = "ortamdaki";
    expect(depo.anahtar()).toBe("ortamdaki");
    expect(depo.anahtarDurumu()).toEqual({ var: true, kaynak: "ortam" });
  });

  it("geçersiz ayar 400 döner ve dosyaya yazılmaz", async () => {
    const yanit = await app.inject({ method: "PUT", url: "/api/ayar", headers: HOST, payload: { ayar: { llm: { adres: "bozuk" } } } });
    expect(yanit.statusCode).toBe(400);
    expect(yanit.json().detail).toContain("LLM adresi geçerli değil");
    expect(fs.existsSync(path.join(klasor, "ayar.json"))).toBe(false);
  });

  it("kaydetmeden sınar: formdaki adres ve kayıtlı anahtar kullanılır", async () => {
    llm = await sahteLlm(() => "TAMAM");
    depo.anahtarYaz("kayitli-anahtar", false);
    const yanit = await app.inject({ method: "POST", url: "/api/ayar/sina", headers: HOST, payload: { ayar: llmAyari(llm.adres) } });
    expect(yanit.json<SinamaSonucu>().tamam).toBe(true);
    expect(llm.istekler[0]!.basliklar.authorization).toBe("Bearer kayitli-anahtar");
    expect(yanit.body).not.toContain("kayitli-anahtar");
    expect(fs.existsSync(path.join(klasor, "ayar.json"))).toBe(false);
  });
});

describe("karşılaştırma API'si", () => {
  it("iki PDF'i karşılaştırır; kayıtlı LLM ayarı ve anahtarı kullanılır", async () => {
    llm = await sahteLlm(() => '{"ozet": "LLM özeti.", "bulgular": []}');
    depo.yaz(llmAyari(llm.adres));
    depo.anahtarYaz("api-anahtari", false);
    const yanit = await app.inject({ method: "POST", url: "/api/karsilastir", headers: HOST, payload: { mod: "donusum", a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf") } });
    expect(yanit.statusCode).toBe(200);
    const rapor = yanit.json<Rapor>();
    expect(rapor.ozet).toBe("LLM özeti.");
    expect(rapor.hukum.durum).toBe("sorun");
    expect(llm.istekler[0]!.basliklar.authorization).toBe("Bearer api-anahtari");
    expect(yanit.body).not.toContain("api-anahtari");
  });

  it("bozuk dosyada ve bilinmeyen modda 400 döner", async () => {
    const bozuk = { ad: "bozuk.pdf", pdf_base64: Buffer.from("pdf değil").toString("base64") };
    const yanit = await app.inject({ method: "POST", url: "/api/karsilastir", headers: HOST, payload: { mod: "donusum", a: bozuk, b: bozuk } });
    expect(yanit.statusCode).toBe(400);
    expect(yanit.json().detail).toContain("bozuk.pdf: Dosya PDF olarak okunamadı");
    const modsuz = await app.inject({ method: "POST", url: "/api/karsilastir", headers: HOST, payload: { mod: "baska" } });
    expect(modsuz.statusCode).toBe(400);
  });

  it("ekstre içeriği diske yazılmaz", async () => {
    await app.inject({ method: "POST", url: "/api/karsilastir", headers: HOST, payload: { mod: "donusum", a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf") } });
    expect(fs.readdirSync(klasor)).toEqual([]);
  });
});

describe("erişim", () => {
  it("başka adresten ya da başka siteden gelen isteği reddeder", async () => {
    expect((await app.inject({ url: "/api/ayar", headers: { host: "kotu.example" } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/ayar", headers: { ...HOST, origin: "http://kotu.example" } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/ayar", headers: { ...HOST, origin: `http://127.0.0.1:${PORT}` } })).statusCode).toBe(200);
  });

  it("örnekleri listeler ve yalnızca listedeki dosyaları verir", async () => {
    const liste = (await app.inject({ url: "/api/ornekler", headers: HOST })).json<{ kimlik: string; not: string }[]>();
    expect(liste.map((o) => o.kimlik)).toEqual(["donusum", "sablon"]);
    expect(liste[1]!.not).toContain("Kampanya".toLocaleLowerCase("tr"));
    const pdf = await app.inject({ url: "/api/ornek/ekstre-eski.pdf", headers: HOST });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await app.inject({ url: "/api/ornek/..%2Fpackage.json", headers: HOST })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/ornek/sablon-istek.txt", headers: HOST })).statusCode).toBe(404);
  });
});
