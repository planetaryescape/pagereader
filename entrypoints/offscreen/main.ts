import { browser } from "#imports";

let audio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  switch (message.action) {
    case "play":
      playAudio(message.audioData, message.speed)
        .then(() => sendResponse({ success: true }))
        .catch((err: Error) => sendResponse({ success: false, error: err.message }));
      return true;

    case "pause":
      if (audio) {
        audio.pause();
        sendResponse({ success: true });
      }
      break;

    case "resume":
      if (audio) {
        audio.play();
        sendResponse({ success: true });
      }
      break;

    case "stop":
      stopAudio();
      sendResponse({ success: true });
      break;

    case "setSpeed":
      if (audio) {
        audio.playbackRate = message.speed;
        sendResponse({ success: true });
      }
      break;
  }
});

async function playAudio(audioDataArray: number[], speed: number): Promise<void> {
  stopAudio();

  const audioData = new Uint8Array(audioDataArray);
  const blob = new Blob([audioData], { type: "audio/mpeg" });
  currentBlobUrl = URL.createObjectURL(blob);

  audio = new Audio(currentBlobUrl);
  audio.preservesPitch = true;
  audio.playbackRate = speed;

  audio.onended = () => {
    console.log("[Offscreen] Audio ended, sending event");
    browser.runtime.sendMessage({ source: "offscreen", event: "ended" }).catch((err) => {
      console.error("[Offscreen] Failed to send ended event:", err);
    });
    cleanupBlob();
  };

  audio.onerror = () => {
    console.log("[Offscreen] Audio error");
    browser.runtime.sendMessage({
      source: "offscreen",
      event: "error",
      error: audio?.error?.message || "Playback error",
    }).catch((err) => {
      console.error("[Offscreen] Failed to send error event:", err);
    });
    cleanupBlob();
  };

  audio.onplay = () => {
    console.log("[Offscreen] Audio playing");
    browser.runtime.sendMessage({ source: "offscreen", event: "playing" }).catch((err) => {
      console.error("[Offscreen] Failed to send playing event:", err);
    });
  };

  audio.onpause = () => {
    console.log("[Offscreen] Audio paused");
    browser.runtime.sendMessage({ source: "offscreen", event: "paused" }).catch((err) => {
      console.error("[Offscreen] Failed to send paused event:", err);
    });
  };

  await audio.play();
}

function stopAudio() {
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  cleanupBlob();
}

function cleanupBlob() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}
