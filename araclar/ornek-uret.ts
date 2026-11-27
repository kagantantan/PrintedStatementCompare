// npm run ornek  ->  ornekler/ altındaki uydurma ekstre PDF'lerini üretir.
// Banka, müşteri, kart ve işlemler uydurmadır; gerçek bir ekstreden alınmış tek satır yoktur.
//
//   ekstre-eski.pdf      ekstre-yeni.pdf      dönüşüm modu: yeni tarafta bilerek bırakılmış hatalar
//   sablon-referans.pdf  sablon-yeni.pdf      şablon modu: istenen (ve istenmeyen) şablon değişiklikleri
//   sablon-istek.txt                          şablon modunda "istenen değişiklikler" notu
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hedef = path.join(kok, "ornekler");
const require = createRequire(import.meta.url);
const yaziKlasoru = path.join(path.dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");

interface Islem {
  tarih: string;
  aciklama: string;
  tutar: string;
  taksit?: string;
  puan?: string;
}

/** Bir varyantın eski/referans halinden farkları. Boş nesne: asıl hal. */
interface Varyant {
  // Dönüşüm hataları
  donemBorcu?: string;
  sonOdemeBicimi?: "sayisal";
  eksikIslem?: number;
  turkceKarakterKaybi?: number;
  islemTarihi?: { sira: number; tarih: string };
  adresKaymasi?: number;
  dipnotPuntosu?: number;
  logoYok?: boolean;
  taksitEtiketi?: string;
  baslikKucukHarf?: boolean;
  // Şablon değişiklikleri
  kampanyaKutusu?: boolean;
  nakitLimitiYok?: boolean;
  puanSutunu?: string;
  iletisim?: string;
  logoSagda?: boolean;
  asgariEtiketi?: string;
}

const ISLEMLER: Islem[] = [
  { tarih: "28 Ekim 2026", aciklama: "ÖDEME-İNTERNET BANKACILIĞI", tutar: "+8.250,00" },
  { tarih: "29 Ekim 2026", aciklama: "ÖRNEK MARKET ALIŞVERİŞİ ANKARA", tutar: "1.284,90", puan: "12" },
  { tarih: "30 Ekim 2026", aciklama: "DENEME AKARYAKIT İSTASYONU", tutar: "2.150,00", puan: "21" },
  { tarih: "01 Kasım 2026", aciklama: "ÖRNEK ELEKTRONİK MAĞAZASI", tutar: "3.499,83", taksit: "13.999,32 / 2-6", puan: "35" },
  { tarih: "02 Kasım 2026", aciklama: "KİTAP VE KIRTASİYE DÜNYASI", tutar: "416,50", puan: "4" },
  { tarih: "04 Kasım 2026", aciklama: "ŞEHİR İÇİ ULAŞIM KARTI DOLUM", tutar: "500,00" },
  { tarih: "05 Kasım 2026", aciklama: "ÖRNEK ECZANESİ", tutar: "237,45", puan: "2" },
  { tarih: "07 Kasım 2026", aciklama: "DENEME RESTORAN ÇANKAYA", tutar: "1.860,00", puan: "18" },
  { tarih: "09 Kasım 2026", aciklama: "ÇEVRİM İÇİ ABONELİK HİZMETİ", tutar: "229,99" },
  { tarih: "10 Kasım 2026", aciklama: "ÖRNEK GİYİM MAĞAZASI", tutar: "1.125,00", taksit: "2.250,00 / 1-3", puan: "11" },
  { tarih: "12 Kasım 2026", aciklama: "ÖRNEK MARKET ALIŞVERİŞİ ANKARA", tutar: "947,35", puan: "9" },
  { tarih: "14 Kasım 2026", aciklama: "SİGORTA PRİM ÖDEMESİ", tutar: "1.675,20" },
  { tarih: "16 Kasım 2026", aciklama: "DENEME SİNEMA SALONLARI", tutar: "420,00", puan: "4" },
  { tarih: "18 Kasım 2026", aciklama: "ÖRNEK YAPI MARKET", tutar: "2.314,60", puan: "23" },
  { tarih: "20 Kasım 2026", aciklama: "NAKİT AVANS FAİZİ", tutar: "86,42" },
  { tarih: "21 Kasım 2026", aciklama: "KKDF", tutar: "12,96" },
  { tarih: "21 Kasım 2026", aciklama: "BSMV", tutar: "12,96" },
  { tarih: "23 Kasım 2026", aciklama: "DENEME KAFE KIZILAY", tutar: "385,00", puan: "3" },
  { tarih: "24 Kasım 2026", aciklama: "ÖRNEK MOBİLYA", tutar: "2.891,59", taksit: "17.349,54 / 3-9", puan: "28" },
  { tarih: "25 Kasım 2026", aciklama: "YILLIK KART ÜCRETİ", tutar: "650,00" },
];

const turkcesiz = (metin: string) =>
  metin.replace(/[ŞşİıĞğÜüÖöÇç]/g, (h) => ({ Ş: "S", ş: "s", İ: "I", ı: "i", Ğ: "G", ğ: "g", Ü: "U", ü: "u", Ö: "O", ö: "o", Ç: "C", ç: "c" })[h] ?? h);

function ekstreUret(dosya: string, v: Varyant): Promise<void> {
  return new Promise((bitti, hata) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Kredi Kartı Hesap Özeti (örnek)", CreationDate: new Date(Date.UTC(2026, 10, 27)) } });
    const akis = fs.createWriteStream(path.join(hedef, dosya));
    akis.on("finish", bitti).on("error", hata);
    doc.pipe(akis);
    doc.registerFont("duz", path.join(yaziKlasoru, "DejaVuSans.ttf"));
    doc.registerFont("kalin", path.join(yaziKlasoru, "DejaVuSans-Bold.ttf"));

    const yaz = (metin: string, x: number, y: number, sec: { punto?: number; kalin?: boolean; renk?: string; sagaYasla?: number } = {}) => {
      doc.font(sec.kalin ? "kalin" : "duz").fontSize(sec.punto ?? 8.5).fillColor(sec.renk ?? "#1b1b1b");
      const gx = sec.sagaYasla !== undefined ? sec.sagaYasla - doc.widthOfString(metin) : x;
      doc.text(metin, gx, y, { lineBreak: false });
    };
    const cizgi = (x1: number, y1: number, x2: number, renk = "#9aa3ad", kalinlik = 0.6) => doc.moveTo(x1, y1).lineTo(x2, y1).lineWidth(kalinlik).strokeColor(renk).stroke();

    const ustBilgi = (sayfa: number) => {
      const logoX = v.logoSagda ? 487 : 28;
      if (!v.logoYok) {
        doc.roundedRect(logoX, 26, 30, 30, 5).fill("#0f5e8c");
        doc.circle(logoX + 15, 41, 8).fill("#f2b33d");
      }
      const adX = v.logoSagda ? 28 : 66;
      yaz("ÖRNEK BANKA", adX, 30, { punto: 14, kalin: true, renk: "#0f5e8c" });
      yaz("Kredi Kartı Hesap Özeti", adX, 48, { punto: 8, renk: "#55606b" });
      if (!v.logoSagda) yaz(`Sayfa ${sayfa} / 2`, 0, 34, { punto: 7.5, renk: "#55606b", sagaYasla: 567 });
      else yaz(`Sayfa ${sayfa} / 2`, 28, 62, { punto: 7.5, renk: "#55606b" });
      cizgi(28, 74, 567, "#0f5e8c", 1.2);
    };

    const dipnot = () => {
      const punto = v.dipnotPuntosu ?? 7;
      cizgi(28, 778, 567);
      yaz("Bu belge örnek amaçlı üretilmiştir; gerçek bir müşteriye ya da hesaba ait değildir.", 28, 784, { punto, renk: "#55606b" });
      yaz(`Sorularınız için Müşteri İletişim Merkezi: ${v.iletisim ?? "0850 000 00 00"}  ·  www.ornekbanka.example`, 28, 795, { punto, renk: "#55606b" });
    };

    // ---- 1. sayfa
    ustBilgi(1);
    yaz(v.baslikKucukHarf ? "Hesap Bilgileri" : "HESAP BİLGİLERİ", 28, 90, { punto: 9, kalin: true });
    const bilgiler: [string, string][] = [
      ["Hesap Kesim Tarihi", "27 Kasım 2026"],
      ["Son Ödeme Tarihi", v.sonOdemeBicimi === "sayisal" ? "07.12.2026" : "7 Aralık 2026"],
      ["Dönem Borcu", `${v.donemBorcu ?? "12.450,75"} TL`],
      [v.asgariEtiketi ?? "Ödenmesi Gereken Asgari Tutar/Oran", "4.980,30 TL / %40"],
      ["Önceki Dönem Hesap Özeti Borcu", "8.250,00 TL"],
      ["Dönem İçi Harcamalar", "20.699,75 TL"],
      ["Dönem İçi Ödemeler", "+8.250,00 TL"],
      [v.taksitEtiketi ?? "Kalan Toplam Taksit Tutarı", "24.112,40 TL"],
      ["Kullanılabilir Toplam Puan/TL Karşılığı", "1.170 / 11,70 TL"],
      ["Kart Limiti", "150.000,00 TL"],
      ...(v.nakitLimitiYok ? [] : ([["Nakit Çekim Limiti", "30.000,00 TL"]] as [string, string][])),
      ["Kart Numarası", "5400 12** **** 3456"],
      ["Müşteri Numarası", "10000001"],
    ];
    let y = 106;
    for (const [etiket, deger] of bilgiler) {
      yaz(etiket, 28, y);
      yaz(`: ${deger}`, 198, y, { kalin: etiket === "Dönem Borcu" });
      y += 11.5;
    }

    const adresY = 132 + (v.adresKaymasi ?? 0);
    yaz("Sn. AYŞE ÖRNEK", 337, adresY, { kalin: true });
    yaz("ÖRNEK MAH. DENEME SK. NO: 1/2", 337, adresY + 11.5);
    yaz("ÇANKAYA / ANKARA", 337, adresY + 23);
    yaz("06000", 337, adresY + 34.5);
    doc.roundedRect(331, 190 + (v.adresKaymasi ?? 0), 236, 26, 3).lineWidth(0.8).strokeColor("#b5482f").stroke();
    yaz("Son Ödeme Tarihi: 7 Aralık 2026", 339, 198 + (v.adresKaymasi ?? 0), { punto: 9.5, kalin: true, renk: "#b5482f" });

    if (v.kampanyaKutusu) {
      doc.roundedRect(331, 228, 236, 44, 3).fill("#eef6fb");
      yaz("KAMPANYA", 339, 235, { punto: 8, kalin: true, renk: "#0f5e8c" });
      yaz("Aralık ayında market alışverişlerinize", 339, 247, { punto: 8 });
      yaz("2 kat puan kazanın.", 339, 258, { punto: 8 });
    }

    const tabloBasligi = (ty: number) => {
      doc.rect(28, ty - 4, 539, 16).fill("#e9edf1");
      yaz("İşlem Tarihi", 34, ty, { punto: 8, kalin: true });
      yaz("İşlemler", 110, ty, { punto: 8, kalin: true });
      yaz("Tutar (TL)", 0, ty, { punto: 8, kalin: true, sagaYasla: 385 });
      yaz("Kalan Tutar/Taksit", 0, ty, { punto: 8, kalin: true, sagaYasla: 480 });
      yaz(v.puanSutunu ?? "Puan", 0, ty, { punto: 8, kalin: true, sagaYasla: 561 });
    };
    const islemSatiri = (islem: Islem, sira: number, ty: number) => {
      const aciklama = v.turkceKarakterKaybi === sira ? turkcesiz(islem.aciklama) : islem.aciklama;
      const tarih = v.islemTarihi?.sira === sira ? v.islemTarihi.tarih : islem.tarih;
      yaz(tarih, 34, ty);
      yaz(aciklama, 110, ty);
      yaz(islem.tutar, 0, ty, { sagaYasla: 385 });
      if (islem.taksit) yaz(islem.taksit, 0, ty, { sagaYasla: 480 });
      if (islem.puan) yaz(islem.puan, 0, ty, { sagaYasla: 561 });
      cizgi(28, ty + 11, 567, "#dfe4e8", 0.4);
    };

    const tabloY = v.kampanyaKutusu ? 300 : 286;
    yaz("Kart Numarası : 5400 12** **** 3456", 28, tabloY - 20, { kalin: true });
    yaz("AYŞE ÖRNEK", 0, tabloY - 20, { kalin: true, sagaYasla: 567 });
    tabloBasligi(tabloY);
    y = tabloY + 18;
    yaz("ÖNCEKİ DÖNEM HESAP ÖZETİ BORCU", 110, y);
    yaz("8.250,00", 0, y, { sagaYasla: 385 });
    cizgi(28, y + 11, 567, "#dfe4e8", 0.4);
    y += 14;
    const islemler = ISLEMLER.map((islem, sira) => ({ islem, sira })).filter(({ sira }) => sira !== v.eksikIslem);
    const ilkSayfa = islemler.slice(0, 14);
    const ikinciSayfa = islemler.slice(14);
    for (const { islem, sira } of ilkSayfa) {
      islemSatiri(islem, sira, y);
      y += 14;
    }
    dipnot();

    // ---- 2. sayfa
    doc.addPage({ size: "A4", margin: 0 });
    ustBilgi(2);
    tabloBasligi(92);
    y = 110;
    for (const { islem, sira } of ikinciSayfa) {
      islemSatiri(islem, sira, y);
      y += 14;
    }
    y += 6;
    yaz("DÖNEM BORCU", 110, y, { kalin: true });
    yaz(v.donemBorcu ?? "12.450,75", 0, y, { kalin: true, sagaYasla: 385 });
    y += 30;
    yaz("FAİZ ORANLARI", 28, y, { punto: 9, kalin: true });
    y += 15;
    for (const [etiket, deger] of [
      ["Aylık Akdi Faiz Oranı (Alışveriş)", "%4,25"],
      ["Aylık Akdi Faiz Oranı (Nakit Avans)", "%5,00"],
      ["Aylık Gecikme Faiz Oranı", "%4,55"],
    ] as const) {
      yaz(etiket, 28, y);
      yaz(`: ${deger}`, 198, y);
      y += 11.5;
    }
    y += 14;
    yaz("ÖNEMLİ BİLGİLER", 28, y, { punto: 9, kalin: true });
    y += 15;
    for (const satir of [
      "Dönem borcunuzun tamamını son ödeme tarihine kadar ödemeniz halinde alışveriş işlemlerinize faiz uygulanmaz.",
      "Asgari tutarın altında ödeme yapılması halinde kalan asgari tutara gecikme faizi uygulanır.",
      "Hesap özetinize son ödeme tarihinden itibaren on gün içinde itiraz edebilirsiniz.",
    ]) {
      yaz(satir, 28, y, { punto: 8 });
      y += 11;
    }
    dipnot();
    doc.end();
  });
}

fs.mkdirSync(hedef, { recursive: true });

// Dönüşüm: eski ile yeni aynı olmalıydı; yeni tarafta on fark var.
await ekstreUret("ekstre-eski.pdf", {});
await ekstreUret("ekstre-yeni.pdf", {
  donemBorcu: "12.450,57", // kuruş hanesi yer değiştirmiş
  sonOdemeBicimi: "sayisal", // tarih aynı, yazılışı farklı
  eksikIslem: 5, // bir işlem satırı yok
  turkceKarakterKaybi: 1, // Türkçe karakterler kaybolmuş
  islemTarihi: { sira: 7, tarih: "08 Kasım 2026" }, // işlem tarihi bir gün kaymış
  adresKaymasi: 9, // adres bloğu aşağı kaymış
  dipnotPuntosu: 6.2, // dipnot küçülmüş
  logoYok: true, // logo basılmamış
  taksitEtiketi: "Kalan Taksit Tutarı", // etiket kısalmış
  baslikKucukHarf: true, // yalnızca yazım
});

// Şablon: referans bugünkü şablon; yeni şablonda istenenler ve istenmeyen bir değişiklik var.
await ekstreUret("sablon-referans.pdf", {});
await ekstreUret("sablon-yeni.pdf", {
  kampanyaKutusu: true, // istendi
  nakitLimitiYok: true, // istendi
  puanSutunu: "Kazanılan Puan", // istendi
  iletisim: "444 0 000", // istendi
  logoSagda: true, // istendi
  asgariEtiketi: "Asgari Ödeme Tutarı/Oranı", // istenmedi
  // İstenen "Yıllık Maliyet Oranı" satırı bilerek eklenmedi (karşılanmamış istek).
});
fs.writeFileSync(
  path.join(hedef, "sablon-istek.txt"),
  [
    "1. Adres bloğunun altına bir kampanya kutusu eklensin.",
    "2. Hesap bilgilerinden \"Nakit Çekim Limiti\" satırı kaldırılsın.",
    "3. İşlem tablosunda \"Puan\" sütununun adı \"Kazanılan Puan\" olsun.",
    "4. Dipnottaki iletişim merkezi numarası 444 0 000 olarak değişsin.",
    "5. Logo sayfanın sağ üst köşesine taşınsın.",
    "6. Faiz oranları bölümüne \"Yıllık Maliyet Oranı\" satırı eklensin.",
    "",
  ].join("\n"),
);

console.log(`Örnekler üretildi: ${hedef}`);
