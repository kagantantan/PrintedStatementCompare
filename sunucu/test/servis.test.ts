import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AyarDeposu } from "../src/ayarlar.js";
import { anahtarTani, EN_KISA_ANAHTAR, servisAyariOku, ServisHatasi, yerelAdresMi } from "../src/servis.js";
import { sunucuKur } from "../src/sunucu.js";
import type { IsYaniti, SaglikYaniti } from "../src/tipler.js";
import { geciciKlasor, KOK, ornek } from "./yardimci/ortam.js";

const PORT = 8790;
const YEREL = { host: `127.0.0.1:${PORT}` };
const ALI = "ali-icin-uydurma-test-anahtari-0001";
const VELI = "veli-icin-uydurma-test-anahtari-0002";
const UZAK = "10.20.30.40";

let klasor: string;
let app: FastifyInstance;

beforeEach(async () => {
  klasor = geciciKlasor();
  const servis = servisAyariOku({ EKSTRE_SERVIS_ANAHTARLARI: `${ALI},${VELI}` }, "0.0.0.0", klasor);
  app = await sunucuKur({ kok: KOK, port: PORT, depo: new AyarDeposu(klasor), servis });
});
afterEach(async () => {
  await app.close();
  fs.rmSync(klasor, { recursive: true, force: true });
});

const yetki = (anahtar: string) => ({ host: "ekstre.kurum.local", authorization: `Bearer ${anahtar}` });
const cift = { mod: "donusum", llm: false, a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf") };

async function bitene(kimlik: string, anahtar: string): Promise<IsYaniti> {
  for (let i = 0; i < 200; i++) {
    const is = (await app.inject({ url: `/api/v1/karsilastirmalar/${kimlik}`, headers: yetki(anahtar), remoteAddress: UZAK })).json<IsYaniti>();
    if (is.durum === "bitti" || is.durum === "hata") return is;
    await new Promise((tamam) => setTimeout(tamam, 25));
  }
  throw new Error("iş bitmedi");
}

describe("servis ayarı", () => {
  it("varsayılan yalnızca bu bilgisayarı dinler ve anahtar istemez", () => {
    const s = servisAyariOku({}, undefined, klasor);
    expect(s).toMatchObject({ dinle: "127.0.0.1", es_zamanli: 1, azami_sira: 20, omur_dk: 30 });
    expect(s.ozetler).toEqual([]);
  });

  it("anahtarsız ağa açılmayı reddeder", () => {
    expect(() => servisAyariOku({}, "0.0.0.0", klasor)).toThrow(ServisHatasi);
    expect(() => servisAyariOku({ EKSTRE_DINLE: "192.168.1.5" }, undefined, klasor)).toThrow(/Anahtarsız ağa açılmaz/);
    expect(servisAyariOku({ EKSTRE_SERVIS_ANAHTARLARI: ALI }, "0.0.0.0", klasor).dinle).toBe("0.0.0.0");
  });

  it("kısa ya da boşluklu anahtarı reddeder", () => {
    expect(() => servisAyariOku({ EKSTRE_SERVIS_ANAHTARLARI: "kisa" }, undefined, klasor)).toThrow(new RegExp(`en az ${EN_KISA_ANAHTAR} karakter`));
    expect(() => servisAyariOku({ EKSTRE_SERVIS_ANAHTARLARI: "icinde bosluk olan uzun bir anahtar" }, undefined, klasor)).toThrow(ServisHatasi);
  });

  it("anahtarları dosyadan da okur; yorum satırlarını atlar", () => {
    fs.writeFileSync(path.join(klasor, "servis-anahtarlari"), `# raporlama uygulaması\n${ALI}\n\n${VELI}\r\n`);
    expect(servisAyariOku({}, "0.0.0.0", klasor).ozetler).toHaveLength(2);
  });

  it("geçersiz kuyruk sınırını reddeder", () => {
    expect(() => servisAyariOku({ EKSTRE_ES_ZAMANLI: "0" }, undefined, klasor)).toThrow(/EKSTRE_ES_ZAMANLI/);
    expect(servisAyariOku({ EKSTRE_ES_ZAMANLI: "2", EKSTRE_AZAMI_SIRA: "5", EKSTRE_SONUC_OMRU_DK: "10" }, undefined, klasor)).toMatchObject({ es_zamanli: 2, azami_sira: 5, omur_dk: 10 });
  });

  it("anahtarı iki başlıktan da tanır; yanlışı tanımaz", () => {
    const { ozetler } = servisAyariOku({ EKSTRE_SERVIS_ANAHTARLARI: `${ALI},${VELI}` }, undefined, klasor);
    const ali = anahtarTani({ authorization: `Bearer ${ALI}` }, ozetler);
    expect(ali).toMatch(/^[0-9a-f]{12}$/);
    expect(anahtarTani({ "x-api-key": ALI }, ozetler)).toBe(ali);
    expect(anahtarTani({ authorization: `Bearer ${VELI}` }, ozetler)).not.toBe(ali);
    expect(anahtarTani({ authorization: `Bearer ${ALI}x` }, ozetler)).toBeNull();
    expect(anahtarTani({ authorization: `Basic ${ALI}` }, ozetler)).toBeNull();
    expect(anahtarTani({}, ozetler)).toBeNull();
    expect(yerelAdresMi("::1")).toBe(true);
    expect(yerelAdresMi("10.0.0.1")).toBe(false);
  });
});

describe("servis API'si: erişim", () => {
  it("anahtarsız ya da yanlış anahtarlı isteği reddeder", async () => {
    const anahtarsiz = await app.inject({ method: "POST", url: "/api/v1/karsilastirmalar", headers: { host: "ekstre.kurum.local" }, payload: cift, remoteAddress: UZAK });
    expect(anahtarsiz.statusCode).toBe(401);
    expect(anahtarsiz.headers["www-authenticate"]).toBe("Bearer");
    const yanlis = await app.inject({ method: "POST", url: "/api/v1/karsilastirmalar", headers: yetki("yanlis-ama-yeterince-uzun-bir-anahtar"), payload: cift, remoteAddress: UZAK });
    expect(yanlis.statusCode).toBe(401);
    // Bu bilgisayardan gelse de servis API'si anahtar ister.
    expect((await app.inject({ url: "/api/v1/karsilastirmalar/x", headers: YEREL })).statusCode).toBe(401);
  });

  it("sağlık ucu anahtarsızdır ve ekstre ya da ayar bilgisi vermez", async () => {
    const yanit = await app.inject({ url: "/api/v1/saglik", headers: { host: "ekstre.kurum.local" }, remoteAddress: UZAK });
    expect(yanit.statusCode).toBe(200);
    expect(yanit.json<SaglikYaniti>()).toEqual({ durum: "ayakta", surum: expect.stringMatching(/^\d+\.\d+\.\d+$/), llm_tanimli: false, sirada: 0, calisan: 0 });
  });

  it("arayüz, ayarlar ve eski uçlar ağdan açılmaz; anahtar da bunu değiştirmez", async () => {
    for (const url of ["/", "/api/ayar", "/api/ornekler", "/pdfjs/standard_fonts/LiberationSans-Regular.ttf"]) {
      expect((await app.inject({ url, headers: yetki(ALI), remoteAddress: UZAK })).statusCode, url).toBe(403);
    }
    const ayarDegistir = await app.inject({ method: "PUT", url: "/api/ayar", headers: yetki(ALI), payload: { ayar: {} }, remoteAddress: UZAK });
    expect(ayarDegistir.statusCode).toBe(403);
    expect(fs.readdirSync(klasor)).toEqual([]);
    const eskiUc = await app.inject({ method: "POST", url: "/api/karsilastir", headers: yetki(ALI), payload: cift, remoteAddress: UZAK });
    expect(eskiUc.statusCode).toBe(403);
    // Sunucunun kendi bilgisayarından arayüz API'si çalışmaya devam eder.
    expect((await app.inject({ url: "/api/ayar", headers: YEREL })).statusCode).toBe(200);
  });

  it("anahtar tanımlı değilse servis API'si kapalıdır", async () => {
    await app.close();
    app = await sunucuKur({ kok: KOK, port: PORT, depo: new AyarDeposu(klasor) });
    const yanit = await app.inject({ method: "POST", url: "/api/v1/karsilastirmalar", headers: yetki(ALI), payload: cift });
    expect(yanit.statusCode).toBe(401);
    expect(yanit.json().detail).toContain("servis anahtarı tanımlı değil");
  });
});

describe("servis API'si: karşılaştırma işi", () => {
  it("işi kabul eder, sonucu sonra verir; görüntü farkı sunucuda hesaplanır", async () => {
    const kabul = await app.inject({ method: "POST", url: "/api/v1/karsilastirmalar", headers: yetki(ALI), payload: cift, remoteAddress: UZAK });
    expect(kabul.statusCode).toBe(202);
    const is = kabul.json<IsYaniti>();
    expect(kabul.headers.location).toBe(`/api/v1/karsilastirmalar/${is.kimlik}`);
    expect(["sirada", "calisiyor"]).toContain(is.durum);
    expect(is.rapor).toBeUndefined();

    const biten = await bitene(is.kimlik, ALI);
    expect(biten.durum).toBe("bitti");
    expect(biten.rapor!.hukum.durum).toBe("sorun");
    expect(biten.rapor!.bulgular.filter((b) => b.onem === "kritik")).toHaveLength(4);
    expect(biten.rapor!.farklar.some((f) => f.tur === "gorsel")).toBe(true); // eksik logo
    expect(biten.rapor!.llm.hata).toContain("kapatıldı");
  });

  it("bir anahtarın işini başka anahtar göremez ve silemez", async () => {
    const is = (await app.inject({ method: "POST", url: "/api/v1/karsilastirmalar", headers: yetki(ALI), payload: cift, remoteAddress: UZAK })).json<IsYaniti>();
    await bitene(is.kimlik, ALI);
    expect((await app.inject({ url: `/api/v1/karsilastirmalar/${is.kimlik}`, headers: yetki(VELI), remoteAddress: UZAK })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/karsilastirmalar/${is.kimlik}`, headers: yetki(VELI), remoteAddress: UZAK })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/karsilastirmalar/${is.kimlik}`, headers: yetki(ALI), remoteAddress: UZAK })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/v1/karsilastirmalar/${is.kimlik}`, headers: yetki(ALI), remoteAddress: UZAK })).statusCode).toBe(404);
  });

  it("açık hataları işe dönüştürmeden hemen söyler", async () => {
    const gonder = (payload: object) => app.inject({ method: "POST", url: "/api/v1/karsilastirmalar", headers: yetki(ALI), payload, remoteAddress: UZAK });
    const modsuz = await gonder({ ...cift, mod: "baska" });
    expect(modsuz.statusCode).toBe(400);
    expect(modsuz.json().detail).toContain("mod alanı");
    const eksik = await gonder({ mod: "donusum", a: cift.a });
    expect(eksik.statusCode).toBe(400);
    expect(eksik.json().detail).toContain("b alanı eksik");
    const pdfDegil = await gonder({ ...cift, b: { ad: "resim.png", pdf_base64: Buffer.from("PNG degil PDF").toString("base64") } });
    expect(pdfDegil.statusCode).toBe(400);
    expect(pdfDegil.json().detail).toContain("b.pdf_base64");
  });

  it("başlığı PDF gibi görünen bozuk dosya işi hataya düşürür, sunucuyu değil", async () => {
    const bozuk = { ad: "bozuk.pdf", pdf_base64: Buffer.from("%PDF-1.7 gerisi anlamsız").toString("base64") };
    const is = (await app.inject({ method: "POST", url: "/api/v1/karsilastirmalar", headers: yetki(ALI), payload: { ...cift, a: bozuk }, remoteAddress: UZAK })).json<IsYaniti>();
    const biten = await bitene(is.kimlik, ALI);
    expect(biten.durum).toBe("hata");
    expect(biten.hata).toContain("bozuk.pdf");
    expect((await app.inject({ url: "/api/v1/saglik", remoteAddress: UZAK })).json<SaglikYaniti>().calisan).toBe(0);
  });

  it("hiçbir şeyi diske yazmaz", async () => {
    const is = (await app.inject({ method: "POST", url: "/api/v1/karsilastirmalar", headers: yetki(ALI), payload: cift, remoteAddress: UZAK })).json<IsYaniti>();
    await bitene(is.kimlik, ALI);
    expect(fs.readdirSync(klasor)).toEqual([]);
  });
});
