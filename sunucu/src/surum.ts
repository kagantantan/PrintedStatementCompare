// Node sürüm denetimi. Bağımlılıklar (pdf.js) Node 22.13+ ister; daha eski sürümde hata anlaşılmaz olur,
// o yüzden açılışta biz söyleriz. Bu dosya başka hiçbir şeyi içe almaz: eski Node'da da yüklenebilmeli.
export const EN_AZ_NODE = [22, 13] as const;

export function nodeUygunMu(surum: string): boolean {
  const [ana = 0, alt = 0] = surum.replace(/^v/, "").split(".").map(Number);
  return ana > EN_AZ_NODE[0] || (ana === EN_AZ_NODE[0] && alt >= EN_AZ_NODE[1]);
}

export function nodeHatasi(surum: string): string {
  return `Bu uygulama Node.js ${EN_AZ_NODE.join(".")} ya da daha yenisini ister; bu bilgisayarda ${surum} var. Node'u güncelleyip yeniden deneyin.`;
}
