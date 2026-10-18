// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: 'https://www.coachedgar.com',
  output: 'server',
  devToolbar: { enabled: false },
  adapter: cloudflare(),
  integrations: [sitemap({
    filter(page) {
      const pathname = new URL(page).pathname.replace(/\/$/, '') || '/';
      return !['/pay', '/download-pdf', '/blog'].includes(pathname)
        && !pathname.startsWith('/blog/');
    }
  })],
  vite: {
    plugins: [tailwindcss()],
    build: {
      sourcemap: true
    },
    css: {
      devSourcemap: true
    }
  },
  // image: {
  //   service: {
  //     entrypoint: 'astro/assets/services/sharp',
  //     config: {
  //       quality: 80
  //     }
  //   },
  //   domains: ['i.ytimg.com'],
  //   // Allow YouTube thumbnails
  //   remotePatterns: [{
  //     protocol: 'https',
  //     hostname: '**.gstatic.com'
  //   }]
  // }
});
