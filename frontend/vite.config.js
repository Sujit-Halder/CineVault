import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.');

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: env.VITE_SERVER_IP,
      port: parseInt(env.VITE_SERVER_PORT),
    },
    test: { environment:'jsdom',setupFiles:'./test/setup.js',globals:true,css:false,include:['test/ui/**/*.test.jsx'] },
  };
});
