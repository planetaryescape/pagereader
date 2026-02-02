import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "PageReader",
    description: "Read any webpage aloud with AI-powered text-to-speech",
    permissions: ["storage", "offscreen"],
    host_permissions: ["https://api.deepgram.com/*"],
    action: {
      default_title: "PageReader Settings",
    },
  },
});
