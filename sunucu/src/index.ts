// npm start  ->  http://127.0.0.1:8790
//   --port 9000      portu değiştir (EKSTRE_PORT ile de verilir)
//   --dinle 0.0.0.0  ağa aç (EKSTRE_DINLE ile de verilir); servis anahtarı tanımlı değilse başlamaz
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { nodeHatasi, nodeUygunMu } from "./surum.js";

// Sürüm denetimi diğer modüller yüklenmeden yapılır: eski Node'da pdf.js yüklenirken anlaşılmaz bir hata verir.
if (!nodeUygunMu(process.version)) {
  console.error(`\n${nodeHatasi(process.version)}\n`);
  process.exit(1);
}
const { ANAHTAR_DEGISKENI, AyarDeposu } = await import("./ayarlar.js");
const { servisAyariOku, yerelAdresMi } = await import("./servis.js");
const { sunucuKur } = await import("./sunucu.js");

const { values } = parseArgs({ options: { port: { type: "string" }, dinle: { type: "string" } }, strict: false });
const port = Number(values.port ?? process.env.EKSTRE_PORT ?? 8790);
const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const depo = new AyarDeposu();

let servis;
try {
  servis = servisAyariOku(process.env, typeof values.dinle === "string" ? values.dinle : undefined, depo.klasor);
} catch (e) {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
}

let ayar;
try {
  ayar = depo.oku();
} catch (e) {
  console.error(`\nAyar dosyası geçersiz: ${(e as Error).message}\n`);
  process.exit(1);
}

const app = await sunucuKur({ kok, port, depo, servis });
try {
  await app.listen({ host: servis.dinle, port });
} catch (e) {
  const kod = (e as NodeJS.ErrnoException).code;
  console.error(kod === "EADDRINUSE" ? `\nPort ${port} kullanımda. Uygulama zaten açık olabilir; değilse --port ile başka bir port verin.\n` : `\nSunucu açılamadı: ${(e as Error).message}\n`);
  process.exit(1);
}

const anahtar = depo.anahtarDurumu();
console.log("");
console.log(`  Ekstre Karşılaştır çalışıyor  ->  http://127.0.0.1:${port}`);
console.log(`  Ayarlar: ${depo.klasor}`);
console.log(ayar.llm.adres ? `  LLM: ${ayar.llm.model || "(model seçilmedi)"} · ${ayar.llm.adres}` : "  LLM ayarlanmamış: yalnızca makine farkları çıkar. Ayarlar ekranından tanımlayın.");
console.log(anahtar.var ? `  Anahtar: var (${anahtar.kaynak === "ortam" ? ANAHTAR_DEGISKENI : anahtar.kaynak})` : "  Anahtar: yok");
if (servis.ozetler.length) console.log(`  Servis API'si açık: /api/v1 (${servis.ozetler.length} servis anahtarı; aynı anda ${servis.es_zamanli} iş, sırada en çok ${servis.azami_sira})`);
if (!yerelAdresMi(servis.dinle)) {
  console.log(`  AĞA AÇIK: ${servis.dinle}:${port} dinleniyor. Arayüz ve ayarlar yine yalnızca bu bilgisayardan açılır.`);
  console.log("  Bağlantı şifresiz (HTTP): ekstreler ağdan geçeceği için önüne TLS sonlandıran bir vekil koyun.");
}
console.log("  Durdurmak için bu pencerede Ctrl+C");
console.log("");

const kapat = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", kapat);
process.on("SIGTERM", kapat);
