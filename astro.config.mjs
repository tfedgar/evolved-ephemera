// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [sitemap()],
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