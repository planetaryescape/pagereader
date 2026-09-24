import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: "build",
  manifest: {
    name: "PageReader",
    description: "Read any webpage aloud with AI-powered text-to-speech",
    minimum_chrome_version: "116",
    permissions: ["storage", "offscreen", "unlimitedStorage"],
    host_permissions: ["https://api.deepgram.com/*", "wss://api.deepgram.com/*"],
    action: {
      default_title: "PageReader Settings",
    },
  },
});
