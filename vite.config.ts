import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
	plugins: [svelte()],
	root: "src/mainview",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: Number(process.env.MAVMETA_WEB_PORT ?? "5173"),
		strictPort: true,
		proxy: {
			"/api": {
				target: `http://${process.env.MAVMETA_HOST ?? "127.0.0.1"}:${process.env.MAVMETA_PORT ?? "8787"}`,
				changeOrigin: false,
			},
		},
	},
});
