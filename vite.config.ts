import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// Arayüz arayuz/ altında; derlenmiş hali arayuz/dist (sunucu oradan sunar).
// `npm run gelistir` ile geliştirirken API istekleri çalışan sunucuya (8790) yönlenir.
const SUNUCU = `http://127.0.0.1:${process.env.EKSTRE_PORT ?? 8790}`;

// Sunucu yalnızca kendi adresinden gelen istekleri kabul eder; geliştirme sunucusundan gelenlerde kökeni ona çeviririz.
const vekil: ProxyOptions = {
  target: SUNUCU,
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (giden, gelen) => {
      const koken = gelen.headers.origin;
      if (koken && /^http:\/\/(localhost|127\.0\.0\.1):5190$/.test(koken)) giden.setHeader("origin", SUNUCU);
    });
  },
};

export default defineConfig({
  root: "arayuz",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1200, target: "es2022" },
  server: { port: 5190, strictPort: true, proxy: { "/api": vekil, "/pdfjs": vekil } },
});
