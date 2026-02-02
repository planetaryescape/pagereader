import { browser } from "#imports";

export default defineBackground(() => {
  let offscreenCreated = false;

  async function ensureOffscreen() {
    if (offscreenCreated) return;

    try {
      // @ts-expect-error - offscreen API types not in webextension-polyfill
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        // @ts-expect-error - offscreen API types not in webextension-polyfill
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: "Playing TTS audio",
      });
      offscreenCreated = true;
    } catch (err) {
      // Document might already exist
      if (!(err as Error).message.includes("already exists")) {
        throw err;
      }
      offscreenCreated = true;
    }
  }

  // Forward messages from offscreen to content scripts
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.source === "offscreen") {
      console.log("[Background] Forwarding offscreen event:", message.event);
      // Broadcast to all tabs
      browser.tabs.query({}).then((tabs) => {
        console.log("[Background] Broadcasting to", tabs.length, "tabs");
        for (const tab of tabs) {
          if (tab.id) {
            browser.tabs.sendMessage(tab.id, message).catch(() => {});
          }
        }
      });
      return;
    }

    // Handle requests from content script
    if (message.target === "background") {
      if (message.action === "ensureOffscreen") {
        ensureOffscreen()
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
        return true;
      }

      if (message.action === "toOffscreen") {
        ensureOffscreen()
          .then(() => {
            browser.runtime.sendMessage(
              { target: "offscreen", ...message.data }
            )
              .then(sendResponse)
              .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
          })
          .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
        return true;
      }
    }
  });
});
