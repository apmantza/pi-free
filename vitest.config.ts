import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["**/*.test.ts"],
		exclude: ["node_modules", ".pi-lens"],
		testTimeout: 10000, // 10 second timeout per test
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/", ".pi-lens/", "**/*.d.ts", "**/*.test.ts"],
		},
	},
	resolve: {
		alias: {
			"@": ".",
		},
	},
});
