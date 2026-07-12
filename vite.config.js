import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    open: true
  },
  plugins: [
    {
      name: 'rewrite-account',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/account') {
            req.url = '/account/';
          }
          next();
        });
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        account: resolve(__dirname, 'account/index.html')
      }
    }
  }
});
