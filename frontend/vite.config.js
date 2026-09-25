import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.');
  const configuredPort = Number.parseInt(env.VITE_SERVER_PORT,10);
  const serverPort = Number.isInteger(configuredPort) ? configuredPort : 3000;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: env.VITE_SERVER_IP,
      port: serverPort,
    },
    preview: {
      host: env.VITE_SERVER_IP,
      port: serverPort,
      strictPort: true,
    },
    test: { environment:'jsdom',setupFiles:'./test/setup.js',globals:true,css:false,include:['test/ui/**/*.test.jsx'] },
  };
});
