// Ayarlar proje klasörünün dışında durur (~/.ekstre-karsilastir/ayar.json): kurumun adresi repoya girmez.
// API anahtarı ayar dosyasına yazılmaz. Üç yerden gelebilir, bu öncelikle:
//   1. EKSTRE_LLM_ANAHTAR ortam değişkeni
//   2. Ayar klasöründeki `anahtar` dosyası (yalnızca sahibi okuyabilir, 0600)
//   3. Bellek (yalnızca bu oturum; sunucu kapanınca gider)
// Anahtarın kendisi hiçbir API yanıtında, günlükte ya da hata mesajında yer almaz.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnahtarDurumu, Ayar, BaslikTuru } from "./tipler.js";

export class AyarHatasi extends Error {}

export const ANAHTAR_DEGISKENI = "EKSTRE_LLM_ANAHTAR";

export const VARSAYILAN_AYAR: Ayar = {
  llm: { adres: "", model: "", baslik: "bearer", gorsel: false, sicaklik: 0, azami_token: 4096, sure_sn: 600, ek_istem: "", ek_govde: {} },
  karsilastirma: { konum_toleransi: 2, punto_toleransi: 0.4, llm_azami_fark: 120, maskele: true },
};

const BASLIKLAR: BaslikTuru[] = ["bearer", "api-key", "x-api-key", "yok"];

export function ayarKlasoru(): string {
  return process.env.EKSTRE_AYAR_KLASORU ? path.resolve(process.env.EKSTRE_AYAR_KLASORU) : path.join(os.homedir(), ".ekstre-karsilastir");
}

function nesne(deger: unknown): Record<string, unknown> {
  return deger && typeof deger === "object" && !Array.isArray(deger) ? (deger as Record<string, unknown>) : {};
}

function sayi(deger: unknown, ad: string, enAz: number, enCok: number, varsayilan: number): number {
  if (deger === undefined || deger === null || deger === "") return varsayilan;
  const n = Number(deger);
  if (!Number.isFinite(n) || n < enAz || n > enCok) throw new AyarHatasi(`${ad}: ${enAz} ile ${enCok} arasında bir sayı olmalı.`);
  return n;
}

/** Adresi sadeleştirir: sondaki "/" ve yanlışlıkla eklenen "/chat/completions" atılır. */
export function adresDuzelt(ham: string): string {
  const adres = ham.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
  if (!adres) return "";
  let url: URL;
  try {
    url = new URL(adres);
  } catch {
    throw new AyarHatasi("LLM adresi geçerli değil. Örnek: http://llm.kurum.local/v1");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AyarHatasi("LLM adresi http:// ya da https:// ile başlamalı.");
  if (url.username || url.password) throw new AyarHatasi("LLM adresine kullanıcı adı ya da parola yazmayın; anahtarı kendi alanına girin.");
  return adres;
}

/** Uygulamanın kendi yönettiği alanlar ek gövdeyle ezilemez; anahtar da buraya yazılamaz. */
const YASAK_GOVDE_ALANLARI = /^(model|messages|stream|response_format|api[-_]?key|anahtar|authorization|secret|password)$/i;

function ekGovde(ham: unknown): Record<string, unknown> {
  if (ham === undefined || ham === null || ham === "") return {};
  if (typeof ham !== "object" || Array.isArray(ham)) throw new AyarHatasi('İstek gövdesine ek bir JSON nesnesi olmalı; ör. {"reasoning_effort": "none"}.');
  const govde = ham as Record<string, unknown>;
  for (const alan of Object.keys(govde)) {
    if (YASAK_GOVDE_ALANLARI.test(alan)) throw new AyarHatasi(`İstek gövdesine ek içinde "${alan}" alanı kullanılamaz.`);
  }
  if (JSON.stringify(govde).length > 2000) throw new AyarHatasi("İstek gövdesine ek en fazla 2000 karakter olabilir.");
  return govde;
}

export function ayarDogrula(ham: unknown): Ayar {
  const kok = nesne(ham);
  const llm = nesne(kok.llm);
  const k = nesne(kok.karsilastirma);
  for (const alan of ["anahtar", "api_key", "apiKey", "key", "token"]) {
    if (alan in llm || alan in kok) throw new AyarHatasi("API anahtarı ayar dosyasına yazılmaz. Ayarlar ekranındaki anahtar alanını ya da EKSTRE_LLM_ANAHTAR değişkenini kullanın.");
  }
  const v = VARSAYILAN_AYAR;
  const baslik = (llm.baslik ?? v.llm.baslik) as BaslikTuru;
  if (!BASLIKLAR.includes(baslik)) throw new AyarHatasi(`Anahtar başlığı şunlardan biri olmalı: ${BASLIKLAR.join(", ")}.`);
  const ek = String(llm.ek_istem ?? "").trim();
  if (ek.length > 500) throw new AyarHatasi("Ek istem en fazla 500 karakter olabilir.");
  return {
    llm: {
      adres: adresDuzelt(String(llm.adres ?? "")),
      model: String(llm.model ?? "").trim(),
      baslik,
      gorsel: llm.gorsel === true,
      sicaklik: sayi(llm.sicaklik, "Sıcaklık", 0, 2, v.llm.sicaklik),
      azami_token: Math.round(sayi(llm.azami_token, "En fazla çıktı token'ı", 256, 32768, v.llm.azami_token)),
      sure_sn: Math.round(sayi(llm.sure_sn, "Zaman aşımı", 10, 1800, v.llm.sure_sn)),
      ek_istem: ek,
      ek_govde: ekGovde(llm.ek_govde),
    },
    karsilastirma: {
      konum_toleransi: sayi(k.konum_toleransi, "Konum toleransı", 0, 50, v.karsilastirma.konum_toleransi),
      punto_toleransi: sayi(k.punto_toleransi, "Punto toleransı", 0, 10, v.karsilastirma.punto_toleransi),
      llm_azami_fark: Math.round(sayi(k.llm_azami_fark, "LLM'e gönderilecek en fazla fark", 10, 500, v.karsilastirma.llm_azami_fark)),
      maskele: k.maskele !== false,
    },
  };
}

export class AyarDeposu {
  private bellekAnahtari: string | null = null;

  constructor(readonly klasor: string = ayarKlasoru()) {}

  private get ayarYolu() {
    return path.join(this.klasor, "ayar.json");
  }

  private get anahtarYolu() {
    return path.join(this.klasor, "anahtar");
  }

  oku(): Ayar {
    let ham: unknown = {};
    try {
      ham = JSON.parse(fs.readFileSync(this.ayarYolu, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new AyarHatasi(`Ayar dosyası okunamadı (${this.ayarYolu}): ${(e as Error).message}`);
    }
    return ayarDogrula(ham);
  }

  yaz(ham: unknown): Ayar {
    const ayar = ayarDogrula(ham);
    fs.mkdirSync(this.klasor, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.ayarYolu, `${JSON.stringify(ayar, null, 2)}\n`, { mode: 0o600 });
    return ayar;
  }

  anahtar(): string | null {
    const ortam = process.env[ANAHTAR_DEGISKENI]?.trim();
    if (ortam) return ortam;
    try {
      const dosya = fs.readFileSync(this.anahtarYolu, "utf8").trim();
      if (dosya) return dosya;
    } catch {
      // dosya yok: sıradaki kaynağa bak
    }
    return this.bellekAnahtari;
  }

  anahtarDurumu(): AnahtarDurumu {
    if (process.env[ANAHTAR_DEGISKENI]?.trim()) return { var: true, kaynak: "ortam" };
    try {
      if (fs.readFileSync(this.anahtarYolu, "utf8").trim()) return { var: true, kaynak: "dosya" };
    } catch {
      // dosya yok
    }
    return this.bellekAnahtari ? { var: true, kaynak: "bellek" } : { var: false, kaynak: null };
  }

  anahtarYaz(deger: string, kalici: boolean): void {
    const anahtar = deger.trim();
    if (!anahtar) throw new AyarHatasi("Anahtar boş olamaz.");
    if (/\s/.test(anahtar)) throw new AyarHatasi("Anahtarda boşluk ya da satır sonu olamaz.");
    this.anahtarSil();
    if (kalici) {
      fs.mkdirSync(this.klasor, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.anahtarYolu, anahtar, { mode: 0o600 });
      fs.chmodSync(this.anahtarYolu, 0o600);
    } else this.bellekAnahtari = anahtar;
  }

  anahtarSil(): void {
    this.bellekAnahtari = null;
    fs.rmSync(this.anahtarYolu, { force: true });
  }
}
