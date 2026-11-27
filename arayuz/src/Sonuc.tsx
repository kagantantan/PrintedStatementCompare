import { useEffect, useMemo, useRef, useState } from "react";
import type { Bulgu, Fark, Kutu, Onem } from "../../sunucu/src/tipler";
import { KATEGORI_ADI, MODLAR, ONEM_ADI, ONEMLER } from "./adlar";
import type { Karsilastirma } from "./App";
import type { YukluBelge } from "./belge";
import { raporIndir } from "./rapor";

interface SayfaKutusu {
  fark: Fark;
  bulgu: Bulgu;
  kutu: Kutu;
}

export function Sonuc({ rapor, a, b, sayfaFarklari, geri }: Karsilastirma & { geri(): void }) {
  const tanim = MODLAR[rapor.mod];
  const [secili, setSecili] = useState<string | null>(null);
  const [acik, setAcik] = useState<Set<Onem>>(new Set(ONEMLER));
  const [kutular, setKutular] = useState(true);
  const [piksel, setPiksel] = useState(false);
  const [yakinlik, setYakinlik] = useState(100);
  const sayfalarRef = useRef<HTMLDivElement>(null);

  const farklar = useMemo(() => new Map(rapor.farklar.map((f) => [f.kimlik, f])), [rapor]);
  const gorunen = useMemo(() => rapor.bulgular.filter((x) => acik.has(x.onem)), [rapor, acik]);
  const sayilar = useMemo(() => {
    const s: Record<Onem, number> = { kritik: 0, orta: 0, dusuk: 0, bilgi: 0 };
    for (const x of rapor.bulgular) s[x.onem]++;
    return s;
  }, [rapor]);

  // Sayfa ve taraf başına çizilecek kutular
  const kutuHaritasi = useMemo(() => {
    const harita = new Map<string, SayfaKutusu[]>();
    for (const bulgu of gorunen) {
      for (const kimlik of bulgu.farklar) {
        const fark = farklar.get(kimlik);
        if (!fark || (fark.tur === "sayfa" && !fark.adet)) continue;
        for (const taraf of ["a", "b"] as const) {
          const kutu = fark[taraf]?.kutu;
          if (!kutu) continue;
          const anahtar = `${taraf}${kutu.sayfa}`;
          const liste = harita.get(anahtar);
          if (liste) liste.push({ fark, bulgu, kutu });
          else harita.set(anahtar, [{ fark, bulgu, kutu }]);
        }
      }
    }
    return harita;
  }, [gorunen, farklar]);

  const sec = (kimlik: string, kaydir: boolean) => {
    setSecili(kimlik);
    if (!kaydir) return;
    requestAnimationFrame(() => {
      sayfalarRef.current?.querySelector(`[data-bulgu="${kimlik}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  // Kutuya tıklanınca listedeki bulgu görünür olsun
  const listeRef = useRef<HTMLDivElement>(null);
  const kutudanSec = (kimlik: string) => {
    setSecili(kimlik);
    requestAnimationFrame(() => listeRef.current?.querySelector(`[data-kimlik="${kimlik}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const sayfaSayisi = Math.max(a.sayfalar.length, b.sayfalar.length);
  const pikselVar = sayfaFarklari.some((s) => s.katman);
  const kutuVar = rapor.farklar.some((f) => f.a?.kutu || f.b?.kutu);
  const llm = rapor.llm;

  return (
    <div className="sonuc">
      <div className={`hukum ${rapor.hukum.durum}`}>
        <div className="metin">
          <h2>{rapor.hukum.metin}</h2>
          <p className="ozet">{rapor.ozet}</p>
          {rapor.karsilanmayan.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Karşılanmayan istekler</strong>
              <ul>
                {rapor.karsilanmayan.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          )}
          {rapor.uyarilar.map((u, i) => (
            <p className="uyari" key={i}>
              {u}
            </p>
          ))}
          <div className="kunye">
            <span>
              {tanim.ad}
              {rapor.yalniz_yapi ? " (yalnızca şablon)" : ""}
            </span>
            <span>{rapor.farklar.length} ham fark</span>
            {llm.kullanildi ? (
              <span>
                Yorumlayan: {llm.model} · {((llm.sure_ms ?? 0) / 1000).toFixed(0)} sn{llm.gorsel ? " · sayfa görüntüleriyle" : ""}
              </span>
            ) : (
              <span>{llm.hata ?? "LLM kullanılmadı."}</span>
            )}
          </div>
        </div>
        <div className="eylem">
          <button className="dugme" onClick={() => raporIndir(rapor)}>
            Raporu indir
          </button>
          <button className="dugme ana" onClick={geri}>
            Yeni karşılaştırma
          </button>
        </div>
      </div>

      <div className="govde">
        <aside className="bulgular">
          <div className="suzgec" aria-label="Öneme göre süz">
            {ONEMLER.map((o) => (
              <button
                key={o}
                className={`cip ${o}`}
                aria-pressed={acik.has(o)}
                onClick={() => {
                  const yeni = new Set(acik);
                  if (yeni.has(o)) yeni.delete(o);
                  else yeni.add(o);
                  setAcik(yeni);
                }}
              >
                <span className="renk" />
                {ONEM_ADI[o]} {sayilar[o]}
              </button>
            ))}
          </div>
          <div className="bulgu-listesi" ref={listeRef}>
            {rapor.bulgular.length === 0 && <div className="bos">Fark bulunamadı.</div>}
            {rapor.bulgular.length > 0 && gorunen.length === 0 && <div className="bos">Seçili önemlerde bulgu yok.</div>}
            {gorunen.map((bulgu) => (
              <BulguKarti key={bulgu.kimlik} bulgu={bulgu} farklar={farklar} secili={secili === bulgu.kimlik} mod={rapor.mod} sec={() => sec(bulgu.kimlik, true)} />
            ))}
          </div>
        </aside>

        <section className="goruntuleyici">
          <div className="arac-cubugu">
            <div className="taraflar">
              <span className="taraf-adi a">
                <span className="kare" />
                {tanim.a}
                <span className="dosya">{a.ad}</span>
              </span>
              <span className="taraf-adi b">
                <span className="kare" />
                {tanim.b}
                <span className="dosya">{b.ad}</span>
              </span>
            </div>
            <label className={kutuVar ? "" : "kapali"} title={kutuVar ? "Bulunan farkları sayfa üzerinde kutuyla gösterir" : "Gösterilecek fark yok"}>
              <input type="checkbox" checked={kutular && kutuVar} disabled={!kutuVar} onChange={(e) => setKutular(e.target.checked)} />
              Fark kutuları{kutuVar ? "" : " (fark yok)"}
            </label>
            <label className={pikselVar ? "" : "kapali"} title={pikselVar ? "İki sayfanın görüntüsünde rengi farklı olan yerleri boyar" : "İki tarafın sayfa görüntüleri birebir aynı; boyanacak yer yok"}>
              <input type="checkbox" checked={piksel && pikselVar} disabled={!pikselVar} onChange={(e) => setPiksel(e.target.checked)} />
              Görüntü farkı{pikselVar ? "" : " (görüntüler aynı)"}
            </label>
            <span className="yakinlik">
              <button onClick={() => setYakinlik((y) => Math.max(50, y - 25))} aria-label="Uzaklaştır">
                −
              </button>
              <span>%{yakinlik}</span>
              <button onClick={() => setYakinlik((y) => Math.min(300, y + 25))} aria-label="Yakınlaştır">
                +
              </button>
            </span>
          </div>
          <div className="sayfalar" ref={sayfalarRef}>
            {Array.from({ length: sayfaSayisi }, (_, i) => i + 1).map((no) => {
              const katman = piksel ? (sayfaFarklari.find((s) => s.no === no)?.katman ?? null) : null;
              const oran = sayfaFarklari.find((s) => s.no === no)?.oran;
              return (
                <div className="sayfa-cifti" key={no} style={{ width: `${yakinlik}%` }}>
                  {(["a", "b"] as const).map((taraf) => (
                    <SayfaGorunumu
                      key={taraf}
                      taraf={taraf}
                      belge={taraf === "a" ? a : b}
                      diger={taraf === "a" ? b : a}
                      no={no}
                      kutular={kutular ? (kutuHaritasi.get(`${taraf}${no}`) ?? []) : []}
                      katman={katman}
                      secili={secili}
                      sec={kutudanSec}
                      bilgi={taraf === "b" && oran !== undefined ? (oran === 0 ? "görüntü aynı" : `görüntünün %${(oran * 100).toLocaleString("tr-TR", { maximumFractionDigits: oran < 0.01 ? 2 : 1 })} kadarı farklı`) : ""}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

interface KartOzellikleri {
  bulgu: Bulgu;
  farklar: Map<string, Fark>;
  secili: boolean;
  mod: "donusum" | "sablon";
  sec(): void;
}

function BulguKarti({ bulgu, farklar, secili, mod, sec }: KartOzellikleri) {
  const dayanak = bulgu.farklar.map((k) => farklar.get(k)).filter((f): f is Fark => Boolean(f));
  const sayfalar = [...new Set(dayanak.flatMap((f) => [f.a?.kutu.sayfa, f.b?.kutu.sayfa]).filter((s): s is number => typeof s === "number"))].sort((x, y) => x - y);
  return (
    <div
      className={`bulgu ${bulgu.onem}${secili ? " secili" : ""}`}
      data-kimlik={bulgu.kimlik}
      role="button"
      tabIndex={0}
      aria-pressed={secili}
      onClick={sec}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          sec();
        }
      }}
    >
      <div className="ust">
        <span className="onem">{ONEM_ADI[bulgu.onem]}</span>
        <span className="baslik">{bulgu.baslik}</span>
      </div>
      {bulgu.aciklama && <div className="aciklama">{bulgu.aciklama}</div>}
      <div className="etiketler">
        <span className="etiket-kucuk">{KATEGORI_ADI[bulgu.kategori]}</span>
        {sayfalar.length > 0 && <span className="etiket-kucuk">s. {sayfalar.join(", ")}</span>}
        <span className="etiket-kucuk" title={bulgu.kaynak === "llm" ? "Bu bulguyu LLM yazdı; dayandığı farkları makine buldu" : "Bu bulgu kuralla üretildi"}>
          {bulgu.kaynak === "llm" ? "LLM yorumu" : "Makine"}
        </span>
        {bulgu.beklenen === true && <span className="etiket-kucuk iyi">{mod === "donusum" ? "Bilinen fark" : "İstenen"}</span>}
        {bulgu.beklenen === false && mod === "sablon" && <span className="etiket-kucuk kotu">İstenmemiş</span>}
        {bulgu.farklar.length === 0 && (
          <span className="etiket-kucuk kotu" title="LLM bu gözlemi makinenin bulduğu bir farka dayandırmadı; doğrulamadan güvenmeyin">
            Kanıtsız
          </span>
        )}
      </div>
      {/* LLM'in yazdığı bulgularda makinenin bulduğu ham fark her zaman görünür: yorum ile kanıt yan yana durur. */}
      {(secili || bulgu.kaynak === "llm") && dayanak.length > 0 && (
        <ul className="ham">
          {(secili ? dayanak : dayanak.slice(0, 2)).map((f) => (
            <li key={f.kimlik}>
              <span className="kimlik">{f.kimlik}</span>
              {f.tur === "degisti" && f.a && f.b ? (
                <>
                  <span className="deger a">{f.a.metin}</span> → <span className="deger b">{f.b.metin}</span>
                </>
              ) : f.tur === "eksik" && f.a ? (
                <>
                  <span className="deger a">{f.a.metin}</span> {f.ayrinti.toLocaleLowerCase("tr")}
                </>
              ) : f.tur === "fazla" && f.b ? (
                <>
                  <span className="deger b">{f.b.metin}</span> {f.ayrinti.toLocaleLowerCase("tr")}
                </>
              ) : (
                f.ayrinti
              )}
            </li>
          ))}
          {!secili && dayanak.length > 2 && <li style={{ color: "var(--soluk)" }}>ve {dayanak.length - 2} fark daha</li>}
        </ul>
      )}
    </div>
  );
}

interface SayfaOzellikleri {
  taraf: "a" | "b";
  belge: YukluBelge;
  diger: YukluBelge;
  no: number;
  kutular: SayfaKutusu[];
  katman: string | null;
  secili: string | null;
  bilgi: string;
  sec(bulgu: string): void;
}

function SayfaGorunumu({ taraf, belge, diger, no, kutular, katman, secili, bilgi, sec }: SayfaOzellikleri) {
  const sayfa = belge.sayfalar[no - 1];
  const olcu = sayfa ?? diger.sayfalar[no - 1] ?? { en: 595, boy: 842 };
  const kap = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sayfa || !kap.current) return;
    let canli = true;
    let adres: string | null = null;
    const gozcu = new IntersectionObserver(
      (girdiler) => {
        if (!girdiler.some((g) => g.isIntersecting)) return;
        gozcu.disconnect();
        belge
          .ciz(no, 1.5 * Math.min(2, window.devicePixelRatio || 1))
          .then((tuval) => new Promise<Blob | null>((tamam) => tuval.toBlob(tamam, "image/png")))
          .then((blob) => {
            if (!blob || !canli) return;
            adres = URL.createObjectURL(blob);
            setUrl(adres);
          })
          .catch(() => undefined);
      },
      { rootMargin: "800px" },
    );
    gozcu.observe(kap.current);
    return () => {
      canli = false;
      gozcu.disconnect();
      if (adres) URL.revokeObjectURL(adres);
    };
  }, [belge, no, sayfa]);

  const yuzde = (deger: number, tam: number) => `${(deger / tam) * 100}%`;
  return (
    <div className="sayfa-kabi">
      <div className="sayfa-ust">
        <span>Sayfa {no}</span>
        <span>{bilgi}</span>
      </div>
      <div ref={kap} className={`sayfa ${taraf}${sayfa ? "" : " yok"}`} style={{ aspectRatio: `${olcu.en} / ${olcu.boy}` }}>
        {!sayfa && <span>Bu tarafta {no}. sayfa yok</span>}
        {sayfa && url && <img src={url} alt={`${belge.ad}, sayfa ${no}`} draggable={false} />}
        {sayfa && katman && <img className="katman" src={katman} alt="" />}
        {sayfa &&
          kutular.map(({ fark, bulgu, kutu }) => {
            const pay = 1.5;
            return (
              <button
                key={`${fark.kimlik}`}
                type="button"
                data-bulgu={bulgu.kimlik}
                className={`kutu ${bulgu.onem}${fark.adet && fark.adet > 1 ? " grup" : ""}${secili === bulgu.kimlik ? " secili" : secili ? " soluk" : ""}`}
                style={{
                  left: yuzde(kutu.x - pay, sayfa.en),
                  top: yuzde(kutu.y - pay, sayfa.boy),
                  width: yuzde(kutu.en + 2 * pay, sayfa.en),
                  height: yuzde(kutu.boy + 2 * pay, sayfa.boy),
                }}
                title={`${bulgu.baslik}\n${fark.ayrinti}`}
                aria-label={bulgu.baslik}
                onClick={() => sec(bulgu.kimlik)}
              />
            );
          })}
      </div>
    </div>
  );
}
