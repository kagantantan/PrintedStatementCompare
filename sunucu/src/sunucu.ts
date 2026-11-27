// Fastify API ve derlenmiş arayüzün sunumu. Yalnızca bu makineden (127.0.0.1) erişilir.
// Yüklenen ekstreler bellekte işlenir: diske yazılmaz, günlüğe girmez, sunucuda saklanmaz.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { IstekHatasi, karsilastir } from "./analiz.js";
import { AyarDeposu, AyarHatasi, ayarDogrula } from "./ayarlar.js";
import { baglantiSina, LlmHatasi } from "./llm.js";
import { PdfHatasi } from "./pdf.js";
import type { AyarKaydi, AyarYaniti, KarsilastirIstegi } from "./tipler.js";

export interface KurulumSecenekleri {
  kok: string;
  port: number;
  depo?: AyarDeposu;
}

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

  const izinliHostlar = new Set([`127.0.0.1:${sec.port}`, `localhost:${sec.port}`]);
  app.addHook("onRequest", async (req, reply) => {
    if (!izinliHostlar.has(String(req.headers.host ?? ""))) return reply.code(403).send({ detail: `İzin verilmeyen adres: ${req.headers.host ?? "-"}` });
    const koken = req.headers.origin;
    if (koken && !izinliHostlar.has(koken.replace(/^https?:\/\//, ""))) return reply.code(403).send({ detail: "Bu istek başka bir siteden geliyor; reddedildi." });
  });

  app.setErrorHandler((hata, _req, reply) => {
    const e = hata as Error & { statusCode?: number; code?: string };
    if (e instanceof AyarHatasi || e instanceof IstekHatasi || e instanceof PdfHatasi) return reply.code(400).send({ detail: e.message });
    if (e instanceof LlmHatasi) return reply.code(502).send({ detail: e.message });
    if (e.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.code(413).send({ detail: "Dosyalar çok büyük (toplam 100 MB sınırı)." });
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
      if (req.url.startsWith("/api/")) return reply.code(404).send({ detail: "Böyle bir adres yok." });
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    });
  } else {
    app.get("/", async (_req, reply) => reply.type("text/plain; charset=utf-8").send("Arayüz derlenmemiş. Önce `npm run build` çalıştırın."));
  }

  return app;
}
