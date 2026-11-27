// İş kuyruğu: ağdan gelen karşılaştırma istekleri hemen bir iş numarası alır, sonuç sonra sorulur.
// LLM'li bir karşılaştırma dakikalar sürebildiği için istek açık bekletilmez.
//
// İşler yalnızca bellekte durur (ekstre içeriği taşırlar): diske yazılmaz, süresi dolunca silinir,
// sunucu kapanınca kaybolur. Bir işi yalnızca onu gönderen anahtar görebilir.
import { randomUUID } from "node:crypto";
import type { IsDurumu, IsYaniti, KarsilastirIstegi, Rapor } from "./tipler.js";

export class KuyrukDolu extends Error {}

export interface KuyrukSecenekleri {
  /** Aynı anda çalışan iş sayısı. LLM tek istek işliyorsa 1 kalmalı. */
  es_zamanli: number;
  /** Sırada bekleyebilecek en fazla iş. */
  azami_sira: number;
  /** Biten işin sonucu bu kadar süre saklanır (ms). */
  omur_ms: number;
  simdi?: () => number;
}

interface Is {
  kimlik: string;
  sahip: string;
  durum: IsDurumu;
  istek?: KarsilastirIstegi;
  olusturma: number;
  baslama?: number;
  bitis?: number;
  rapor?: Rapor;
  hata?: string;
}

export class IsKuyrugu {
  private isler = new Map<string, Is>();
  private sira: string[] = [];
  private calisan = 0;
  private temizlik: NodeJS.Timeout;
  private simdi: () => number;

  constructor(
    private calistir: (istek: KarsilastirIstegi) => Promise<Rapor>,
    private sec: KuyrukSecenekleri,
  ) {
    this.simdi = sec.simdi ?? Date.now;
    this.temizlik = setInterval(() => this.temizle(), 30_000);
    this.temizlik.unref();
  }

  ekle(sahip: string, istek: KarsilastirIstegi): IsYaniti {
    this.temizle();
    if (this.sira.length >= this.sec.azami_sira) throw new KuyrukDolu(`Sırada ${this.sira.length} iş var; kuyruk dolu. Biraz sonra yeniden deneyin.`);
    const is: Is = { kimlik: randomUUID(), sahip, durum: "sirada", istek, olusturma: this.simdi() };
    this.isler.set(is.kimlik, is);
    this.sira.push(is.kimlik);
    this.ilerle();
    return this.yanit(is);
  }

  al(sahip: string, kimlik: string): IsYaniti | null {
    this.temizle();
    const is = this.isler.get(kimlik);
    // Başkasının işi "yok" gibi görünür: var olduğu bile söylenmez.
    return is && is.sahip === sahip ? this.yanit(is) : null;
  }

  /** İşi ve sonucunu siler. Çalışan iş durdurulamaz; bitince sonucu saklanmadan atılır. */
  sil(sahip: string, kimlik: string): boolean {
    const is = this.isler.get(kimlik);
    if (!is || is.sahip !== sahip) return false;
    this.isler.delete(kimlik);
    this.sira = this.sira.filter((k) => k !== kimlik);
    is.istek = undefined;
    is.rapor = undefined;
    return true;
  }

  durum(): { sirada: number; calisan: number } {
    return { sirada: this.sira.length, calisan: this.calisan };
  }

  kapat(): void {
    clearInterval(this.temizlik);
    this.isler.clear();
    this.sira = [];
  }

  private ilerle(): void {
    while (this.calisan < this.sec.es_zamanli && this.sira.length) {
      const is = this.isler.get(this.sira.shift()!);
      if (!is?.istek) continue;
      const istek = is.istek;
      is.istek = undefined; // PDF'ler işlenince bellekten düşsün
      is.durum = "calisiyor";
      is.baslama = this.simdi();
      this.calisan++;
      this.calistir(istek)
        .then(
          (rapor) => {
            is.rapor = rapor;
            is.durum = "bitti";
          },
          (hata: Error) => {
            is.hata = hata.message;
            is.durum = "hata";
          },
        )
        .finally(() => {
          is.bitis = this.simdi();
          this.calisan--;
          // Silinmiş işin sonucu saklanmaz.
          if (!this.isler.has(is.kimlik)) is.rapor = undefined;
          this.ilerle();
        });
    }
  }

  private temizle(): void {
    const esik = this.simdi() - this.sec.omur_ms;
    for (const [kimlik, is] of this.isler) {
      if (is.bitis !== undefined && is.bitis < esik) this.isler.delete(kimlik);
    }
  }

  private yanit(is: Is): IsYaniti {
    const siradaki = this.sira.indexOf(is.kimlik);
    return {
      kimlik: is.kimlik,
      durum: is.durum,
      ...(siradaki >= 0 ? { sira: siradaki + 1 } : {}),
      olusturma: new Date(is.olusturma).toISOString(),
      ...(is.baslama !== undefined ? { baslama: new Date(is.baslama).toISOString() } : {}),
      ...(is.bitis !== undefined ? { bitis: new Date(is.bitis).toISOString(), sure_ms: is.bitis - (is.baslama ?? is.olusturma) } : {}),
      ...(is.rapor ? { rapor: is.rapor } : {}),
      ...(is.hata ? { hata: is.hata } : {}),
    };
  }
}
