import { useState, useEffect } from "react";
import {
  getApiKey,
  setApiKey,
  getVoice,
  setVoice,
  getSpeed,
  setSpeed,
} from "@/lib/storage";
import { validateApiKey, VOICES } from "@/lib/deepgram";

type View = "setup" | "settings";

function App() {
  const [view, setView] = useState<View>("setup");
  const [apiKey, setApiKeyState] = useState("");
  const [voice, setVoiceState] = useState("aura-asteria-en");
  const [speed, setSpeedState] = useState(1);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const key = await getApiKey();
      const savedVoice = await getVoice();
      const savedSpeed = await getSpeed();

      if (key) {
        setApiKeyState(key);
        setView("settings");
      }
      setVoiceState(savedVoice);
      setSpeedState(savedSpeed);
    }
    load();
  }, []);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      setError("Please enter an API key");
      return;
    }

    setValidating(true);
    setError(null);

    const valid = await validateApiKey(apiKey.trim());

    if (valid) {
      await setApiKey(apiKey.trim());
      setView("settings");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError("Invalid API key. Please check and try again.");
    }

    setValidating(false);
  };

  const handleVoiceChange = async (newVoice: string) => {
    setVoiceState(newVoice);
    await setVoice(newVoice);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSpeedChange = async (newSpeed: number) => {
    setSpeedState(newSpeed);
    await setSpeed(newSpeed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRemoveKey = async () => {
    await setApiKey("");
    setApiKeyState("");
    setView("setup");
  };

  if (view === "setup") {
    return (
      <div className="p-4 w-80">
        <h1 className="text-lg font-semibold mb-2">PageReader</h1>
        <p className="text-sm text-gray-400 mb-4">
          Read any webpage aloud with AI voices
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">
              DeepGram API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKeyState(e.target.value)}
              placeholder="Enter your API key"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
              onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            onClick={handleSaveKey}
            disabled={validating}
            className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
          >
            {validating ? "Validating..." : "Save API Key"}
          </button>

          <a
            href="https://console.deepgram.com/signup"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-sm text-indigo-400 hover:text-indigo-300"
          >
            Get a free API key at deepgram.com →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 w-80">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">PageReader</h1>
        {saved && (
          <span className="text-xs text-green-400">Saved ✓</span>
        )}
      </div>

      <div className="space-y-4">
        {/* Voice Selection */}
        <div>
          <label className="block text-sm text-gray-300 mb-1">Voice</label>
          <select
            value={voice}
            onChange={(e) => handleVoiceChange(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
          >
            <optgroup label="Aura (Standard)">
              {VOICES.filter((v) => v.tier === "aura").map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Aura 2 (Enhanced)">
              {VOICES.filter((v) => v.tier === "aura-2").map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Speed Selection */}
        <div>
          <label className="block text-sm text-gray-300 mb-1">
            Default Speed: {speed}x
          </label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.25"
            value={speed}
            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>0.5x</span>
            <span>1x</span>
            <span>2x</span>
          </div>
        </div>

        {/* API Key Management */}
        <div className="pt-2 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">
              API Key: ••••{apiKey.slice(-4)}
            </span>
            <button
              onClick={handleRemoveKey}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          </div>
        </div>

        {/* Usage Instructions */}
        <div className="pt-2 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            <strong>Usage:</strong> A floating widget appears on every page.
            Click play to read the article content aloud.
            Press Space to play/pause.
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
