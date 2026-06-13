import svelte from "eslint-plugin-svelte";

  export default [
    ...svelte.configs.recommended,
    {
      files: ["**/*.svelte", "**/*.svelte.ts",
  "**/*.svelte.js"],
      languageOptions: {
        parserOptions: {
          extraFileExtensions: [".svelte"],
        },
      },
    },
  ];
