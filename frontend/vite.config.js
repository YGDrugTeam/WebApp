import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // tailwindcss 플러그인을 유지해야 디자인이 깨지지 않습니다.
  plugins: [react(), tailwindcss()],
  server: {
    strictPort: true,
    proxy: {
      // 1. Flask 검색 서버 (수정된 부분)
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
        // rewrite는 기존대로 유지하여 /api를 제거하고 Flask에 전달합니다.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // 2. FastAPI 서버 (기존 설정 유지)
      '/ml': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ml/, ''),
      },
    },
  },
})