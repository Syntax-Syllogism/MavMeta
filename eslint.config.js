import globals from "globals";
import tseslint from "typescript-eslint";
import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
	...tseslint.configs.recommended,
	...sveltePlugin.configs["flat/recommended"],
	prettierConfig,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
	},
	{
		files: ["**/*.svelte"],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tseslint.parser,
			},
		},
	},
	{
		rules: {
			"svelte/prefer-svelte-reactivity": "off",
			"@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_" }],
		},
	},
	{
		files: ["**/*.test.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		ignores: ["dist/", "dist-server/", "node_modules/", ".history/"],
	},
);
