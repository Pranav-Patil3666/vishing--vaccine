import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, workspaceRoot, "");
  return {
    envDir: workspaceRoot,
    plugins: [react()],
    server: {
      proxy: {
        "/health": {
          target: process.env.API_PROXY_TARGET || environment.API_PROXY_TARGET || "http://127.0.0.1:3001",
          changeOrigin: false,
        },
        "/api": {
          target: process.env.API_PROXY_TARGET || environment.API_PROXY_TARGET || "http://127.0.0.1:3001",
          changeOrigin: false,
        },
      },
    },
  };
});
