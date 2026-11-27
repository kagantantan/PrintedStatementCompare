// npm start  ->  http://127.0.0.1:8790
//   --port 9000   portu değiştir (EKSTRE_PORT ile de verilir)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ANAHTAR_DEGISKENI, AyarDeposu } from "./ayarlar.js";
import { sunucuKur } from "./sunucu.js";

const { values } = parseArgs({ options: { port: { type: "string" } }, strict: false });
const port = Number(values.port ?? process.env.EKSTRE_PORT ?? 8790);
const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const depo = new AyarDeposu();

let ayar;
try {
  ayar = depo.oku();
} catch (e) {
  console.error(`\nAyar dosyası geçersiz: ${(e as Error).message}\n`);
  process.exit(1);
}

const app = await sunucuKur({ kok, port, depo });
try {
  await app.listen({ host: "127.0.0.1", port });
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
console.log("  Durdurmak için bu pencerede Ctrl+C");
console.log("");

const kapat = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", kapat);
process.on("SIGTERM", kapat);
