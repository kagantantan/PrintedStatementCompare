// Testlerin ortak yardımcıları. Testler ağa çıkmaz: LLM yerine bu makinede açılan sahte bir OpenAI uyumlu sunucu kullanılır.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VARSAYILAN_AYAR } from "../../src/ayarlar.js";
import type { Ayar, DosyaGirdisi } from "../../src/tipler.js";

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function ornek(ad: string): DosyaGirdisi {
  return { ad, pdf_base64: fs.readFileSync(path.join(KOK, "ornekler", ad)).toString("base64") };
}

export function geciciKlasor(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ekstre-test-"));
}

export interface SahteIstek {
  yol: string;
  basliklar: http.IncomingHttpHeaders;
  govde: any;
}

export interface SahteLlm {
  adres: string;
  istekler: SahteIstek[];
  kapat(): Promise<void>;
}

export type Yanitlayici = (istek: SahteIstek, sira: number) => { durum?: number; govde?: unknown; ham?: string } | string;

/** Sahte OpenAI uyumlu sunucu. Yanıtlayıcı metin döndürürse sohbet yanıtının içeriği olur. */
export async function sahteLlm(yanitla: Yanitlayici): Promise<SahteLlm> {
  const istekler: SahteIstek[] = [];
  const sunucu = http.createServer((req, res) => {
    let ham = "";
    req.on("data", (p) => (ham += p));
    req.on("end", () => {
      const istek: SahteIstek = { yol: req.url ?? "", basliklar: req.headers, govde: ham ? JSON.parse(ham) : null };
      istekler.push(istek);
      if (istek.yol.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "kurum-model" }, { id: "baska-model" }] }));
        return;
      }
      const yanit = yanitla(istek, istekler.filter((i) => i.yol.endsWith("/chat/completions")).length);
      if (typeof yanit === "string") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: yanit } }] }));
      } else {
        res.writeHead(yanit.durum ?? 200, { "content-type": "application/json" }).end(yanit.ham ?? JSON.stringify(yanit.govde ?? {}));
      }
    });
  });
  await new Promise<void>((tamam) => sunucu.listen(0, "127.0.0.1", tamam));
  const port = (sunucu.address() as { port: number }).port;
  return { adres: `http://127.0.0.1:${port}/v1`, istekler, kapat: () => new Promise((tamam) => sunucu.close(() => tamam())) };
}

export function ayar(llmAdresi = "", ek: Partial<Ayar["llm"]> = {}): Ayar {
  return { llm: { ...VARSAYILAN_AYAR.llm, adres: llmAdresi, model: llmAdresi ? "kurum-model" : "", sure_sn: 20, ...ek }, karsilastirma: { ...VARSAYILAN_AYAR.karsilastirma } };
}
