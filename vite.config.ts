import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  plugins: [mkcert()],
  resolve: {
    alias: {
      'three/webgpu': 'three/webgpu',
      'three/tsl': 'three/tsl'
    }
  },
  server: {
    https: true
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  },
  build: {
    target: 'esnext'
  }
});
