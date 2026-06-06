import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		conditions: ["browser"],
	},
	test: {
		environment: "jsdom",
		globals: true,
		testTimeout: 30000,
		maxWorkers: 4,
		minWorkers: 1,
		setupFiles: "./src/test/setup.ts",
		include: ["src/**/*.test.{ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
		},
	},
});
