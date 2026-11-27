import { describe, expect, it } from "vitest";
import { raporHtml } from "../../arayuz/src/rapor.js";
import { karsilastir } from "../src/analiz.js";
import { ayar, ornek } from "./yardimci/ortam.js";

describe("indirilen rapor", () => {
  it("hükmü, bulguları ve dayandıkları ham farkları taşır", async () => {
    const rapor = await karsilastir({ mod: "donusum", a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf") }, ayar(), null);
    const html = raporHtml(rapor);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Ekstreler eşdeğer değil");
    expect(html).toContain("Eski sistem: ekstre-eski.pdf (2 sayfa)");
    expect(html).toContain("12.450,57");
    expect(html).toContain("ŞEHİR İÇİ ULAŞIM KARTI DOLUM");
    for (const b of rapor.bulgular) expect(html).toContain(`<td>${b.kimlik}</td>`);
    expect(html).not.toContain("<script");
  });

  it("belgeden ve LLM'den gelen metni HTML olarak çalıştırmaz", async () => {
    const rapor = await karsilastir({ mod: "donusum", a: ornek("ekstre-eski.pdf"), b: ornek("ekstre-yeni.pdf") }, ayar(), null);
    rapor.ozet = '<img src=x onerror="alert(1)">';
    rapor.bulgular[0]!.baslik = "<script>alert(2)</script>";
    rapor.belgeler.a.ad = '"><b>dosya</b>.pdf';
    const html = raporHtml(rapor);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>dosya");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });
});
