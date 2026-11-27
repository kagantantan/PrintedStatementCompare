// Raporu tek dosyalık HTML olarak indirir: e-postayla ya da test kaydına eklenerek paylaşılabilir.
import type { Rapor } from "../../sunucu/src/tipler";
import { KATEGORI_ADI, MODLAR, ONEM_ADI } from "./adlar";

const kacis = (metin: string) => metin.replace(/[&<>"']/g, (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[h]!);

export function raporHtml(rapor: Rapor): string {
  const tanim = MODLAR[rapor.mod];
  const farklar = new Map(rapor.farklar.map((f) => [f.kimlik, f]));
  const tarih = new Date(rapor.tarih).toLocaleString("tr-TR");
  const renk = { temiz: "#2d7a4b", dikkat: "#a66a00", sorun: "#b3261e" }[rapor.hukum.durum];
  const onemRengi = { kritik: "#b3261e", orta: "#a66a00", dusuk: "#4f6b80", bilgi: "#6e7b74" };
  const satirlar = rapor.bulgular
    .map((b) => {
      const dayanak = b.farklar
        .map((k) => farklar.get(k))
        .filter((f) => f !== undefined)
        .map((f) => {
          const sayfa = f.a?.kutu.sayfa ?? f.b?.kutu.sayfa;
          return `<li><code>${f.kimlik}</code>${sayfa ? ` s.${sayfa}` : ""}: ${kacis(f.ayrinti)}${f.tur === "eksik" && f.a ? `: <q>${kacis(f.a.metin)}</q>` : ""}${f.tur === "fazla" && f.b ? `: <q>${kacis(f.b.metin)}</q>` : ""}</li>`;
        })
        .join("");
      const isaret = b.beklenen === true ? (rapor.mod === "donusum" ? "Bilinen fark" : "İstenen") : b.beklenen === false && rapor.mod === "sablon" ? "İstenmemiş" : "";
      return `<tr>
<td>${b.kimlik}</td>
<td style="color:${onemRengi[b.onem]};font-weight:700">${ONEM_ADI[b.onem]}</td>
<td>${KATEGORI_ADI[b.kategori]}</td>
<td><strong>${kacis(b.baslik)}</strong>${b.aciklama ? `<br>${kacis(b.aciklama)}` : ""}${dayanak ? `<ul>${dayanak}</ul>` : "<br><em>Kanıtsız: makinenin bulduğu bir farka dayanmıyor.</em>"}</td>
<td>${b.kaynak === "llm" ? "LLM yorumu" : "Makine"}${isaret ? `<br>${isaret}` : ""}</td>
</tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Ekstre karşılaştırma raporu</title>
<style>
body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1e2428;max-width:1100px;margin:32px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 4px} .hukum{border-left:5px solid ${renk};padding:10px 16px;background:#f6f7f4;margin:18px 0}
.hukum h2{margin:0;font-size:17px;color:${renk}} table{border-collapse:collapse;width:100%} th,td{border:1px solid #d5d9d2;padding:7px 9px;vertical-align:top;text-align:left}
th{background:#f0f2ee;font-size:12.5px} ul{margin:6px 0 0;padding-left:18px;color:#4c585e;font-size:13px} code{font-size:12px} .kunye{color:#5e6a70;font-size:13px}
@media print{body{margin:10mm}}
</style></head><body>
<h1>Ekstre karşılaştırma raporu</h1>
<div class="kunye">${kacis(tanim.ad)}${rapor.yalniz_yapi ? " (yalnızca şablon)" : ""} · ${kacis(tarih)}</div>
<div class="kunye">${kacis(tanim.a)}: ${kacis(rapor.belgeler.a.ad)} (${rapor.belgeler.a.sayfa} sayfa) · ${kacis(tanim.b)}: ${kacis(rapor.belgeler.b.ad)} (${rapor.belgeler.b.sayfa} sayfa)</div>
<div class="kunye">${rapor.llm.kullanildi ? `Yorumlayan LLM: ${kacis(rapor.llm.model ?? "")}` : kacis(rapor.llm.hata ?? "LLM kullanılmadı.")}</div>
<div class="hukum"><h2>${kacis(rapor.hukum.metin)}</h2><p>${kacis(rapor.ozet)}</p>
${rapor.karsilanmayan.length ? `<strong>Karşılanmayan istekler</strong><ul>${rapor.karsilanmayan.map((k) => `<li>${kacis(k)}</li>`).join("")}</ul>` : ""}
${rapor.uyarilar.map((u) => `<p><em>${kacis(u)}</em></p>`).join("")}</div>
${rapor.bulgular.length ? `<table><thead><tr><th>No</th><th>Önem</th><th>Tür</th><th>Bulgu</th><th>Kaynak</th></tr></thead><tbody>\n${satirlar}\n</tbody></table>` : "<p>Fark bulunamadı.</p>"}
<p class="kunye">Farkları makine bulur; LLM yalnızca yorumlar ve gruplar. Bu rapor ekstre içeriği taşır: paylaşırken kurum kurallarına uyun.</p>
</body></html>`;
}

export function raporIndir(rapor: Rapor): void {
  const d = new Date(rapor.tarih);
  const iki = (n: number) => String(n).padStart(2, "0");
  const ad = `ekstre-karsilastirma-${d.getFullYear()}${iki(d.getMonth() + 1)}${iki(d.getDate())}-${iki(d.getHours())}${iki(d.getMinutes())}.html`;
  const url = URL.createObjectURL(new Blob([raporHtml(rapor)], { type: "text/html;charset=utf-8" }));
  const bag = document.createElement("a");
  bag.href = url;
  bag.download = ad;
  bag.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
