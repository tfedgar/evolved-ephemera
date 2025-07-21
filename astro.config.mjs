// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    mode: 'directory',
    functionPerRoute: true,
    routes: {
      strategy: 'include',
      include: ['/api/create-checkout-session']
    },
    imageService: 'cloudflare'
  }),
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        quality: 80
      }
    },
    domains: ['i.ytimg.com'], // Allow YouTube thumbnails
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.gstatic.com'
      }
    ]
  },
  vite: {
    build: {
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          manualChunks: undefined
        }
      }
    }
  }
});