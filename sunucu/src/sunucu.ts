// Fastify API ve derlenmiş arayüzün sunumu.
//
// İki ayrı kapı vardır:
//   - Arayüz ve onun API'si (/, /api/ayar, /api/karsilastir...): yalnızca sunucunun çalıştığı bilgisayardan.
//   - Servis API'si (/api/v1/...): başka uygulamalar için; her istek servis anahtarı ister, işler kuyruğa girer.
// Yüklenen ekstreler bellekte işlenir: diske yazılmaz, günlüğe girmez.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { IstekHatasi, karsilastir } from "./analiz.js";
import { AyarDeposu, AyarHatasi, ayarDogrula } from "./ayarlar.js";
import { IsKuyrugu, KuyrukDolu } from "./isler.js";
import { baglantiSina, LlmHatasi } from "./llm.js";
import { PdfHatasi } from "./pdf.js";
import { anahtarTani, yerelAdresMi, type ServisAyari } from "./servis.js";
import type { AyarKaydi, AyarYaniti, KarsilastirIstegi, SaglikYaniti } from "./tipler.js";

export interface KurulumSecenekleri {
  kok: string;
  port: number;
  depo?: AyarDeposu;
  /** Servis API'sinin anahtarları ve kuyruk sınırları. Verilmezse /api/v1 anahtarsız olduğu için her isteği reddeder. */
  servis?: Pick<ServisAyari, "ozetler" | "es_zamanli" | "azami_sira" | "omur_dk">;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Servis API'sinde isteği gönderen anahtarın kısa kimliği. */
    sahip: string;
  }
}

const pdfMi = (base64: unknown) => typeof base64 === "string" && Buffer.from(base64.slice(0, 8), "base64").toString("latin1").startsWith("%PDF");

const ORNEKLER: Record<string, { ad: string; aciklama: string; mod: "donusum" | "sablon"; a: string; b: string; not?: string }> = {
  donusum: {
    ad: "Dönüşüm örneği",
    aciklama: "Eski ve yeni sistemin ürettiği aynı ekstre; yeni tarafta bilerek bırakılmış hatalar var.",
    mod: "donusum",
    a: "ekstre-eski.pdf",
    b: "ekstre-yeni.pdf",
  },
  sablon: {
    ad: "Şablon örneği",
    aciklama: "Bugünkü şablon ile değiştirilmiş hali; istenen değişiklikler notta.",
    mod: "sablon",
    a: "sablon-referans.pdf",
    b: "sablon-yeni.pdf",
    not: "sablon-istek.txt",
  },
};

export async function sunucuKur(sec: KurulumSecenekleri): Promise<FastifyInstance> {
  const depo = sec.depo ?? new AyarDeposu();
  const surum = (JSON.parse(fs.readFileSync(path.join(sec.kok, "package.json"), "utf8")) as { version: string }).version;
  // Günlük kapalı: istek gövdelerinde ekstre içeriği var.
  const app = Fastify({ logger: false, bodyLimit: 150 * 1024 * 1024 });

  const servis = sec.servis ?? { ozetler: [], es_zamanli: 1, azami_sira: 20, omur_dk: 30 };
  app.decorateRequest("sahip", "");

  const izinliHostlar = new Set([`127.0.0.1:${sec.port}`, `localhost:${sec.port}`]);
  app.addHook("onRequest", async (req, reply) => {
    const yol = req.url.split("?")[0]!;
    if (yol.startsWith("/api/v1/")) {
      // Servis API'si: nereden gelirse gelsin anahtar ister. Sağlık ucu yalnızca "ayakta" der, anahtarsızdır.
      if (yol === "/api/v1/saglik") return;
      if (!servis.ozetler.length) return reply.code(401).send({ detail: "Bu sunucuda servis anahtarı tanımlı değil; servis API'si kapalı. Sunucuyu yöneten kişi EKSTRE_SERVIS_ANAHTARLARI tanımlamalı." });
      const sahip = anahtarTani(req.headers, servis.ozetler);
      if (!sahip) return reply.code(401).header("www-authenticate", "Bearer").send({ detail: "Servis anahtarı eksik ya da geçersiz. Anahtarı Authorization: Bearer <anahtar> başlığıyla gönderin." });
      req.sahip = sahip;
      return;
    }
    // Arayüz, ayarlar ve yardımcı dosyalar: yalnızca sunucunun çalıştığı bilgisayardan.
    if (!yerelAdresMi(req.ip)) return reply.code(403).send({ detail: "Arayüz ve ayarlar yalnızca sunucunun çalıştığı bilgisayardan açılır. Ağdan çağırmak için /api/v1 uçlarını servis anahtarıyla kullanın." });
    if (!izinliHostlar.has(String(req.headers.host ?? ""))) return reply.code(403).send({ detail: `İzin verilmeyen adres: ${req.headers.host ?? "-"}` });
    const koken = req.headers.origin;
    if (koken && !izinliHostlar.has(koken.replace(/^https?:\/\//, ""))) return reply.code(403).send({ detail: "Bu istek başka bir siteden geliyor; reddedildi." });
  });

  app.setErrorHandler((hata, _req, reply) => {
    const e = hata as Error & { statusCode?: number; code?: string };
    if (e instanceof AyarHatasi || e instanceof IstekHatasi || e instanceof PdfHatasi) return reply.code(400).send({ detail: e.message });
    if (e instanceof LlmHatasi) return reply.code(502).send({ detail: e.message });
    if (e.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.code(413).send({ detail: "İstek çok büyük (gövde sınırı 150 MB)." });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ detail: "İstek anlaşılamadı." });
    console.error(`Beklenmeyen hata: ${e.message}`);
    return reply.code(500).send({ detail: "Beklenmeyen bir hata oluştu. Sunucu penceresindeki mesaja bakın." });
  });

  const ayarYaniti = (): AyarYaniti => ({ ayar: depo.oku(), anahtar: depo.anahtarDurumu(), klasor: depo.klasor, surum });

  app.get("/api/ayar", async () => ayarYaniti());

  app.put("/api/ayar", async (req) => {
    const govde = (req.body ?? {}) as AyarKaydi;
    const ayar = ayarDogrula(govde.ayar);
    if (govde.anahtar?.sil) depo.anahtarSil();
    else if (typeof govde.anahtar?.deger === "string" && govde.anahtar.deger.trim()) depo.anahtarYaz(govde.anahtar.deger, govde.anahtar.kalici === true);
    depo.yaz(ayar);
    return ayarYaniti();
  });

  // Kaydetmeden sınama: formdaki değerlerle dener. Anahtar verilmediyse kayıtlı anahtar kullanılır.
  app.post("/api/ayar/sina", async (req) => {
    const govde = (req.body ?? {}) as AyarKaydi;
    const ayar = ayarDogrula(govde.ayar);
    const anahtar = govde.anahtar?.sil ? null : govde.anahtar?.deger?.trim() || depo.anahtar();
    return baglantiSina(ayar.llm, anahtar);
  });

  app.post("/api/karsilastir", async (req) => {
    const istek = (req.body ?? {}) as KarsilastirIstegi;
    return karsilastir(istek, depo.oku(), depo.anahtar());
  });

  // ---- Servis API'si (v1): iş kuyruğu
  const kuyruk = new IsKuyrugu((istek) => karsilastir(istek, depo.oku(), depo.anahtar()), { es_zamanli: servis.es_zamanli, azami_sira: servis.azami_sira, omur_ms: servis.omur_dk * 60_000 });
  app.addHook("onClose", async () => kuyruk.kapat());

  app.get("/api/v1/saglik", async (): Promise<SaglikYaniti> => {
    const ayar = depo.oku();
    return { durum: "ayakta", surum, llm_tanimli: Boolean(ayar.llm.adres && ayar.llm.model), ...kuyruk.durum() };
  });

  app.post("/api/v1/karsilastirmalar", async (req, reply) => {
    const istek = (req.body ?? {}) as KarsilastirIstegi;
    // Açık hatalar işe dönüşmeden, hemen söylenir.
    if (istek.mod !== "donusum" && istek.mod !== "sablon") throw new IstekHatasi("mod alanı donusum ya da sablon olmalı.");
    for (const taraf of ["a", "b"] as const) {
      if (!istek[taraf] || typeof istek[taraf].ad !== "string") throw new IstekHatasi(`${taraf} alanı eksik: { "ad": "dosya.pdf", "pdf_base64": "..." } biçiminde olmalı.`);
      if (!pdfMi(istek[taraf].pdf_base64)) throw new IstekHatasi(`${taraf}.pdf_base64 bir PDF dosyasının base64 hali olmalı.`);
    }
    try {
      const is = kuyruk.ekle(req.sahip, istek);
      return reply.code(202).header("location", `/api/v1/karsilastirmalar/${is.kimlik}`).send(is);
    } catch (e) {
      if (e instanceof KuyrukDolu) return reply.code(429).header("retry-after", "30").send({ detail: e.message });
      throw e;
    }
  });

  app.get<{ Params: { kimlik: string } }>("/api/v1/karsilastirmalar/:kimlik", async (req, reply) => {
    const is = kuyruk.al(req.sahip, req.params.kimlik);
    if (!is) return reply.code(404).send({ detail: "Böyle bir iş yok ya da sonucunun saklanma süresi doldu." });
    return reply.header("cache-control", "no-store").send(is);
  });

  app.delete<{ Params: { kimlik: string } }>("/api/v1/karsilastirmalar/:kimlik", async (req, reply) => {
    if (!kuyruk.sil(req.sahip, req.params.kimlik)) return reply.code(404).send({ detail: "Böyle bir iş yok ya da sonucunun saklanma süresi doldu." });
    return reply.code(204).send();
  });

  const ornekKlasoru = path.join(sec.kok, "ornekler");
  app.get("/api/ornekler", async () =>
    Object.entries(ORNEKLER)
      .filter(([, o]) => fs.existsSync(path.join(ornekKlasoru, o.a)) && fs.existsSync(path.join(ornekKlasoru, o.b)))
      .map(([kimlik, o]) => ({
        kimlik,
        ad: o.ad,
        aciklama: o.aciklama,
        mod: o.mod,
        a: o.a,
        b: o.b,
        not: o.not && fs.existsSync(path.join(ornekKlasoru, o.not)) ? fs.readFileSync(path.join(ornekKlasoru, o.not), "utf8").trim() : "",
      })),
  );

  const ornekDosyalari = new Set(Object.values(ORNEKLER).flatMap((o) => [o.a, o.b]));
  app.get<{ Params: { ad: string } }>("/api/ornek/:ad", async (req, reply) => {
    if (!ornekDosyalari.has(req.params.ad)) return reply.code(404).send({ detail: "Örnek bulunamadı." });
    const yol = path.join(ornekKlasoru, req.params.ad);
    if (!fs.existsSync(yol)) return reply.code(404).send({ detail: "Örnek dosyası yok; `npm run ornek` ile üretin." });
    return reply.type("application/pdf").send(fs.readFileSync(yol));
  });

  // pdf.js'in tarayıcıda ihtiyaç duyduğu yardımcı dosyalar (gömülü olmayan yazı tipleri, görüntü çözücüler).
  // Uygulama internetsiz çalışır; bunlar da bu makineden sunulur.
  const pdfjsKoku = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  await app.register(fastifyStatic, {
    root: pdfjsKoku,
    prefix: "/pdfjs/",
    decorateReply: false,
    index: false,
    allowedPath: (yol) => /^\/(standard_fonts|cmaps|wasm|iccs)\/[\w.-]+$/.test(yol),
  });

  const dist = path.join(sec.kok, "arayuz", "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, { root: dist, cacheControl: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/pdfjs/")) return reply.code(404).send({ detail: "Böyle bir adres yok." });
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    });
  } else {
    app.get("/", async (_req, reply) => reply.type("text/plain; charset=utf-8").send("Arayüz derlenmemiş. Önce `npm run build` çalıştırın."));
  }

  return app;
}
