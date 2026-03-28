import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["**/*.test.ts"],
		exclude: ["node_modules", ".pi-lens"],
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
