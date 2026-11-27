// npm run duman  ->  uygulamayı gerçekten açar ve bir karşılaştırmayı uçtan uca (LLM'siz) dener.
// Birim testleri sunucuyu ağ üzerinden açmaz; bu betik açılışı, derlenmiş arayüzün sunumunu ve
// gerçek HTTP isteklerini sınar. Otomatik denetimde her işletim sisteminde koşar. Önce `npm run build` gerekir.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AyarDeposu } from "../sunucu/src/ayarlar.js";
import { servisAyariOku } from "../sunucu/src/servis.js";
import { sunucuKur } from "../sunucu/src/sunucu.js";
import type { AyarYaniti, IsYaniti, Rapor } from "../sunucu/src/tipler.js";

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.EKSTRE_DUMAN_PORT ?? 8799);
const taban = `http://127.0.0.1:${port}`;
const klasor = fs.mkdtempSync(path.join(os.tmpdir(), "ekstre-duman-"));
const adimlar: string[] = [];
const tamam = (adim: string) => {
  adimlar.push(adim);
  console.log(`  ✓ ${adim}`);
};

// Yalnızca bu koşu için üretilmiş, hiçbir yerde saklanmayan servis anahtarı.
const servisAnahtari = randomBytes(32).toString("base64url");
const servis = servisAyariOku({ EKSTRE_SERVIS_ANAHTARLARI: servisAnahtari }, "127.0.0.1", klasor);
const app = await sunucuKur({ kok, port, depo: new AyarDeposu(klasor), servis });
try {
  await app.listen({ host: "127.0.0.1", port });
  tamam(`sunucu açıldı (${process.platform}, Node ${process.version})`);

  const sayfa = await fetch(`${taban}/`);
  const html = await sayfa.text();
  assert.equal(sayfa.status, 200);
  assert.match(html, /<div id="kok">/, "derlenmiş arayüz sunulmuyor; önce `npm run build` çalıştırın");
  const betik = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  assert.ok(betik, "arayüz betiği bulunamadı");
  assert.equal((await fetch(`${taban}${betik}`)).status, 200);
  tamam("derlenmiş arayüz sunuluyor");

  const yaziTipleri = fs.readdirSync(path.join(kok, "node_modules", "pdfjs-dist", "standard_fonts")).filter((ad) => /\.(pfb|ttf)$/.test(ad));
  assert.ok(yaziTipleri.length > 0);
  assert.equal((await fetch(`${taban}/pdfjs/standard_fonts/${yaziTipleri[0]}`)).status, 200);
  assert.equal((await fetch(`${taban}/pdfjs/package.json`)).status, 404, "pdf.js klasörünün izinli olmayan dosyası sunuldu");
  tamam("pdf.js yardımcı dosyaları sunuluyor, gerisi kapalı");

  const ayar = (await (await fetch(`${taban}/api/ayar`)).json()) as AyarYaniti;
  assert.equal(ayar.anahtar.var, false);
  assert.equal(path.resolve(ayar.klasor), path.resolve(klasor));
  tamam("ayar API'si yanıt veriyor");

  const yabanci = await fetch(`${taban}/api/ayar`, { headers: { origin: "http://kotu.example" } });
  assert.equal(yabanci.status, 403);
  tamam("başka siteden gelen istek reddediliyor");

  const ornek = (ad: string) => ({ ad, pdf_base64: fs.readFileSync(path.join(kok, "ornekler", ad)).toString("base64") });
  const yanit = await fetch(`${taban}/api/karsilastir`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mod: "donusum", a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf") }),
  });
  assert.equal(yanit.status, 200);
  const rapor = (await yanit.json()) as Rapor;
  assert.equal(rapor.hukum.durum, "sorun");
  assert.equal(rapor.bulgular.filter((b) => b.onem === "kritik").length, 4);
  assert.equal(rapor.llm.kullanildi, false);
  tamam(`örnek ekstreler karşılaştırıldı: ${rapor.hukum.metin}`);

  const ayni = (await (
    await fetch(`${taban}/api/karsilastir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mod: "donusum", a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-eski.pdf") }),
    })
  ).json()) as Rapor;
  assert.equal(ayni.hukum.durum, "temiz");
  assert.deepEqual(fs.readdirSync(klasor), [], "karşılaştırma diske dosya yazdı");
  tamam("aynı dosyada fark yok; diske bir şey yazılmadı");

  // ---- Servis API'si: başka bir uygulamanın yapacağı gibi, anahtarla ve arayüzsüz
  const v1 = `${taban}/api/v1/karsilastirmalar`;
  const govde = JSON.stringify({ mod: "donusum", llm: false, a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf") });
  const anahtarsiz = await fetch(v1, { method: "POST", headers: { "content-type": "application/json" }, body: govde });
  assert.equal(anahtarsiz.status, 401);
  tamam("servis API'si anahtarsız isteği reddediyor");

  const yetki = { authorization: `Bearer ${servisAnahtari}` };
  const kabul = await fetch(v1, { method: "POST", headers: { "content-type": "application/json", ...yetki }, body: govde });
  assert.equal(kabul.status, 202);
  let is = (await kabul.json()) as IsYaniti;
  for (let deneme = 0; deneme < 300 && is.durum !== "bitti" && is.durum !== "hata"; deneme++) {
    await new Promise((bekle) => setTimeout(bekle, 100));
    is = (await (await fetch(`${v1}/${is.kimlik}`, { headers: yetki })).json()) as IsYaniti;
  }
  assert.equal(is.durum, "bitti", is.hata);
  assert.equal(is.rapor!.hukum.durum, "sorun");
  const gorsel = is.rapor!.farklar.filter((f) => f.tur === "gorsel").length;
  assert.ok(gorsel > 0, `sunucu görüntü farkı bulamadı: ${is.rapor!.uyarilar.join(" ")}`);
  tamam(`servis API'si işi tamamladı (${is.sure_ms} ms); sunucu ${gorsel} görüntü farkı buldu (eksik logo)`);

  assert.equal((await fetch(`${v1}/${is.kimlik}`, { method: "DELETE", headers: yetki })).status, 204);
  assert.equal((await fetch(`${v1}/${is.kimlik}`, { headers: yetki })).status, 404);
  assert.deepEqual(fs.readdirSync(klasor), []);
  tamam("iş silindi; diske bir şey yazılmadı");

  console.log(`\nDuman testi geçti: ${adimlar.length} adım.`);
} catch (hata) {
  console.error(`\nDuman testi başarısız (${adimlar.length} adım geçti):\n${(hata as Error).message}`);
  process.exitCode = 1;
} finally {
  await app.close();
  fs.rmSync(klasor, { recursive: true, force: true });
}
