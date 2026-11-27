// OpenAI uyumlu LLM istemcisi (kurum içi servis, Ollama, vLLM...). Akışsız çalışır: tek istek, tek yanıt.
import type { BaslikTuru, LlmAyari, SinamaAdimi, SinamaSonucu } from "./tipler.js";

export class LlmHatasi extends Error {}

export type IcerikParcasi = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface Mesaj {
  role: "system" | "user" | "assistant";
  content: string | IcerikParcasi[];
}

export interface SohbetSecenekleri {
  azami_token?: number;
  sure_sn?: number;
  /** Sunucu destekliyorsa yanıtı JSON'a zorlar; desteklemiyorsa bu seçenek olmadan yeniden denenir. */
  json?: boolean;
}

export function basliklar(tur: BaslikTuru, anahtar: string | null): Record<string, string> {
  const b: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (!anahtar || tur === "yok") return b;
  if (tur === "bearer") b.authorization = `Bearer ${anahtar}`;
  else b[tur] = anahtar;
  return b;
}

/** Hata metinlerinden anahtarı siler: servis isteği aynen geri yansıtsa bile anahtar görünmez. */
function temizle(metin: string, anahtar: string | null): string {
  const kisa = metin.replace(/\s+/g, " ").trim().slice(0, 300);
  return anahtar ? kisa.split(anahtar).join("***") : kisa;
}

async function istek(ayar: LlmAyari, anahtar: string | null, yol: string, govde: unknown | undefined, sureSn: number): Promise<unknown> {
  if (!ayar.adres) throw new LlmHatasi("LLM adresi ayarlanmamış. Ayarlar ekranından girin.");
  const adres = `${ayar.adres}${yol}`;
  let yanit: Response;
  try {
    yanit = await fetch(adres, {
      method: govde === undefined ? "GET" : "POST",
      headers: basliklar(ayar.baslik, anahtar),
      body: govde === undefined ? undefined : JSON.stringify(govde),
      signal: AbortSignal.timeout(sureSn * 1000),
      redirect: "error",
    });
  } catch (e) {
    const hata = e as Error & { cause?: { code?: string; message?: string } };
    if (hata.name === "TimeoutError" || hata.name === "AbortError") throw new LlmHatasi(`LLM ${sureSn} saniyede yanıt vermedi. Ayarlardan zaman aşımını artırın ya da daha az fark gönderin.`);
    const kod = hata.cause?.code ?? "";
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(kod)) {
      throw new LlmHatasi(`LLM servisinin sertifikası doğrulanamadı (${kod}). Kurum kök sertifikasını NODE_EXTRA_CA_CERTS değişkeniyle tanıtın (README, Sorun giderme).`);
    }
    if (kod === "ECONNREFUSED" || kod === "ENOTFOUND" || kod === "EAI_AGAIN" || kod === "EHOSTUNREACH" || kod === "ETIMEDOUT") {
      throw new LlmHatasi(`LLM servisine ulaşılamadı (${kod}): ${ayar.adres}. Adresi ve ağ erişimini kontrol edin.`);
    }
    throw new LlmHatasi(`LLM servisine bağlanılamadı: ${temizle(hata.cause?.message ?? hata.message, anahtar)}`);
  }
  const metin = await yanit.text();
  if (!yanit.ok) {
    const ayrinti = temizle(metin, anahtar);
    if (yanit.status === 401 || yanit.status === 403) throw new LlmHatasi(`LLM servisi anahtarı kabul etmedi (${yanit.status}). Anahtarı ve anahtar başlığını kontrol edin.`, { cause: yanit.status });
    if (yanit.status === 404) throw new LlmHatasi(`LLM servisinde adres ya da model bulunamadı (404): ${adres}. Taban adres genellikle /v1 ile biter. ${ayrinti}`, { cause: 404 });
    throw new LlmHatasi(`LLM servisi hata döndü (${yanit.status}): ${ayrinti}`, { cause: yanit.status });
  }
  try {
    return JSON.parse(metin);
  } catch {
    throw new LlmHatasi(`LLM servisi JSON olmayan bir yanıt döndü: ${temizle(metin, anahtar)}`);
  }
}

/** response_format'ı kabul etmeyen servisler: bir kez öğrenilir, sonraki isteklerde gönderilmez. */
const jsonModuYok = new Set<string>();

export async function sohbet(ayar: LlmAyari, anahtar: string | null, mesajlar: Mesaj[], sec: SohbetSecenekleri = {}): Promise<string> {
  if (!ayar.model) throw new LlmHatasi("Model adı ayarlanmamış. Ayarlar ekranından seçin.");
  const kimlik = `${ayar.adres}|${ayar.model}`;
  const govde = (json: boolean) => ({
    ...ayar.ek_govde,
    model: ayar.model,
    messages: mesajlar,
    temperature: ayar.sicaklik,
    max_tokens: sec.azami_token ?? ayar.azami_token,
    stream: false,
    ...(json ? { response_format: { type: "json_object" } } : {}),
  });
  const sure = sec.sure_sn ?? ayar.sure_sn;
  let yanit: unknown;
  const jsonIste = sec.json === true && !jsonModuYok.has(kimlik);
  try {
    yanit = await istek(ayar, anahtar, "/chat/completions", govde(jsonIste), sure);
  } catch (e) {
    const durum = (e as Error).cause;
    if (!jsonIste || (durum !== 400 && durum !== 422)) throw e;
    jsonModuYok.add(kimlik);
    yanit = await istek(ayar, anahtar, "/chat/completions", govde(false), sure);
  }
  const icerik = (yanit as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  const metin = typeof icerik === "string" ? icerik : Array.isArray(icerik) ? icerik.map((p) => (typeof p?.text === "string" ? p.text : "")).join("") : "";
  const sade = dusunceyiAt(metin);
  if (!sade) throw new LlmHatasi("LLM boş yanıt döndü. Çıktı token sınırı düşünme aşamasında tükenmiş olabilir; ayarlardan artırın.");
  return sade;
}

export async function modeller(ayar: LlmAyari, anahtar: string | null): Promise<string[]> {
  const yanit = (await istek(ayar, anahtar, "/models", undefined, Math.min(ayar.sure_sn, 20))) as { data?: { id?: unknown }[] };
  return (yanit.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean).sort();
}

/** Düşünen modellerin (Qwen3, DeepSeek-R1) <think> bloğunu atar. */
export function dusunceyiAt(metin: string): string {
  return metin.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

/** Yanıttan JSON nesnesini ayıklar: kod çitleri, öndeki ve sondaki açıklamalar, sondaki virgüller hoş görülür. */
export function jsonAyikla(metin: string): unknown | null {
  const sade = dusunceyiAt(metin);
  const adaylar: string[] = [];
  const cit = /```(?:json)?\s*([\s\S]*?)```/i.exec(sade);
  if (cit) adaylar.push(cit[1]!);
  const ilk = sade.indexOf("{");
  const son = sade.lastIndexOf("}");
  if (ilk >= 0 && son > ilk) adaylar.push(sade.slice(ilk, son + 1));
  for (const aday of adaylar) {
    for (const deneme of [aday, aday.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        const sonuc = JSON.parse(deneme);
        if (sonuc && typeof sonuc === "object" && !Array.isArray(sonuc)) return sonuc;
      } catch {
        // sıradaki adayı dene
      }
    }
  }
  return null;
}

// 32×32 düz kırmızı PNG: görsel girdi sınaması için.
const KIRMIZI_PNG = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mO4IyJCU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJ3LED19/LmKAAAAAElFTkSuQmCC";

/** Ayarlar ekranındaki "Bağlantıyı sına": model listesi, kısa bir sohbet ve (açıksa) görsel girdi. */
export async function baglantiSina(ayar: LlmAyari, anahtar: string | null): Promise<SinamaSonucu> {
  const adimlar: SinamaAdimi[] = [];
  let liste: string[] = [];
  try {
    liste = await modeller(ayar, anahtar);
    adimlar.push({ ad: "Model listesi", tamam: true, ayrinti: liste.length ? `${liste.length} model bulundu.` : "Servis yanıt verdi ama model listesi boş." });
  } catch (e) {
    adimlar.push({ ad: "Model listesi", tamam: false, ayrinti: `${(e as Error).message} (Bazı servisler model listesi sunmaz; sohbet çalışıyorsa sorun değil.)` });
  }
  let sohbetTamam = false;
  if (!ayar.model) adimlar.push({ ad: "Sohbet", tamam: false, ayrinti: "Model adı boş; listeden seçin ya da yazın." });
  else {
    try {
      const basla = Date.now();
      const yanit = await sohbet(ayar, anahtar, [{ role: "user", content: "Yalnızca şu kelimeyi yaz: TAMAM" }], { azami_token: 512, sure_sn: Math.min(ayar.sure_sn, 120) });
      sohbetTamam = true;
      adimlar.push({ ad: "Sohbet", tamam: true, ayrinti: `${ayar.model} ${((Date.now() - basla) / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn'de yanıt verdi: “${yanit.slice(0, 40)}”` });
    } catch (e) {
      adimlar.push({ ad: "Sohbet", tamam: false, ayrinti: (e as Error).message });
    }
  }
  if (ayar.gorsel && sohbetTamam) {
    try {
      const yanit = await sohbet(
        ayar,
        anahtar,
        [{ role: "user", content: [{ type: "text", text: "Bu görselin rengi ne? Tek kelimeyle yanıtla." }, { type: "image_url", image_url: { url: `data:image/png;base64,${KIRMIZI_PNG}` } }] }],
        { azami_token: 512, sure_sn: Math.min(ayar.sure_sn, 120) },
      );
      const gordu = /k[ıi]rm[ıi]z[ıi]|red/i.test(yanit);
      adimlar.push({
        ad: "Görsel girdi",
        tamam: gordu,
        ayrinti: gordu ? "Model görseli gördü." : `Model görseli tanımadı (yanıt: “${yanit.slice(0, 60)}”). Bu model görsel girdi desteklemiyor olabilir; seçeneği kapatın.`,
      });
    } catch (e) {
      adimlar.push({ ad: "Görsel girdi", tamam: false, ayrinti: `${(e as Error).message} Bu model ya da servis görsel girdi desteklemiyor olabilir; seçeneği kapatın.` });
    }
  }
  return { tamam: sohbetTamam && adimlar.filter((a) => a.ad !== "Model listesi").every((a) => a.tamam), adimlar, modeller: liste };
}
