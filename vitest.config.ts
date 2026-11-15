import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["**/*.test.ts"],
		// .claude holds agent worktrees: full repo copies whose tests must not run here.
		exclude: ["node_modules", ".pi-lens", ".claude"],
		testTimeout: 10000, // 10 second timeout per test
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/",
				".pi-lens/",
				".claude/",
				"**/*.d.ts",
				"**/*.test.ts",
			],
		},
	},
	resolve: {
		alias: {
			"@": ".",
		},
	},
});
