import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  // 构建时注入前端控制服务地址（默认本机 8766）
  define: {
    __WPANEL_API__: JSON.stringify(process.env.NEXT_PUBLIC_WPANEL_API || 'http://127.0.0.1:8766'),
  },
  server: process.env.CODEX_SANDBOX === 'seatbelt'
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
  plugins: [vinext()],
}));
