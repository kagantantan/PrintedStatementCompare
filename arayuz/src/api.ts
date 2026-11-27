import type { AyarKaydi, AyarYaniti, KarsilastirIstegi, Rapor, SinamaSonucu } from "../../sunucu/src/tipler";

export interface OrnekBilgisi {
  kimlik: string;
  ad: string;
  aciklama: string;
  mod: "donusum" | "sablon";
  a: string;
  b: string;
  not: string;
}

async function iste<T>(yol: string, secenek?: RequestInit): Promise<T> {
  let yanit: Response;
  try {
    yanit = await fetch(yol, secenek);
  } catch {
    throw new Error("Sunucuya ulaşılamadı. Uygulamanın açık olduğu pencereyi kontrol edin.");
  }
  if (!yanit.ok) {
    let ayrinti = `Sunucu hata döndü (${yanit.status}).`;
    try {
      const govde = (await yanit.json()) as { detail?: string };
      if (govde.detail) ayrinti = govde.detail;
    } catch {
      // gövde JSON değil: genel mesaj kalır
    }
    throw new Error(ayrinti);
  }
  return (await yanit.json()) as T;
}

const json = (yontem: string, govde: unknown, sinyal?: AbortSignal): RequestInit => ({
  method: yontem,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(govde),
  signal: sinyal,
});

export const api = {
  ayar: () => iste<AyarYaniti>("/api/ayar"),
  ayarKaydet: (kayit: AyarKaydi) => iste<AyarYaniti>("/api/ayar", json("PUT", kayit)),
  ayarSina: (kayit: AyarKaydi) => iste<SinamaSonucu>("/api/ayar/sina", json("POST", kayit)),
  karsilastir: (istek: KarsilastirIstegi, sinyal?: AbortSignal) => iste<Rapor>("/api/karsilastir", json("POST", istek, sinyal)),
  ornekler: () => iste<OrnekBilgisi[]>("/api/ornekler"),
  async ornekDosyasi(ad: string): Promise<File> {
    const yanit = await fetch(`/api/ornek/${encodeURIComponent(ad)}`);
    if (!yanit.ok) throw new Error("Örnek dosya alınamadı.");
    return new File([await yanit.blob()], ad, { type: "application/pdf" });
  },
};
