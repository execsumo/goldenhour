import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rawComfyHost = (env.VITE_COMFYUI_HOST || '127.0.0.1').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const comfyHost = rawComfyHost.includes(':') && !rawComfyHost.startsWith('[') ? `[${rawComfyHost}]` : rawComfyHost;
  const comfyPort = Number(env.VITE_COMFYUI_PORT) || 8188;
  const comfyOrigin = `http://${comfyHost}:${comfyPort}`;

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
