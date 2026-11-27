import type { Kategori, Mod, Onem } from "../../sunucu/src/tipler";

export const ONEMLER: Onem[] = ["kritik", "orta", "dusuk", "bilgi"];
export const ONEM_ADI: Record<Onem, string> = { kritik: "Kritik", orta: "Orta", dusuk: "Düşük", bilgi: "Bilgi" };
export const KATEGORI_ADI: Record<Kategori, string> = {
  tutar: "Tutar/sayı",
  tarih: "Tarih",
  metin: "Metin",
  yazim: "Yazım",
  yerlesim: "Yerleşim",
  bicim: "Biçim",
  gorsel: "Görsel",
  sayfa: "Sayfa",
};

export interface ModTanimi {
  ad: string;
  soru: string;
  aciklama: string;
  a: string;
  b: string;
  aIpucu: string;
  bIpucu: string;
  notEtiketi: string;
  notYardimi: string;
  notOrnegi: string;
}

export const MODLAR: Record<Mod, ModTanimi> = {
  donusum: {
    ad: "Dönüşüm karşılaştırma",
    soru: "Eski ve yeni sistemin ekstresi aynı mı?",
    aciklama: "Aynı müşterinin aynı dönem ekstresini iki uygulamadan alın. Her fark olası bir hatadır; tutar ve tarih farkları kritik sayılır.",
    a: "Eski sistem",
    b: "Yeni sistem",
    aIpucu: "Eski (legacy) uygulamanın ürettiği ekstre",
    bIpucu: "Yeni uygulamanın ürettiği ekstre",
    notEtiketi: "Bilinen ve kabul edilen farklar (isteğe bağlı)",
    notYardimi: "Buraya yazdığınız farklar hata sayılmaz, \"Bilinen fark\" olarak işaretlenir. LLM gerekir.",
    notOrnegi: "Örnek: Yeni sistemde tarihler GG.AA.YYYY biçiminde yazılıyor, kabul edildi.",
  },
  sablon: {
    ad: "Şablon fark analizi",
    soru: "Şablonda ne değişti, istenen bu mu?",
    aciklama: "Bugünkü şablonu (ya da \"böyle olsun\" denen örneği) yeni şablonla karşılaştırın. Farklar hata değil değişikliktir; istenenle uyumu denetlenir.",
    a: "Referans şablon",
    b: "Yeni şablon",
    aIpucu: "Bugünkü şablon ya da \"böyle olsun\" denen örnek",
    bIpucu: "Hazırlanan yeni şablonun çıktısı",
    notEtiketi: "İstenen değişiklikler (isteğe bağlı)",
    notYardimi: "Yazarsanız her fark \"İstenen\" ya da \"İstenmemiş\" olarak işaretlenir, karşılanmayan istekler listelenir. LLM gerekir.",
    notOrnegi: "Örnek: Adres bloğunun altına kampanya kutusu eklensin. Nakit Çekim Limiti satırı kaldırılsın.",
  },
};

export function boyutYaz(bayt: number): string {
  return bayt < 1024 * 1024 ? `${Math.max(1, Math.round(bayt / 1024))} KB` : `${(bayt / 1024 / 1024).toFixed(1)} MB`;
}
