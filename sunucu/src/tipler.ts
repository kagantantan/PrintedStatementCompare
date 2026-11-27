// Sunucu ile arayüzün paylaştığı tipler. Arayüz bu dosyayı yalnızca tip olarak içe alır.

/** donusum: eski sistem ile yeni sistemin çıktısı aynı olmalı. sablon: şablon bilerek değişti, ne değişti? */
export type Mod = "donusum" | "sablon";

export type Onem = "kritik" | "orta" | "dusuk" | "bilgi";

/** Sayfa üzerinde bir dikdörtgen. Birim PDF noktası (1/72 inç), köşe sol üst. */
export interface Kutu {
  sayfa: number;
  x: number;
  y: number;
  en: number;
  boy: number;
}

/** Aynı satırda, aralarında büyük boşluk olmayan metin: bir etiket, bir değer ya da bir tablo hücresi. */
export interface Parca extends Kutu {
  no: number;
  metin: string;
  punto: number;
  /** Aynı satırdaki parçaların soldan sağa birleşimi; farkı anlatırken bağlam olur. */
  satir: string;
}

export interface SayfaBilgisi {
  no: number;
  en: number;
  boy: number;
}

export interface Belge {
  ad: string;
  sayfalar: SayfaBilgisi[];
  parcalar: Parca[];
}

export type FarkTuru = "degisti" | "eksik" | "fazla" | "kaydi" | "bicim" | "gorsel" | "sayfa";
export type Kategori = "tutar" | "tarih" | "metin" | "yazim" | "yerlesim" | "bicim" | "gorsel" | "sayfa";

export interface FarkYani {
  metin: string;
  satir: string;
  kutu: Kutu;
}

/** Makinenin bulduğu tek bir ham fark. LLM bunları yorumlar ama silemez. */
export interface Fark {
  kimlik: string;
  tur: FarkTuru;
  kategori: Kategori;
  a?: FarkYani;
  b?: FarkYani;
  /** Değişen bir değerin solundaki etiket ("Dönem Borcu"); varsa. */
  etiket?: string;
  /** İnsan için tek cümle: ne farklı. */
  ayrinti: string;
  /** Kuralla verilen önem; LLM yoksa ya da bu farka değinmediyse geçerli olan budur. */
  onem: Onem;
  /** Gruplanmış farklarda (kayma, punto) kaç parçayı kapsadığı. */
  adet?: number;
}

/** Kullanıcıya gösterilen bulgu: bir ya da birkaç ham farkın anlamlı özeti. */
export interface Bulgu {
  kimlik: string;
  baslik: string;
  aciklama: string;
  onem: Onem;
  kategori: Kategori;
  /** Dayandığı ham farkların kimlikleri. Boşsa kanıtsızdır (yalnızca LLM gözlemi). */
  farklar: string[];
  /** Yalnızca şablon modunda ve istek yazıldıysa: istenen bir değişiklik mi? null: belirlenemedi. */
  beklenen: boolean | null;
  kaynak: "llm" | "kural";
}

export interface Hukum {
  durum: "temiz" | "dikkat" | "sorun";
  metin: string;
}

export interface LlmKullanimi {
  kullanildi: boolean;
  model?: string;
  sure_ms?: number;
  gorsel?: boolean;
  /** LLM'e gönderilen ham fark sayısı (üst sınır aşıldıysa toplamdan azdır). */
  gonderilen?: number;
  hata?: string;
}

export interface Rapor {
  mod: Mod;
  yalniz_yapi: boolean;
  hukum: Hukum;
  ozet: string;
  bulgular: Bulgu[];
  farklar: Fark[];
  /** Şablon modu: istenip de belgede görülmeyen değişiklikler. */
  karsilanmayan: string[];
  uyarilar: string[];
  belgeler: { a: BelgeOzeti; b: BelgeOzeti };
  llm: LlmKullanimi;
  tarih: string;
}

export interface BelgeOzeti {
  ad: string;
  sayfa: number;
  parca: number;
}

/** Arayüzün sayfa görüntülerinden çıkardığı, renk ya da mürekkep yoğunluğu farklı bölge. */
export interface GorselBolge extends Kutu {
  /** 0..1: bölgedeki hücrelerin ortalama farkı. */
  siddet: number;
}

export interface KarsilastirIstegi {
  mod: Mod;
  a: DosyaGirdisi;
  b: DosyaGirdisi;
  /** donusum: bilinen ve kabul edilen farklar. sablon: istenen değişiklikler. */
  not?: string;
  /** sablon: iki belgedeki veriler farklı; rakamları ve tarihleri karşılaştırma. */
  yalniz_yapi?: boolean;
  /** false verilirse LLM çağrılmaz; yalnızca makine farkları döner. */
  llm?: boolean;
  gorsel_bolgeler?: GorselBolge[];
  /** Görsel girdi açıksa: sayfa görüntüleri (data:image/jpeg;base64,...). */
  goruntuler?: { a: string[]; b: string[] };
}

export interface DosyaGirdisi {
  ad: string;
  /** PDF ise içeriği base64. Resim dosyalarında boş kalır: metin katmanı yoktur. */
  pdf_base64?: string;
  /** Resim dosyasında arayüzün bildirdiği sayfa boyutları. */
  sayfalar?: SayfaBilgisi[];
}

export type BaslikTuru = "bearer" | "api-key" | "x-api-key" | "yok";

export interface LlmAyari {
  /** OpenAI uyumlu servisin taban adresi, ör. http://llm.kurum.local/v1 */
  adres: string;
  model: string;
  baslik: BaslikTuru;
  /** Model görsel girdi (image_url) kabul ediyor mu? */
  gorsel: boolean;
  sicaklik: number;
  azami_token: number;
  sure_sn: number;
  /** Sistem isteminin sonuna eklenir; bazı sunucularda Qwen3'ün düşünmesini "/no_think" kapatır. */
  ek_istem: string;
  /** Her sohbet isteğinin gövdesine eklenen alanlar; ör. Ollama'da düşünmeyi kapatmak için {"reasoning_effort": "none"}. */
  ek_govde: Record<string, unknown>;
}

export interface KarsilastirmaAyari {
  /** Aynı metnin yeri bu kadar noktadan fazla oynadıysa kayma sayılır. */
  konum_toleransi: number;
  punto_toleransi: number;
  /** LLM'e gönderilecek en fazla ham fark. */
  llm_azami_fark: number;
  /** LLM'e giden metinde uzun rakam dizilerini (kart, hesap, kimlik no) maskele. */
  maskele: boolean;
}

export interface Ayar {
  llm: LlmAyari;
  karsilastirma: KarsilastirmaAyari;
}

export interface AnahtarDurumu {
  var: boolean;
  /** ortam: EKSTRE_LLM_ANAHTAR değişkeni. dosya: ayar klasöründeki anahtar dosyası. bellek: yalnızca bu oturum. */
  kaynak: "ortam" | "dosya" | "bellek" | null;
}

export interface AyarYaniti {
  ayar: Ayar;
  anahtar: AnahtarDurumu;
  klasor: string;
  surum: string;
}

export interface AyarKaydi {
  ayar: Ayar;
  /** deger verilirse anahtar değişir; sil: true ise kaldırılır; alan yoksa anahtara dokunulmaz. */
  anahtar?: { deger?: string; kalici?: boolean; sil?: boolean };
}

export interface SinamaAdimi {
  ad: string;
  tamam: boolean;
  ayrinti: string;
}

export interface SinamaSonucu {
  tamam: boolean;
  adimlar: SinamaAdimi[];
  modeller: string[];
}
