// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    mode: 'directory',
    routes: {
      strategy: 'include',
      include: ['/api/create-checkout-session']
    }
  })
});