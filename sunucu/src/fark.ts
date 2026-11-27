// Fark motoru: iki belgenin parçalarını eşleştirir ve ham farkları çıkarır. LLM kullanmaz, her koşuda aynı sonucu verir.
//
// Eşleştirme dört adımdır:
//   1. Okuma sırasında aynı metinler (en uzun ortak alt dizi)
//   2. Sırası değişmiş aynı metinler (en yakın konumdaki)
//   3. Komşusu eşleşen parçalar: aynı etiketin değeri, aynı satırın hücresi ("Dönem Borcu" → tutarı)
//   4. Benzer metinler (aynı yerde ya da büyük ölçüde aynı)
// Eşleşmeyenler eksik ya da fazladır. Eşleşenlerin yeri, puntosu ve genişliği ayrıca karşılaştırılır.
import { diffArrays } from "diff";
import { benzerlik, kisalt, sade, sayiCoz, tarihCoz, tarihIzi, veriGizle, yazimsiz } from "./metin.js";
import type { Belge, Fark, FarkYani, GorselBolge, Kategori, Kutu, Mod, Onem, Parca } from "./tipler.js";

export interface FarkSecenekleri {
  mod: Mod;
  yalniz_yapi: boolean;
  konum_toleransi: number;
  punto_toleransi: number;
}

export interface TarafAdlari {
  a: string;
  b: string;
}

export function tarafAdlari(mod: Mod): TarafAdlari {
  return mod === "donusum" ? { a: "Eski sistem", b: "Yeni sistem" } : { a: "Referans", b: "Yeni şablon" };
}

const MM = 0.3528;
const mm = (nokta: number) => (Math.abs(nokta) * MM).toLocaleString("tr-TR", { maximumFractionDigits: 1 });

export function farkBul(a: Belge, b: Belge, sec: FarkSecenekleri, bolgeler: GorselBolge[] = []): Fark[] {
  const ad = tarafAdlari(sec.mod);
  const farklar: Omit<Fark, "kimlik">[] = [];

  farklar.push(...sayfaFarklari(a, b, sec, ad));

  const anahtar = (p: Parca) => (sec.yalniz_yapi ? veriGizle(p.metin) : sade(p.metin));
  const ka = a.parcalar.map(anahtar);
  const kb = b.parcalar.map(anahtar);
  const es = new Map<number, number>(); // A parça sırası → B parça sırası
  const bDolu = new Set<number>();
  const esle = (i: number, j: number) => {
    es.set(i, j);
    bDolu.add(j);
  };

  // 1. Okuma sırasında aynı metinler
  let i = 0;
  let j = 0;
  for (const dilim of diffArrays(ka, kb)) {
    const adet = dilim.count ?? dilim.value.length;
    if (dilim.added) j += adet;
    else if (dilim.removed) i += adet;
    else for (let k = 0; k < adet; k++) esle(i++, j++);
  }

  // 2. Sırası değişmiş aynı metinler: en yakın konumdaki
  const bAnahtarli = new Map<string, number[]>();
  kb.forEach((k, sira) => {
    if (bDolu.has(sira)) return;
    const liste = bAnahtarli.get(k);
    if (liste) liste.push(sira);
    else bAnahtarli.set(k, [sira]);
  });
  for (let sira = 0; sira < ka.length; sira++) {
    if (es.has(sira)) continue;
    const adaylar = bAnahtarli.get(ka[sira]!)?.filter((s) => !bDolu.has(s));
    if (!adaylar?.length) continue;
    const p = a.parcalar[sira]!;
    adaylar.sort((s, t) => uzaklik(p, b.parcalar[s]!) - uzaklik(p, b.parcalar[t]!));
    esle(sira, adaylar[0]!);
  }

  // 3. Komşusu eşleşen parçalar
  const degisen: [number, number][] = [];
  const tersEs = () => new Map([...es].map(([x, y]) => [y, x]));
  for (let tur = 0; tur < 2; tur++) {
    for (let sira = 0; sira < ka.length; sira++) {
      if (es.has(sira)) continue;
      const sol = satirKomsusu(a.parcalar, sira, -1);
      const sag = satirKomsusu(a.parcalar, sira, +1);
      let aday: number | null = null;
      if (sol !== null && es.has(sol)) aday = satirKomsusu(b.parcalar, es.get(sol)!, +1);
      if ((aday === null || bDolu.has(aday)) && sag !== null && es.has(sag)) aday = satirKomsusu(b.parcalar, es.get(sag)!, -1);
      if (aday === null || bDolu.has(aday)) continue;
      esle(sira, aday);
      degisen.push([sira, aday]);
    }
  }

  // 4. Benzer metinler
  const aBos = ka.map((_, s) => s).filter((s) => !es.has(s));
  const bBos = kb.map((_, s) => s).filter((s) => !bDolu.has(s));
  if (aBos.length && bBos.length && aBos.length * bBos.length <= 250_000) {
    const adaylar: { i: number; j: number; puan: number }[] = [];
    for (const x of aBos) {
      for (const y of bBos) {
        const p = a.parcalar[x]!;
        const q = b.parcalar[y]!;
        if (Math.abs(p.sayfa - q.sayfa) > 1) continue;
        const yakin = p.sayfa === q.sayfa && Math.abs(p.x - q.x) <= 3 * Math.max(1, sec.konum_toleransi) && Math.abs(p.y - q.y) <= 3 * Math.max(1, sec.konum_toleransi);
        const b_ = benzerlik(ka[x]!.toLocaleLowerCase("tr"), kb[y]!.toLocaleLowerCase("tr"));
        if (b_ >= 0.6 || (yakin && b_ >= 0.2) || (yakin && sayiCoz(p.metin) !== null && sayiCoz(q.metin) !== null)) {
          adaylar.push({ i: x, j: y, puan: b_ + (yakin ? 0.5 : 0) - Math.min(0.2, uzaklik(p, q) / 5000) });
        }
      }
    }
    adaylar.sort((x, y) => y.puan - x.puan);
    for (const aday of adaylar) {
      if (es.has(aday.i) || bDolu.has(aday.j)) continue;
      esle(aday.i, aday.j);
      degisen.push([aday.i, aday.j]);
    }
  }

  // Değişenler
  const degisenA = new Set(degisen.map(([x]) => x));
  for (const [x, y] of degisen) {
    const p = a.parcalar[x]!;
    const q = b.parcalar[y]!;
    const sinif = sinifla(p, q, a.parcalar, x);
    farklar.push({
      tur: "degisti",
      kategori: sinif.kategori,
      a: yan(p),
      b: yan(q),
      ...(sinif.etiket ? { etiket: sinif.etiket } : {}),
      ayrinti: sinif.ayrinti,
      onem: onemBelirle(sec.mod, sinif.kategori, "degisti", `${p.metin} ${q.metin}`),
    });
  }

  // Eksik ve fazla: aynı satırdaki art arda parçalar tek fark olur (eksik bir işlem satırı = bir fark)
  const ters = tersEs();
  for (const grup of satirGruplari(a.parcalar, (s) => !es.has(s))) {
    const y_ = yanBirlesik(grup);
    farklar.push({ tur: "eksik", kategori: "metin", a: y_, ayrinti: `${ad.b} tarafında yok`, onem: onemBelirle(sec.mod, "metin", "eksik", y_.metin) });
  }
  for (const grup of satirGruplari(b.parcalar, (s) => !ters.has(s))) {
    const y_ = yanBirlesik(grup);
    farklar.push({ tur: "fazla", kategori: "metin", b: y_, ayrinti: `${ad.a} tarafında yok`, onem: onemBelirle(sec.mod, "metin", "fazla", y_.metin) });
  }

  // Aynı metnin yeri, puntosu, genişliği
  const ayni = [...es].filter(([x]) => !degisenA.has(x)).map(([x, y]) => [a.parcalar[x]!, b.parcalar[y]!] as const);
  farklar.push(...yerlesimFarklari(ayni, sec, ad));
  farklar.push(...bicimFarklari(ayni, sec));

  farklar.push(...gorselFarklar(a, b, bolgeler, sec.mod));

  const sirali = farklar.sort((p, q) => konumSirasi(p) - konumSirasi(q));
  return sirali.map((f, sira) => ({ kimlik: `F${sira + 1}`, ...f }));
}

function konumSirasi(f: Omit<Fark, "kimlik">): number {
  const k = f.a?.kutu ?? f.b?.kutu;
  if (!k) return -1;
  return k.sayfa * 1_000_000 + Math.round(k.y) * 1000 + Math.round(k.x);
}

function uzaklik(p: Kutu, q: Kutu): number {
  return Math.abs(p.sayfa - q.sayfa) * 10_000 + Math.hypot(p.x - q.x, p.y - q.y);
}

function ayniSatir(p: Parca, q: Parca): boolean {
  return p.sayfa === q.sayfa && Math.abs(p.y + p.boy * 0.8 - (q.y + q.boy * 0.8)) <= 0.5 * Math.min(p.punto, q.punto);
}

/** Aynı satırdaki sol (-1) ya da sağ (+1) komşunun sırası; yoksa null. Parçalar okuma sırasındadır. */
function satirKomsusu(parcalar: Parca[], sira: number, yon: -1 | 1): number | null {
  const p = parcalar[sira];
  const q = parcalar[sira + yon];
  if (!p || !q || !ayniSatir(p, q)) return null;
  return sira + yon;
}

function satirGruplari(parcalar: Parca[], secili: (sira: number) => boolean): Parca[][] {
  const gruplar: Parca[][] = [];
  let oncekiSira = -2;
  for (let sira = 0; sira < parcalar.length; sira++) {
    if (!secili(sira)) continue;
    const p = parcalar[sira]!;
    const grup = gruplar[gruplar.length - 1];
    if (grup && oncekiSira === sira - 1 && ayniSatir(grup[grup.length - 1]!, p)) grup.push(p);
    else gruplar.push([p]);
    oncekiSira = sira;
  }
  return gruplar;
}

function yan(p: Parca): FarkYani {
  return { metin: p.metin, satir: p.satir, kutu: { sayfa: p.sayfa, x: p.x, y: p.y, en: p.en, boy: p.boy } };
}

function birlesikKutu(kutular: Kutu[]): Kutu {
  const x = Math.min(...kutular.map((k) => k.x));
  const y = Math.min(...kutular.map((k) => k.y));
  return {
    sayfa: kutular[0]!.sayfa,
    x,
    y,
    en: Math.max(...kutular.map((k) => k.x + k.en)) - x,
    boy: Math.max(...kutular.map((k) => k.y + k.boy)) - y,
  };
}

function yanBirlesik(grup: Parca[]): FarkYani {
  return { metin: grup.map((p) => p.metin).join("  |  "), satir: grup[0]!.satir, kutu: birlesikKutu(grup) };
}

function ornekMetin(parcalar: Parca[]): string {
  const ilk = parcalar.slice(0, 3).map((p) => `“${kisalt(p.metin, 40)}”`).join(", ");
  return parcalar.length > 3 ? `${ilk} ve ${parcalar.length - 3} parça daha` : ilk;
}

/** “eski” → “yeni”. Uzun metinlerde yalnızca değişen kelimeler ve birer kelimelik çevresi gösterilir. */
function degisenKisim(xHam: string, yHam: string): string {
  // Değerlerin başındaki ortak ": " gösterimde kalabalık yapar.
  const ortakOnEk = /^:\s*/.test(xHam) && /^:\s*/.test(yHam);
  const x = ortakOnEk ? xHam.replace(/^:\s*/, "") : xHam;
  const y = ortakOnEk ? yHam.replace(/^:\s*/, "") : yHam;
  if (x.length <= 60 && y.length <= 60) return `“${x}” → “${y}”`;
  const kx = x.split(" ");
  const ky = y.split(" ");
  let bas = 0;
  while (bas < kx.length && bas < ky.length && kx[bas] === ky[bas]) bas++;
  let son = 0;
  while (son < kx.length - bas && son < ky.length - bas && kx[kx.length - 1 - son] === ky[ky.length - 1 - son]) son++;
  const kes = (k: string[]) => {
    const ilk = Math.max(0, bas - 2);
    const bitis = Math.min(k.length, k.length - son + 2);
    return `${ilk > 0 ? "… " : ""}${kisalt(k.slice(ilk, bitis).join(" "), 90)}${bitis < k.length ? " …" : ""}`;
  };
  return `“${kes(kx)}” → “${kes(ky)}”`;
}

interface Sinif {
  kategori: Kategori;
  ayrinti: string;
  etiket?: string;
}

/** Değişen bir parçanın ne tür bir değişiklik olduğunu söyler: tutar, tarih, yazım, biçim ya da metin. */
export function sinifla(p: Parca, q: Parca, aParcalari: Parca[] = [], sira = -1): Sinif {
  const x = sade(p.metin);
  const y = sade(q.metin);
  const sol = sira >= 0 ? satirKomsusu(aParcalari, sira, -1) : null;
  const etiketMetni = sol !== null ? kisalt(aParcalari[sol]!.metin, 50) : undefined;
  const sonuc = siniflaIc(x, y, etiketMetni ? `${etiketMetni}: ` : "");
  return etiketMetni ? { ...sonuc, etiket: etiketMetni } : sonuc;
}

function siniflaIc(x: string, y: string, etiket: string): Sinif {
  const cift = degisenKisim(x, y);

  if (yazimsiz(x) === yazimsiz(y)) return { kategori: "yazim", ayrinti: `${etiket}yalnızca yazım farklı (büyük-küçük harf, boşluk ya da noktalama): ${cift}` };

  const tx = tarihCoz(x);
  const ty = tarihCoz(y);
  if (tx && ty) {
    return tx === ty
      ? { kategori: "bicim", ayrinti: `${etiket}tarih aynı, yazılışı farklı: ${cift}` }
      : { kategori: "tarih", ayrinti: `${etiket}tarih farklı: ${cift}` };
  }

  const sx: string[] = [];
  const sy: string[] = [];
  for (const dilim of diffArrays(x.split(" "), y.split(" "))) {
    if (dilim.removed) sx.push(...dilim.value);
    else if (dilim.added) sy.push(...dilim.value);
  }
  const nx = sx.map(sayiCoz);
  const ny = sy.map(sayiCoz);
  const hepsiSayi = sx.length + sy.length > 0 && nx.every((n) => n !== null) && ny.every((n) => n !== null);
  if (hepsiSayi) {
    if (nx.length === ny.length && nx.every((n, k) => n === ny[k])) return { kategori: "bicim", ayrinti: `${etiket}sayı aynı, yazılışı farklı: ${cift}` };
    if (tarihIzi(x) || tarihIzi(y)) return { kategori: "tarih", ayrinti: `${etiket}tarih farklı: ${cift}` };
    let fark = "";
    if (nx.length === 1 && ny.length === 1) {
      const d = Math.round((ny[0]! - nx[0]!) * 100) / 100;
      fark = ` (fark ${d > 0 ? "+" : ""}${d.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    }
    return { kategori: "tutar", ayrinti: `${etiket}tutar ya da sayı farklı: ${cift}${fark}` };
  }
  if (tarihIzi(x) && tarihIzi(y) && benzerlik(x, y) >= 0.5) return { kategori: "tarih", ayrinti: `${etiket}tarih farklı: ${cift}` };
  return { kategori: "metin", ayrinti: `${etiket}metin farklı: ${cift}` };
}

/** Kuralla önem: LLM yoksa ya da farka değinmediyse geçerli olan budur. */
export function onemBelirle(mod: Mod, kategori: Kategori, tur: Fark["tur"], metin = "", buyukluk = 0): Onem {
  if (mod === "sablon") {
    if (kategori === "yerlesim") return buyukluk >= 10 ? "orta" : "dusuk";
    if (kategori === "yazim" || kategori === "bicim") return "dusuk";
    return "orta";
  }
  switch (kategori) {
    case "tutar":
    case "tarih":
      return "kritik";
    case "metin":
      // Eksik ya da fazla satırda rakam varsa bir tutar ya da işlem kaybolmuş olabilir.
      return (tur === "eksik" || tur === "fazla") && /\d/.test(metin) ? "kritik" : "orta";
    case "sayfa":
      return tur === "sayfa" && buyukluk > 0 ? "kritik" : "orta";
    case "bicim":
      return tur === "degisti" ? "orta" : "dusuk";
    case "gorsel":
      return "orta";
    case "yerlesim":
      return buyukluk >= 10 ? "orta" : "dusuk";
    case "yazim":
      return "dusuk";
  }
}

function sayfaFarklari(a: Belge, b: Belge, sec: FarkSecenekleri, ad: { a: string; b: string }): Omit<Fark, "kimlik">[] {
  const farklar: Omit<Fark, "kimlik">[] = [];
  if (a.sayfalar.length !== b.sayfalar.length) {
    farklar.push({
      tur: "sayfa",
      kategori: "sayfa",
      ayrinti: `Sayfa sayısı farklı: ${ad.a} ${a.sayfalar.length}, ${ad.b} ${b.sayfalar.length}`,
      onem: onemBelirle(sec.mod, "sayfa", "sayfa", "", 1),
    });
  }
  for (let s = 0; s < Math.min(a.sayfalar.length, b.sayfalar.length); s++) {
    const p = a.sayfalar[s]!;
    const q = b.sayfalar[s]!;
    if (Math.abs(p.en - q.en) > 1 || Math.abs(p.boy - q.boy) > 1) {
      const olcu = (en: number, boy: number) => `${Math.round(en * MM)} × ${Math.round(boy * MM)} mm`;
      farklar.push({
        tur: "sayfa",
        kategori: "sayfa",
        a: { metin: "", satir: "", kutu: { sayfa: p.no, x: 0, y: 0, en: p.en, boy: p.boy } },
        b: { metin: "", satir: "", kutu: { sayfa: q.no, x: 0, y: 0, en: q.en, boy: q.boy } },
        ayrinti: `${p.no}. sayfanın boyutu farklı: ${olcu(p.en, p.boy)} → ${olcu(q.en, q.boy)}`,
        onem: onemBelirle(sec.mod, "sayfa", "sayfa"),
      });
    }
  }
  return farklar;
}

type Cift = readonly [Parca, Parca];

/** Aynı kaymayı paylaşan komşu parçaları tek farkta toplar: "12 parça 5 mm aşağı kaydı". */
function yerlesimFarklari(ciftler: Cift[], sec: FarkSecenekleri, ad: { a: string; b: string }): Omit<Fark, "kimlik">[] {
  const farklar: Omit<Fark, "kimlik">[] = [];
  const tol = sec.konum_toleransi;
  const gruplar = new Map<string, Cift[]>();
  for (const cift of ciftler) {
    const [p, q] = cift;
    let anahtar: string;
    if (p.sayfa !== q.sayfa) anahtar = `s|${p.sayfa}|${q.sayfa}`;
    else {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) continue;
      anahtar = `k|${p.sayfa}|${Math.abs(dx) <= tol ? 0 : Math.round(dx)}|${Math.abs(dy) <= tol ? 0 : Math.round(dy)}`;
    }
    const liste = gruplar.get(anahtar);
    if (liste) liste.push(cift);
    else gruplar.set(anahtar, [cift]);
  }
  for (const [anahtar, grup] of gruplar) {
    const [tur, , ...gerisi] = anahtar.split("|");
    // Aynı kayma sayfanın uzak yerlerinde de görülebilir; arada 40 noktadan büyük boşluk varsa ayrı fark.
    grup.sort((x, y) => x[0].y - y[0].y);
    const kumeler: Cift[][] = [];
    for (const cift of grup) {
      const kume = kumeler[kumeler.length - 1];
      const son = kume?.[kume.length - 1];
      if (kume && son && cift[0].y - (son[0].y + son[0].boy) <= 40) kume.push(cift);
      else kumeler.push([cift]);
    }
    for (const kume of kumeler) {
      const as = kume.map((c) => c[0]);
      const bs = kume.map((c) => c[1]);
      const ortak = {
        tur: tur === "s" ? ("sayfa" as const) : ("kaydi" as const),
        a: { metin: ornekMetin(as), satir: as[0]!.satir, kutu: birlesikKutu(as) },
        b: { metin: ornekMetin(bs), satir: bs[0]!.satir, kutu: birlesikKutu(bs) },
        adet: kume.length,
      };
      if (tur === "s") {
        farklar.push({
          ...ortak,
          kategori: "sayfa",
          ayrinti: `${kume.length} parça başka sayfada: ${ad.a} ${as[0]!.sayfa}. sayfa → ${ad.b} ${bs[0]!.sayfa}. sayfa`,
          onem: onemBelirle(sec.mod, "sayfa", "sayfa"),
        });
      } else {
        const dx = Number(gerisi[0]);
        const dy = Number(gerisi[1]);
        const yonler: string[] = [];
        if (dy) yonler.push(`${mm(dy)} mm ${dy > 0 ? "aşağı" : "yukarı"}`);
        if (dx) yonler.push(`${mm(dx)} mm ${dx > 0 ? "sağa" : "sola"}`);
        farklar.push({
          ...ortak,
          kategori: "yerlesim",
          ayrinti: `${kume.length} parça ${yonler.join(", ")} kaymış: ${ornekMetin(as)}`,
          onem: onemBelirle(sec.mod, "yerlesim", "kaydi", "", Math.max(Math.abs(dx), Math.abs(dy))),
        });
      }
    }
  }
  return farklar;
}

/** Aynı metnin puntosu ya da genişliği (yazı tipi) farklıysa. Sayfa başına ve değişim başına tek fark. */
function bicimFarklari(ciftler: Cift[], sec: FarkSecenekleri): Omit<Fark, "kimlik">[] {
  const farklar: Omit<Fark, "kimlik">[] = [];
  const punto = new Map<string, Cift[]>();
  const genislik = new Map<number, Cift[]>();
  const ekle = <K>(harita: Map<K, Cift[]>, anahtar: K, cift: Cift) => {
    const liste = harita.get(anahtar);
    if (liste) liste.push(cift);
    else harita.set(anahtar, [cift]);
  };
  for (const cift of ciftler) {
    const [p, q] = cift;
    if (Math.abs(p.punto - q.punto) > sec.punto_toleransi) ekle(punto, `${p.sayfa}|${p.punto}|${q.punto}`, cift);
    else if (!sec.yalniz_yapi && p.metin.length >= 4 && Math.abs(p.en - q.en) / Math.max(p.en, q.en) > 0.04) ekle(genislik, p.sayfa, cift);
  }
  const ortak = (grup: Cift[]) => {
    const as = grup.map((c) => c[0]);
    const bs = grup.map((c) => c[1]);
    return {
      tur: "bicim" as const,
      kategori: "bicim" as const,
      a: { metin: ornekMetin(as), satir: as[0]!.satir, kutu: birlesikKutu(as) },
      b: { metin: ornekMetin(bs), satir: bs[0]!.satir, kutu: birlesikKutu(bs) },
      adet: grup.length,
    };
  };
  for (const [anahtar, grup] of punto) {
    const [, eski, yeni] = anahtar.split("|");
    farklar.push({ ...ortak(grup), ayrinti: `${grup.length} parçanın puntosu farklı (${eski} → ${yeni}): ${ornekMetin(grup.map((c) => c[0]))}`, onem: onemBelirle(sec.mod, "bicim", "bicim") });
  }
  for (const grup of genislik.values()) {
    farklar.push({
      ...ortak(grup),
      ayrinti: `${grup.length} parçada metin aynı ama genişliği farklı; yazı tipi ya da harf aralığı değişmiş olabilir`,
      onem: sec.mod === "sablon" ? "dusuk" : "bilgi",
    });
  }
  return farklar;
}

/**
 * Arayüzün sayfa görüntülerinden çıkardığı bölgelerden yalnızca metinle açıklanamayanlar farktır
 * (logo, çizgi, kutu, renk). Metnin üstüne düşen bölgeleri zaten metin karşılaştırması anlatır.
 */
function gorselFarklar(a: Belge, b: Belge, bolgeler: GorselBolge[], mod: Mod): Omit<Fark, "kimlik">[] {
  const farklar: Omit<Fark, "kimlik">[] = [];
  const kesisim = (p: Kutu, q: Kutu) => Math.max(0, Math.min(p.x + p.en, q.x + q.en) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.boy, q.y + q.boy) - Math.max(p.y, q.y));
  const adaylar = bolgeler
    .filter((r) => Number.isFinite(r.x + r.y + r.en + r.boy + r.sayfa) && r.en > 0 && r.boy > 0)
    .filter((r) => {
      const metinler = [...a.parcalar, ...b.parcalar].filter((p) => p.sayfa === r.sayfa);
      let ortusen = 0;
      for (const p of metinler) ortusen += kesisim(r, { sayfa: p.sayfa, x: p.x - 2, y: p.y - 2, en: p.en + 4, boy: p.boy + 4 });
      return ortusen / (r.en * r.boy) < 0.3;
    })
    .sort((p, q) => q.en * q.boy * q.siddet - p.en * p.boy * p.siddet)
    .slice(0, 40);
  for (const r of adaylar) {
    const kutu = { sayfa: r.sayfa, x: r.x, y: r.y, en: r.en, boy: r.boy };
    farklar.push({
      tur: "gorsel",
      kategori: "gorsel",
      a: { metin: "", satir: "", kutu },
      b: { metin: "", satir: "", kutu },
      ayrinti: `Metin dışı görsel fark (logo, çizgi, kutu ya da renk); ${Math.round(r.en * MM)} × ${Math.round(r.boy * MM)} mm bölge`,
      onem: onemBelirle(mod, "gorsel", "gorsel"),
    });
  }
  return farklar;
}
