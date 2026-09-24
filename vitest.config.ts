import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "#imports": fileURLToPath(new URL("./tests/mocks/imports.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    environmentOptions: {
      jsdom: {
        url: "https://example.com/",
      },
    },
  },
});
