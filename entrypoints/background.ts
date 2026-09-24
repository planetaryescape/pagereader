import { browser } from "#imports";

export default defineBackground(() => {
  const chromeApi = (globalThis as typeof globalThis & { chrome: any }).chrome;

  function requestStopForTab(tabId: number): void {
    browser.runtime
      .sendMessage({ target: "offscreen", action: "stopForTab", tabId })
      .catch(() => {});
  }

  async function ensureOffscreen() {
    try {
      const contexts = await chromeApi.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chromeApi.runtime.getURL("offscreen.html")],
      });
      if (Array.isArray(contexts) && contexts.length > 0) {
        return;
      }
    } catch {
      // Fall through to best-effort creation below.
    }

    try {
      await chromeApi.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chromeApi.offscreen.Reason.AUDIO_PLAYBACK],
        justification: "Playing TTS audio",
      });
    } catch (err) {
      const message = (err as Error).message;
      if (
        !message.includes("already exists") &&
        !message.includes("Only a single offscreen document may be created")
      ) {
        throw err;
      }
    }
  }

  // Forward messages from offscreen to content scripts
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.source === "offscreen") {
      const tabId = typeof message.tabId === "number" ? message.tabId : undefined;
      if (typeof tabId === "number") {
        browser.tabs.sendMessage(tabId, message).catch(() => {});
      }
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
            const tabId = sender.tab?.id;
            browser.runtime.sendMessage(
              { target: "offscreen", ...message.data, tabId }
            )
              .then(sendResponse)
              .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
          })
          .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
        return true;
      }
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "loading") return;
    requestStopForTab(tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    requestStopForTab(tabId);
  });
});
