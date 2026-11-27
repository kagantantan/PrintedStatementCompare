import { useEffect, useRef, useState } from "react";
import type { Ayar, AyarKaydi, AyarYaniti, BaslikTuru, SinamaSonucu } from "../../sunucu/src/tipler";
import { api } from "./api";

interface Ozellikler {
  ilk: AyarYaniti;
  kapat(): void;
  kaydedildi(yeni: AyarYaniti): void;
}

const BASLIKLAR: { deger: BaslikTuru; ad: string }[] = [
  { deger: "bearer", ad: "Authorization: Bearer <anahtar>" },
  { deger: "api-key", ad: "api-key: <anahtar>" },
  { deger: "x-api-key", ad: "x-api-key: <anahtar>" },
  { deger: "yok", ad: "Anahtar gönderme" },
];

const KAYNAK_ADI = { ortam: "EKSTRE_LLM_ANAHTAR ortam değişkeninden", dosya: "bu bilgisayarda, ayar klasöründe kayıtlı", bellek: "yalnızca bu oturum için bellekte" };

export function Ayarlar({ ilk, kapat, kaydedildi }: Ozellikler) {
  const pencere = useRef<HTMLDialogElement>(null);
  const [ayar, setAyar] = useState<Ayar>(ilk.ayar);
  const [anahtar, setAnahtar] = useState("");
  const [ekGovde, setEkGovde] = useState(Object.keys(ilk.ayar.llm.ek_govde).length ? JSON.stringify(ilk.ayar.llm.ek_govde) : "");
  const [kalici, setKalici] = useState(ilk.anahtar.kaynak === "dosya");
  const [sil, setSil] = useState(false);
  const [modeller, setModeller] = useState<string[]>([]);
  const [sinama, setSinama] = useState<SinamaSonucu | null>(null);
  const [mesgul, setMesgul] = useState<"" | "sina" | "kaydet">("");
  const [hata, setHata] = useState("");

  useEffect(() => {
    pencere.current?.showModal();
  }, []);

  const llm = <K extends keyof Ayar["llm"]>(alan: K, deger: Ayar["llm"][K]) => setAyar((a) => ({ ...a, llm: { ...a.llm, [alan]: deger } }));
  const kars = <K extends keyof Ayar["karsilastirma"]>(alan: K, deger: Ayar["karsilastirma"][K]) => setAyar((a) => ({ ...a, karsilastirma: { ...a.karsilastirma, [alan]: deger } }));

  const kayit = (): AyarKaydi => {
    let govde: unknown = {};
    if (ekGovde.trim()) {
      try {
        govde = JSON.parse(ekGovde);
      } catch {
        throw new Error('İstek gövdesine ek geçerli bir JSON değil. Örnek: {"reasoning_effort": "none"}');
      }
    }
    // Biçimi sunucu doğrular (nesne mi, yasak alan var mı).
    return { ayar: { ...ayar, llm: { ...ayar.llm, ek_govde: govde as Record<string, unknown> } }, anahtar: sil ? { sil: true } : anahtar.trim() ? { deger: anahtar.trim(), kalici } : undefined };
  };

  const sina = async () => {
    setMesgul("sina");
    setHata("");
    setSinama(null);
    try {
      const sonuc = await api.ayarSina(kayit());
      setSinama(sonuc);
      setModeller(sonuc.modeller);
      if (!ayar.llm.model && sonuc.modeller.length === 1) llm("model", sonuc.modeller[0]!);
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setMesgul("");
    }
  };

  const kaydet = async () => {
    setMesgul("kaydet");
    setHata("");
    try {
      kaydedildi(await api.ayarKaydet(kayit()));
    } catch (e) {
      setHata((e as Error).message);
      setMesgul("");
    }
  };

  const ortamdan = ilk.anahtar.kaynak === "ortam";
  // Model yazılmadan sınandıysa ve liste geldiyse bu bir hata değil, yarım kalmış bir adımdır.
  const modelSecilmeli = Boolean(sinama && !sinama.tamam && sinama.adimlar.some((a) => a.ad === "Model listesi" && a.tamam) && sinama.adimlar.some((a) => a.ad === "Sohbet" && a.ayrinti.startsWith("Model adı boş")));

  return (
    <dialog className="ayarlar" ref={pencere} onClose={kapat} aria-labelledby="ayar-baslik">
      <form
        className="ayar-form"
        onSubmit={(e) => {
          e.preventDefault();
          void kaydet();
        }}
      >
        <div className="ayar-bas">
          <h2 id="ayar-baslik">Ayarlar</h2>
          <button type="button" className="dugme sade" onClick={kapat}>
            Kapat
          </button>
        </div>

        <div className="ayar-govde">
          <h3>Kurum içi LLM</h3>
          <p style={{ color: "var(--soluk)", fontSize: 13 }}>
            OpenAI uyumlu (<span className="kod">/v1/chat/completions</span>) bir servis gerekir. Tanımlamazsanız uygulama yine çalışır; farkları makine bulur, yalnızca yorum ve gruplama olmaz.
          </p>

          <div className="alan">
            <label htmlFor="adres">Servis adresi</label>
            <input id="adres" type="text" inputMode="url" value={ayar.llm.adres} onChange={(e) => llm("adres", e.target.value)} placeholder="http://llm.kurum.local/v1" spellCheck={false} autoComplete="off" />
            <div className="yardim">
              Taban adres; genellikle <span className="kod">/v1</span> ile biter. Bu bilgisayardaki Ollama için{" "}
              <button type="button" className="dugme sade" style={{ height: "auto", padding: 0, textDecoration: "underline" }} onClick={() => llm("adres", "http://127.0.0.1:11434/v1")}>
                http://127.0.0.1:11434/v1
              </button>
            </div>
          </div>

          <div className="alan">
            <label htmlFor="model">Model</label>
            <input id="model" type="text" list="model-listesi" value={ayar.llm.model} onChange={(e) => llm("model", e.target.value)} placeholder="ör. qwen3:8b" spellCheck={false} autoComplete="off" />
            <datalist id="model-listesi">
              {modeller.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div className="yardim">
              {modeller.length ? `Serviste ${modeller.length} model var; kutuya tıklayıp seçebilirsiniz.` : "\"Bağlantıyı sına\" servisin model listesini getirir."}
            </div>
          </div>

          <div className="alan">
            <label htmlFor="baslik">Anahtar nasıl gönderilsin?</label>
            <select id="baslik" value={ayar.llm.baslik} onChange={(e) => llm("baslik", e.target.value as BaslikTuru)}>
              {BASLIKLAR.map((b) => (
                <option key={b.deger} value={b.deger}>
                  {b.ad}
                </option>
              ))}
            </select>
            <div className="yardim">Servisi yöneten ekip hangi başlığı beklediğini söyler. Emin değilseniz ilkini deneyin; 401 ya da 403 alırsanız diğerlerini.</div>
          </div>

          {ayar.llm.baslik !== "yok" && (
            <div className="alan">
              <label htmlFor="anahtar">API anahtarı</label>
              <input
                id="anahtar"
                type="password"
                value={anahtar}
                onChange={(e) => {
                  setAnahtar(e.target.value);
                  setSil(false);
                }}
                placeholder={ilk.anahtar.var && !sil ? "Kayıtlı anahtar duruyor; değiştirmek için yenisini yazın" : "Anahtarı buraya yapıştırın"}
                autoComplete="off"
                disabled={ortamdan}
              />
              <div className="yardim">
                {sil ? "Kaydedince anahtar silinecek." : ilk.anahtar.var ? `Bir anahtar var: ${KAYNAK_ADI[ilk.anahtar.kaynak!]}.` : "Anahtar yok. Servis anahtar istemiyorsa boş bırakın."} Anahtar ayar dosyasına yazılmaz ve ekranda bir daha gösterilmez.
              </div>
              {!ortamdan && (
                <div className="radyo">
                  <label>
                    <input type="radio" name="saklama" checked={!kalici} onChange={() => setKalici(false)} />
                    Yalnızca bu oturum (uygulama kapanınca unutulur)
                  </label>
                  <label>
                    <input type="radio" name="saklama" checked={kalici} onChange={() => setKalici(true)} />
                    Bu bilgisayarda sakla
                  </label>
                </div>
              )}
              {ilk.anahtar.var && !ortamdan && !sil && (
                <button type="button" className="dugme sade" style={{ marginLeft: -8 }} onClick={() => (setSil(true), setAnahtar(""))}>
                  Kayıtlı anahtarı sil
                </button>
              )}
            </div>
          )}

          <label className="onay">
            <input type="checkbox" checked={ayar.llm.gorsel} onChange={(e) => llm("gorsel", e.target.checked)} />
            <span>
              Model görsel girdi kabul ediyor
              <div className="yardim">Açıksa farklarla birlikte ilk altı sayfanın görüntüsü de modele gider. Yalnızca görsel (vision) modellerde açın; "Bağlantıyı sına" bunu da dener.</div>
            </span>
          </label>

          <details>
            <summary>Gelişmiş LLM ayarları</summary>
            <div className="ic">
              <div className="uclu">
                <div className="alan">
                  <label htmlFor="sure">Zaman aşımı (sn)</label>
                  <input id="sure" type="number" min={10} max={1800} value={ayar.llm.sure_sn} onChange={(e) => llm("sure_sn", Number(e.target.value))} />
                </div>
                <div className="alan">
                  <label htmlFor="token">En fazla çıktı token'ı</label>
                  <input id="token" type="number" min={256} max={32768} step={256} value={ayar.llm.azami_token} onChange={(e) => llm("azami_token", Number(e.target.value))} />
                </div>
                <div className="alan">
                  <label htmlFor="sicaklik">Sıcaklık</label>
                  <input id="sicaklik" type="number" min={0} max={2} step={0.1} value={ayar.llm.sicaklik} onChange={(e) => llm("sicaklik", Number(e.target.value))} />
                </div>
              </div>
              <div className="alan">
                <label htmlFor="govde">İstek gövdesine ek (JSON)</label>
                <input id="govde" type="text" value={ekGovde} onChange={(e) => setEkGovde(e.target.value)} placeholder='ör. {"reasoning_effort": "none"}' spellCheck={false} autoComplete="off" />
                <div className="yardim">
                  Her isteğe eklenen alanlar. Qwen3 gibi düşünen modeller yanıttan önce uzun uzun düşünür; düşünmeyi kapatmak süreyi birkaç kat kısaltır. Alanın adı sunucuya göre değişir. Ollama için:{" "}
                  <button type="button" className="dugme sade" style={{ height: "auto", padding: 0, textDecoration: "underline" }} onClick={() => setEkGovde('{"reasoning_effort": "none"}')}>
                    {'{"reasoning_effort": "none"}'}
                  </button>
                </div>
              </div>
              <div className="alan">
                <label htmlFor="ek">Sistem istemine ek</label>
                <input id="ek" type="text" value={ayar.llm.ek_istem} onChange={(e) => llm("ek_istem", e.target.value)} placeholder="ör. /no_think" spellCheck={false} maxLength={500} />
                <div className="yardim">Sistem isteminin sonuna eklenir. Bazı sunucularda Qwen3'ün düşünmesini <span className="kod">/no_think</span> kapatır (Ollama'da kapatmaz).</div>
              </div>
            </div>
          </details>

          <h3>Karşılaştırma</h3>
          <div className="uclu">
            <div className="alan">
              <label htmlFor="konum">Konum toleransı (nokta)</label>
              <input id="konum" type="number" min={0} max={50} step={0.5} value={ayar.karsilastirma.konum_toleransi} onChange={(e) => kars("konum_toleransi", Number(e.target.value))} />
            </div>
            <div className="alan">
              <label htmlFor="punto">Punto toleransı</label>
              <input id="punto" type="number" min={0} max={10} step={0.1} value={ayar.karsilastirma.punto_toleransi} onChange={(e) => kars("punto_toleransi", Number(e.target.value))} />
            </div>
            <div className="alan">
              <label htmlFor="azami">LLM'e en fazla fark</label>
              <input id="azami" type="number" min={10} max={500} step={10} value={ayar.karsilastirma.llm_azami_fark} onChange={(e) => kars("llm_azami_fark", Number(e.target.value))} />
            </div>
          </div>
          <p className="alan">
            <span className="yardim">
              Aynı metin bu kadar noktadan az oynadıysa kayma sayılmaz (1 nokta ≈ 0,35 mm). İki sistem farklı çizim motoru kullanıyorsa ve her şey "kaymış" görünüyorsa toleransı artırın.
            </span>
          </p>
          <label className="onay">
            <input type="checkbox" checked={ayar.karsilastirma.maskele} onChange={(e) => kars("maskele", e.target.checked)} />
            <span>
              LLM'e giden metinde uzun numaraları maskele
              <div className="yardim">Kart, hesap, kimlik ve IBAN gibi 10 haneden uzun rakam dizilerinin yalnızca son dört hanesi gider. Tutarlar ve tarihler maskelenmez.</div>
            </span>
          </label>

          {sinama && (
            <div className="sinama" role="status">
              {sinama.tamam ? (
                <strong className="tamam">Bağlantı çalışıyor.</strong>
              ) : modelSecilmeli ? (
                <strong>Servise ulaşıldı. Modeli seçip yeniden sınayın.</strong>
              ) : (
                <strong className="olmadi">Bağlantıda sorun var.</strong>
              )}
              {sinama.adimlar.map((adim) => (
                <div className="adim" key={adim.ad}>
                  <span className={adim.tamam ? "tamam" : "olmadi"} aria-hidden="true">
                    {adim.tamam ? "✓" : "✕"}
                  </span>
                  <span>
                    <strong>{adim.ad}</strong>
                    <div className="ayrinti">{adim.ayrinti}</div>
                  </span>
                </div>
              ))}
            </div>
          )}
          {hata && (
            <div className="hata" role="alert">
              {hata}
            </div>
          )}

          <p className="yardim" style={{ color: "var(--soluk)", fontSize: 12.5 }}>
            Ayarlar şurada durur: <span className="kod">{ilk.klasor}</span> · Sürüm {ilk.surum}
          </p>
        </div>

        <div className="ayar-alt">
          <button type="button" className="dugme" onClick={sina} disabled={mesgul !== "" || !ayar.llm.adres.trim()}>
            {mesgul === "sina" ? "Sınanıyor…" : "Bağlantıyı sına"}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="dugme" onClick={kapat}>
            Vazgeç
          </button>
          <button type="submit" className="dugme ana" disabled={mesgul !== ""}>
            {mesgul === "kaydet" ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
