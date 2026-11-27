import { useEffect, useRef, useState, type DragEvent } from "react";
import type { AyarYaniti, Mod } from "../../sunucu/src/tipler";
import { boyutYaz, MODLAR } from "./adlar";
import { api, type OrnekBilgisi } from "./api";
import type { Karsilastirma } from "./App";
import { belgeAc, gorselFark, sayfaGoruntuleri, type YukluBelge } from "./belge";

interface Ozellikler {
  ayar: AyarYaniti;
  llmHazir: boolean;
  ayarAc(): void;
  sonucGeldi(sonuc: Karsilastirma): void;
}

export function Giris({ ayar, llmHazir, ayarAc, sonucGeldi }: Ozellikler) {
  const [mod, setMod] = useState<Mod>("donusum");
  const [a, setA] = useState<YukluBelge | null>(null);
  const [b, setB] = useState<YukluBelge | null>(null);
  const [not, setNot] = useState("");
  const [yalnizYapi, setYalnizYapi] = useState(false);
  const [llmKullan, setLlmKullan] = useState(true);
  const [adim, setAdim] = useState("");
  const [sure, setSure] = useState(0);
  const [hata, setHata] = useState("");
  const [ornekler, setOrnekler] = useState<OrnekBilgisi[]>([]);
  const iptal = useRef<AbortController | null>(null);
  const tanim = MODLAR[mod];
  const calisiyor = adim !== "";

  useEffect(() => {
    api.ornekler().then(setOrnekler, () => setOrnekler([]));
  }, []);

  useEffect(() => {
    if (!calisiyor) return;
    const basla = Date.now();
    setSure(0);
    const sayac = setInterval(() => setSure(Math.round((Date.now() - basla) / 1000)), 1000);
    return () => clearInterval(sayac);
  }, [calisiyor]);

  const dosyaSec = async (taraf: "a" | "b", dosya: File | undefined) => {
    if (!dosya) return;
    setHata("");
    try {
      const belge = await belgeAc(dosya);
      if (taraf === "a") {
        a?.kapat();
        setA(belge);
      } else {
        b?.kapat();
        setB(belge);
      }
    } catch (e) {
      setHata((e as Error).message);
    }
  };

  const ornekYukle = async (ornek: OrnekBilgisi) => {
    setHata("");
    try {
      const [da, db] = await Promise.all([api.ornekDosyasi(ornek.a), api.ornekDosyasi(ornek.b)]);
      const [ba, bb] = await Promise.all([belgeAc(da), belgeAc(db)]);
      a?.kapat();
      b?.kapat();
      setMod(ornek.mod);
      setA(ba);
      setB(bb);
      setNot(ornek.not);
      setYalnizYapi(false);
    } catch (e) {
      setHata((e as Error).message);
    }
  };

  const calistir = async () => {
    if (!a || !b) return;
    setHata("");
    const denetci = new AbortController();
    iptal.current = denetci;
    const llm = llmHazir && llmKullan;
    try {
      setAdim("Sayfa görüntüleri karşılaştırılıyor");
      const sayfaFarklari = await gorselFark(a, b, (s, t) => setAdim(`Sayfa görüntüleri karşılaştırılıyor (${s}/${t})`));
      if (denetci.signal.aborted) return;
      let goruntuler: { a: string[]; b: string[] } | undefined;
      if (llm && ayar.ayar.llm.gorsel) {
        setAdim("Sayfa görüntüleri LLM için hazırlanıyor");
        goruntuler = { a: await sayfaGoruntuleri(a), b: await sayfaGoruntuleri(b) };
      }
      setAdim(llm ? `Metin karşılaştırılıyor; ${ayar.ayar.llm.model} farkları yorumluyor` : "Metin karşılaştırılıyor");
      const rapor = await api.karsilastir(
        {
          mod,
          a: await a.girdi(),
          b: await b.girdi(),
          not,
          yalniz_yapi: mod === "sablon" && yalnizYapi,
          llm,
          gorsel_bolgeler: sayfaFarklari.flatMap((s) => s.bolgeler),
          goruntuler,
        },
        denetci.signal,
      );
      sonucGeldi({ rapor, a, b, sayfaFarklari });
    } catch (e) {
      if (!denetci.signal.aborted) setHata((e as Error).message);
    } finally {
      setAdim("");
      iptal.current = null;
    }
  };

  return (
    <div className="giris-ic">
      <div>
        <h1>İki ekstreyi karşılaştır</h1>
        <p className="alt">
          İki PDF'i verin; metin, tutar, tarih, yerleşim ve görsel farklar sayfa üzerinde işaretlenir. Kurum içi LLM farkları yorumlar ve önem sırasına koyar.
        </p>
      </div>

      <section>
        <div className="adim-baslik">1. Ne yapmak istiyorsunuz?</div>
        <div className="modlar" role="radiogroup" aria-label="Karşılaştırma modu">
          {(Object.keys(MODLAR) as Mod[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mod === m} className="mod" onClick={() => setMod(m)} disabled={calisiyor}>
              <ModSimgesi mod={m} />
              <span>
                <span className="mod-ad">{MODLAR[m].ad}</span>
                <div className="mod-soru">{MODLAR[m].soru}</div>
                <div className="mod-aciklama">{MODLAR[m].aciklama}</div>
              </span>
              <span className="isaret" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="adim-baslik">2. Dosyaları verin (PDF; taranmış ekstre için PNG ya da JPG de olur)</div>
        <div className="dosyalar">
          <Birak taraf="a" ad={tanim.a} ipucu={tanim.aIpucu} belge={a} sec={(d) => dosyaSec("a", d)} kaldir={() => (a?.kapat(), setA(null))} kilitli={calisiyor} />
          <Birak taraf="b" ad={tanim.b} ipucu={tanim.bIpucu} belge={b} sec={(d) => dosyaSec("b", d)} kaldir={() => (b?.kapat(), setB(null))} kilitli={calisiyor} />
        </div>
        {ornekler.length > 0 && (
          <div className="ornekler" style={{ marginTop: 10 }}>
            Elinizde dosya yoksa uydurma örneklerle deneyin:
            {ornekler.map((o) => (
              <button key={o.kimlik} type="button" className="dugme sade" title={o.aciklama} onClick={() => ornekYukle(o)} disabled={calisiyor}>
                {o.ad}
              </button>
            ))}
          </div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="adim-baslik" style={{ marginBottom: 0 }}>
          3. Ek bilgi
        </div>
        <div className="alan">
          <label htmlFor="not">{tanim.notEtiketi}</label>
          <textarea id="not" value={not} onChange={(e) => setNot(e.target.value)} placeholder={tanim.notOrnegi} disabled={calisiyor} maxLength={4000} />
          <div className="yardim">{tanim.notYardimi}</div>
        </div>
        {mod === "sablon" && (
          <label className="onay">
            <input type="checkbox" checked={yalnizYapi} onChange={(e) => setYalnizYapi(e.target.checked)} disabled={calisiyor} />
            <span>
              İki dosyadaki müşteri verileri farklı; yalnızca şablonu karşılaştır
              <div className="yardim">Rakamlar ve tarihler karşılaştırılmaz; başlık, etiket, bölüm ve yerleşim farklarına bakılır. Sonuç yaklaşıktır.</div>
            </span>
          </label>
        )}
        {llmHazir ? (
          <label className="onay">
            <input type="checkbox" checked={llmKullan} onChange={(e) => setLlmKullan(e.target.checked)} disabled={calisiyor} />
            <span>
              Farkları LLM yorumlasın ({ayar.ayar.llm.model})
              <div className="yardim">
                LLM'e yalnızca bulunan farkların metni gider{ayar.ayar.karsilastirma.maskele ? "; kart ve hesap numaraları maskelenir" : ""}
                {ayar.ayar.llm.gorsel ? "; görsel girdi açık olduğu için ilk altı sayfanın görüntüsü de gider" : ""}. Kapatırsanız yalnızca makine farkları çıkar.
              </div>
            </span>
          </label>
        ) : (
          <div className="not-kutusu">
            LLM tanımlanmamış: karşılaştırma yine çalışır, ama farklar yorumlanmaz ve nota bakılmaz.{" "}
            <button type="button" className="dugme sade" onClick={ayarAc} style={{ height: "auto", padding: 0, textDecoration: "underline" }}>
              Kurum LLM'ini tanımla
            </button>
          </div>
        )}
      </section>

      {hata && (
        <div className="hata" role="alert">
          {hata}
        </div>
      )}

      <div className="calistir">
        <button type="button" className="dugme ana buyuk" onClick={calistir} disabled={!a || !b || calisiyor}>
          Karşılaştır
        </button>
        {calisiyor && (
          <>
            <span className="ilerleme" role="status">
              <span className="cark" aria-hidden="true" />
              {adim} · {sure} sn
            </span>
            <button type="button" className="dugme" onClick={() => iptal.current?.abort()}>
              Vazgeç
            </button>
          </>
        )}
        {!calisiyor && (!a || !b) && <span style={{ color: "var(--soluk)" }}>İki dosyayı da verin.</span>}
      </div>

      <p className="not-kutusu">
        Dosyalar bu bilgisayarda işlenir ve hiçbir yere kaydedilmez. Dışarıya giden tek şey, ayarlarda tanımladığınız LLM'e gönderilen fark metinleridir.
      </p>
    </div>
  );
}

function ModSimgesi({ mod }: { mod: Mod }) {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" style={{ flex: "none" }}>
      {mod === "donusum" ? (
        <>
          <rect x="3" y="8" width="16" height="22" rx="2" fill="var(--a-zemin)" stroke="var(--a)" strokeWidth="1.5" />
          <rect x="25" y="8" width="16" height="22" rx="2" fill="var(--b-zemin)" stroke="var(--b)" strokeWidth="1.5" />
          <path d="M6 14h10M6 18h10M6 22h6M28 14h10M28 18h10M28 22h6" stroke="var(--soluk)" strokeWidth="1.2" />
          <path d="M17 37h10M20 34.5l-3 2.5 3 2.5M24 34.5l3 2.5-3 2.5" stroke="var(--murekkep)" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <rect x="6" y="5" width="22" height="30" rx="2" fill="var(--a-zemin)" stroke="var(--a)" strokeWidth="1.5" />
          <rect x="16" y="9" width="22" height="30" rx="2" fill="var(--b-zemin)" stroke="var(--b)" strokeWidth="1.5" />
          <path d="M20 15h14M20 19h8" stroke="var(--soluk)" strokeWidth="1.2" />
          <rect x="20" y="23" width="14" height="6" rx="1" fill="none" stroke="var(--b)" strokeWidth="1.3" strokeDasharray="2.5 2" />
          <path d="M20 33h10" stroke="var(--soluk)" strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}

interface BirakOzellikleri {
  taraf: "a" | "b";
  ad: string;
  ipucu: string;
  belge: YukluBelge | null;
  kilitli: boolean;
  sec(dosya: File | undefined): void;
  kaldir(): void;
}

function Birak({ taraf, ad, ipucu, belge, kilitli, sec, kaldir }: BirakOzellikleri) {
  const girdi = useRef<HTMLInputElement>(null);
  const [ustunde, setUstunde] = useState(false);
  const birakildi = (e: DragEvent) => {
    e.preventDefault();
    setUstunde(false);
    if (!kilitli) sec(e.dataTransfer.files[0]);
  };
  return (
    <div
      className={`birak ${taraf}${belge ? " dolu" : ""}${ustunde ? " ustunde" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setUstunde(true);
      }}
      onDragLeave={() => setUstunde(false)}
      onDrop={birakildi}
      onClick={() => !belge && !kilitli && girdi.current?.click()}
    >
      <input
        ref={girdi}
        type="file"
        accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        hidden
        aria-label={`${ad} dosyası`}
        onChange={(e) => {
          sec(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="taraf">{ad}</div>
      {belge ? (
        <>
          <div className="dosya-adi">{belge.ad}</div>
          <div className="dosya-bilgi">
            {belge.sayfalar.length} sayfa · {boyutYaz(belge.boyut)}
            {belge.tur === "resim" ? " · resim (metin katmanı yok)" : ""}
          </div>
          <div className="eylemler">
            <button type="button" className="dugme sade" onClick={() => girdi.current?.click()} disabled={kilitli}>
              Değiştir
            </button>
            <button type="button" className="dugme sade" onClick={kaldir} disabled={kilitli}>
              Kaldır
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="ipucu">{ipucu}</div>
          <div className="ipucu" style={{ marginTop: "auto" }}>
            Dosyayı buraya bırakın ya da tıklayıp seçin.
          </div>
        </>
      )}
    </div>
  );
}
