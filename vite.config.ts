import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const comfyHostSetting = env.VITE_COMFYUI_HOST || '127.0.0.1';
  const comfyProtocol = /^https:\/\//i.test(comfyHostSetting) ? 'https' : 'http';
  const parsedComfyUrl = (() => {
    try {
      return new URL(comfyHostSetting.includes('://') ? comfyHostSetting : `${comfyProtocol}://${comfyHostSetting}`);
    } catch {
      return null;
    }
  })();
  const rawComfyHost = (parsedComfyUrl?.hostname || comfyHostSetting).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const comfyHost = rawComfyHost.includes(':') && !rawComfyHost.startsWith('[') ? `[${rawComfyHost}]` : rawComfyHost;
  const comfyPort = Number(env.VITE_COMFYUI_PORT) || Number(parsedComfyUrl?.port) || (comfyProtocol === 'https' ? 443 : 8188);
  const comfyOrigin = `${comfyProtocol}://${comfyHost}:${comfyPort}`;

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      allowedHosts: ['.goose-marlin.ts.net'],
      port: 5173,
      strictPort: true,
      cors: false,
      proxy: {
        '/comfyui-api': {
          target: comfyOrigin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/comfyui-api/, ''),
          ws: true,
          configure: (proxy) => {
            // ComfyUI rejects requests where Origin doesn't match Host (DNS-rebinding
            // protection). changeOrigin only rewrites Host, so Origin must be rewritten
            // separately for both plain HTTP requests and the WebSocket upgrade request.
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('origin', comfyOrigin);
            });
            proxy.on('proxyReqWs', (proxyReq) => {
              proxyReq.setHeader('origin', comfyOrigin);
            });
          },
        },
      },
    },
    preview: {
      allowedHosts: ['.goose-marlin.ts.net'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
