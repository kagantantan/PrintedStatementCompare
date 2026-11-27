import { useCallback, useEffect, useState } from "react";
import type { AyarYaniti, Rapor } from "../../sunucu/src/tipler";
import { api } from "./api";
import { Ayarlar } from "./Ayarlar";
import type { SayfaFarki, YukluBelge } from "./belge";
import { Giris } from "./Giris";
import { Sonuc } from "./Sonuc";

export interface Karsilastirma {
  rapor: Rapor;
  a: YukluBelge;
  b: YukluBelge;
  sayfaFarklari: SayfaFarki[];
}

export function App() {
  const [ayar, setAyar] = useState<AyarYaniti | null>(null);
  const [ayarHatasi, setAyarHatasi] = useState("");
  const [ayarAcik, setAyarAcik] = useState(false);
  const [sonuc, setSonuc] = useState<Karsilastirma | null>(null);

  const ayarYukle = useCallback(() => {
    api.ayar().then(setAyar, (e: Error) => setAyarHatasi(e.message));
  }, []);
  useEffect(ayarYukle, [ayarYukle]);

  const llmHazir = Boolean(ayar?.ayar.llm.adres && ayar.ayar.llm.model);

  return (
    <div className="uygulama">
      <header className="serit">
        <div className="marka">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="3" y="5" width="15" height="22" rx="2" fill="var(--a)" />
            <rect x="14" y="5" width="15" height="22" rx="2" fill="var(--b)" fillOpacity="0.9" />
          </svg>
          Ekstre Karşılaştır
        </div>
        <div className="bosluk" />
        {ayar && (
          <span className="llm-durum" title={llmHazir ? ayar.ayar.llm.adres : "LLM tanımlanmadı: yalnızca makine farkları çıkar"}>
            <span className={`nokta${llmHazir ? " acik" : ""}`} />
            {llmHazir ? `LLM: ${ayar.ayar.llm.model}` : "LLM ayarlanmamış"}
          </span>
        )}
        <button className="dugme" onClick={() => setAyarAcik(true)} disabled={!ayar}>
          Ayarlar
        </button>
      </header>

      {ayarHatasi && !ayar && (
        <div className="giris">
          <div className="giris-ic">
            <div className="hata">{ayarHatasi}</div>
          </div>
        </div>
      )}

      {ayar && (
        <>
          <div className="giris" hidden={sonuc !== null}>
            <Giris ayar={ayar} llmHazir={llmHazir} ayarAc={() => setAyarAcik(true)} sonucGeldi={setSonuc} />
          </div>
          {sonuc && <Sonuc {...sonuc} geri={() => setSonuc(null)} />}
          {ayarAcik && (
            <Ayarlar
              ilk={ayar}
              kapat={() => setAyarAcik(false)}
              kaydedildi={(yeni) => {
                setAyar(yeni);
                setAyarAcik(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
