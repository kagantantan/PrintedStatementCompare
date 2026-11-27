// Elle deneme: npx tsx sunucu/test/yardimci/dene.ts <a.pdf> <b.pdf> [donusum|sablon]
import fs from "node:fs";
import { karsilastir } from "../../src/analiz.js";
import { VARSAYILAN_AYAR } from "../../src/ayarlar.js";

const [a, b, mod = "donusum"] = process.argv.slice(2);
const oku = (yol: string) => ({ ad: yol.split("/").pop()!, pdf_base64: fs.readFileSync(yol).toString("base64") });
const basla = Date.now();
const rapor = await karsilastir({ mod: mod as "donusum" | "sablon", a: oku(a!), b: oku(b!), llm: false }, VARSAYILAN_AYAR, null);
console.log(rapor.hukum, rapor.belgeler, `${Date.now() - basla} ms`);
for (const f of rapor.farklar) console.log(f.kimlik, f.onem.padEnd(6), `${f.tur}/${f.kategori}`.padEnd(18), f.ayrinti, f.tur === "eksik" ? `| ${f.a?.metin}` : f.tur === "fazla" ? `| ${f.b?.metin}` : "");
