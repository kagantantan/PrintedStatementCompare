// Servis modu: uygulamanın başka uygulamalarca ağdan çağrılması.
//
// Varsayılan davranış değişmez: sunucu yalnızca bu bilgisayarı (127.0.0.1) dinler.
// Ağa açmak bilinçli bir karardır ve iki şey ister:
//   1. Dinlenecek adres: --dinle 0.0.0.0 ya da EKSTRE_DINLE
//   2. En az bir servis anahtarı: EKSTRE_SERVIS_ANAHTARLARI (virgülle ayrılmış) ya da ayar klasöründeki
//      `servis-anahtarlari` dosyası (her satıra bir anahtar; # ile başlayan satır yorumdur)
// Anahtarsız ağa açılmaz: sunucu başlamayı reddeder.
//
// Servis anahtarları LLM anahtarından ayrıdır: bunlar BU servisi çağıranları tanır.
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class ServisHatasi extends Error {}

export const SERVIS_ANAHTAR_DEGISKENI = "EKSTRE_SERVIS_ANAHTARLARI";
export const EN_KISA_ANAHTAR = 24;

export interface ServisAyari {
  dinle: string;
  /** Anahtarların SHA-256 özetleri; anahtarın kendisi bellekte tutulmaz. */
  ozetler: Buffer[];
  es_zamanli: number;
  azami_sira: number;
  omur_dk: number;
}

const ozet = (metin: string) => createHash("sha256").update(metin).digest();

export function yerelAdresMi(adres: string): boolean {
  return adres === "127.0.0.1" || adres === "::1" || adres === "localhost" || adres === "::ffff:127.0.0.1";
}

function tamSayi(ham: string | undefined, ad: string, enAz: number, enCok: number, varsayilan: number): number {
  if (ham === undefined || ham === "") return varsayilan;
  const n = Number(ham);
  if (!Number.isInteger(n) || n < enAz || n > enCok) throw new ServisHatasi(`${ad}: ${enAz} ile ${enCok} arasında bir tam sayı olmalı.`);
  return n;
}

export function servisAyariOku(ortam: NodeJS.ProcessEnv, dinle: string | undefined, klasor: string): ServisAyari {
  const adres = (dinle ?? ortam.EKSTRE_DINLE ?? "127.0.0.1").trim();
  const anahtarlar = new Set<string>();
  for (const a of (ortam[SERVIS_ANAHTAR_DEGISKENI] ?? "").split(",")) if (a.trim()) anahtarlar.add(a.trim());
  try {
    for (const satir of fs.readFileSync(path.join(klasor, "servis-anahtarlari"), "utf8").split(/\r?\n/)) {
      const a = satir.trim();
      if (a && !a.startsWith("#")) anahtarlar.add(a);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new ServisHatasi(`Servis anahtarları dosyası okunamadı: ${(e as Error).message}`);
  }
  for (const a of anahtarlar) {
    if (a.length < EN_KISA_ANAHTAR || /\s/.test(a)) throw new ServisHatasi(`Servis anahtarı en az ${EN_KISA_ANAHTAR} karakter olmalı ve boşluk içermemeli. Örnek üretim: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`);
  }
  if (!yerelAdresMi(adres) && !anahtarlar.size) {
    throw new ServisHatasi(
      `Sunucu ${adres} adresini dinleyecek ama servis anahtarı tanımlı değil. Anahtarsız ağa açılmaz: ${SERVIS_ANAHTAR_DEGISKENI} değişkenini ya da ayar klasöründeki servis-anahtarlari dosyasını tanımlayın.`,
    );
  }
  return {
    dinle: adres,
    ozetler: [...anahtarlar].map(ozet),
    es_zamanli: tamSayi(ortam.EKSTRE_ES_ZAMANLI, "EKSTRE_ES_ZAMANLI", 1, 16, 1),
    azami_sira: tamSayi(ortam.EKSTRE_AZAMI_SIRA, "EKSTRE_AZAMI_SIRA", 1, 1000, 20),
    omur_dk: tamSayi(ortam.EKSTRE_SONUC_OMRU_DK, "EKSTRE_SONUC_OMRU_DK", 1, 1440, 30),
  };
}

/** İstekteki anahtarı (Authorization: Bearer ya da x-api-key) tanır; sahibin kısa kimliğini döner, tanımazsa null. */
export function anahtarTani(basliklar: Record<string, string | string[] | undefined>, ozetler: Buffer[]): string | null {
  const yetki = String(basliklar.authorization ?? "");
  const verilen = (/^Bearer\s+(.+)$/i.exec(yetki)?.[1] ?? String(basliklar["x-api-key"] ?? "")).trim();
  if (!verilen) return null;
  const o = ozet(verilen);
  let bulunan: Buffer | null = null;
  // Süre anahtarın doğruluğunu ele vermesin diye hepsiyle sabit sürede karşılaştırılır.
  for (const kayitli of ozetler) if (timingSafeEqual(o, kayitli)) bulunan = kayitli;
  return bulunan ? bulunan.subarray(0, 6).toString("hex") : null;
}
