import { useEffect, useState } from "react";
import {
  addExcludedSite,
  getApiKey,
  getAudioCacheBudgetMb,
  getExcludedSites,
  getPlaybackEngine,
  getPlayerMode,
  getPlayerVisible,
  getSpeed,
  getVoice,
  normalizeSiteInput,
  removeExcludedSite,
  setApiKey,
  setPlaybackEngine,
  setPlayerMode,
  setPlayerVisible,
  setSpeed,
  setVoice,
} from "@/lib/storage";
import type { PlaybackEngine } from "@/lib/storage";
import { validateApiKey, VOICES } from "@/lib/deepgram";
import { clearAudioCache, getAudioCacheStats } from "@/lib/cache";

type View = "setup" | "settings";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const [view, setView] = useState<View>("setup");
  const [apiKey, setApiKeyState] = useState("");
  const [voice, setVoiceState] = useState("aura-2-thalia-en");
  const [speed, setSpeedState] = useState(1);
  const [playbackEngine, setPlaybackEngineState] = useState<PlaybackEngine>("stable");
  const [playerMode, setPlayerModeState] = useState<"docked" | "floating">("docked");
  const [playerVisible, setPlayerVisibleState] = useState(true);
  const [budgetMb, setBudgetMb] = useState(250);
  const [cacheBytes, setCacheBytes] = useState(0);
  const [cacheEntries, setCacheEntries] = useState(0);
  const [validating, setValidating] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [excludedSites, setExcludedSites] = useState<string[]>([]);
  const [excludeInput, setExcludeInput] = useState("");
  const [excludeError, setExcludeError] = useState<string | null>(null);

  const refreshCacheStats = async (currentBudgetMb: number) => {
    const stats = await getAudioCacheStats(currentBudgetMb);
    setCacheBytes(stats.totalBytes);
    setCacheEntries(stats.totalEntries);
  };

  useEffect(() => {
    async function load() {
      const [
        key,
        savedVoice,
        savedSpeed,
        savedEngine,
        savedMode,
        savedVisible,
        savedBudget,
        savedExcludedSites,
      ] = await Promise.all([
        getApiKey(),
        getVoice(),
        getSpeed(),
        getPlaybackEngine(),
        getPlayerMode(),
        getPlayerVisible(),
        getAudioCacheBudgetMb(),
        getExcludedSites(),
      ]);

      if (key) {
        setApiKeyState(key);
        setView("settings");
      }

      setVoiceState(savedVoice);
      setSpeedState(savedSpeed);
      setPlaybackEngineState(savedEngine);
      setPlayerModeState(savedMode);
      setPlayerVisibleState(savedVisible);
      setBudgetMb(savedBudget);
      setExcludedSites(savedExcludedSites);

      await refreshCacheStats(savedBudget);
    }

    void load();
  }, []);

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

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
      flashSaved();
    } else {
      setError("Invalid API key. Please check and try again.");
    }

    setValidating(false);
  };

  const handleVoiceChange = async (newVoice: string) => {
    setVoiceState(newVoice);
    await setVoice(newVoice);
    flashSaved();
  };

  const handleSpeedChange = async (newSpeed: number) => {
    setSpeedState(newSpeed);
    await setSpeed(newSpeed);
    flashSaved();
  };

  const handleEngineChange = async (engine: PlaybackEngine) => {
    setPlaybackEngineState(engine);
    await setPlaybackEngine(engine);
    flashSaved();
  };

  const handleModeChange = async (mode: "docked" | "floating") => {
    setPlayerModeState(mode);
    await setPlayerMode(mode);
    flashSaved();
  };

  const handleVisibleChange = async (nextVisible: boolean) => {
    setPlayerVisibleState(nextVisible);
    await setPlayerVisible(nextVisible);
    flashSaved();
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    await clearAudioCache();
    await refreshCacheStats(budgetMb);
    setClearingCache(false);
    flashSaved();
  };

  const handleRemoveKey = async () => {
    await setApiKey("");
    setApiKeyState("");
    setView("setup");
  };

  const handleAddExcludedSite = async () => {
    const normalized = normalizeSiteInput(excludeInput);
    if (!normalized) {
      setExcludeError("Enter a valid hostname or URL");
      return;
    }

    setExcludeError(null);
    const next = await addExcludedSite(normalized);
    setExcludedSites(next);
    setExcludeInput("");
    flashSaved();
  };

  const handleRemoveExcludedSite = async (hostname: string) => {
    const next = await removeExcludedSite(hostname);
    setExcludedSites(next);
    flashSaved();
  };

  if (view === "setup") {
    return (
      <div className="popup-shell w-[360px] p-4">
        <div className="popup-card popup-card--hero space-y-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-50">PageReader</h1>
            <p className="mt-1 text-sm text-slate-300">
              Turn any article into speech with clean controls and smart caching.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="api-key-input" className="popup-label">
              DeepGram API Key
            </label>
            <input
              id="api-key-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKeyState(e.target.value)}
              placeholder="Enter your API key"
              className="popup-input"
              onKeyDown={(e) => e.key === "Enter" && void handleSaveKey()}
            />
            {error && <p className="popup-error">{error}</p>}
          </div>

          <button
            type="button"
            onClick={() => void handleSaveKey()}
            disabled={validating}
            className="popup-primary-button"
          >
            {validating ? "Validating..." : "Save API Key"}
          </button>

          <a
            href="https://console.deepgram.com/signup"
            target="_blank"
            rel="noopener noreferrer"
            className="popup-link"
          >
            Get a free API key at deepgram.com →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-shell w-[360px] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight text-slate-50">PageReader</h1>
        <span className={`text-xs font-medium ${saved ? "text-emerald-300" : "text-slate-500"}`}>
          {saved ? "Saved ✓" : "Ready"}
        </span>
      </div>

      <div className="space-y-3">
        <section className="popup-card space-y-3">
          <div>
            <h2 className="popup-section-title">Playback</h2>
            <p className="popup-section-subtitle">Set default voice, speed, engine, and player mode.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="voice-select" className="popup-label">
              Voice
            </label>
            <select
              id="voice-select"
              value={voice}
              onChange={(e) => void handleVoiceChange(e.target.value)}
              className="popup-select"
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

          <div className="space-y-1.5">
            <label htmlFor="speed-range" className="popup-label">
              Default Speed: {speed}x
            </label>
            <input
              id="speed-range"
              type="range"
              min="0.5"
              max="2"
              step="0.25"
              value={speed}
              onChange={(e) => void handleSpeedChange(parseFloat(e.target.value))}
              className="w-full accent-sky-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label htmlFor="engine-select" className="popup-label">
                Engine
              </label>
              <select
                id="engine-select"
                value={playbackEngine}
                onChange={(e) => void handleEngineChange(e.target.value as PlaybackEngine)}
                className="popup-select"
              >
                <option value="stable">Cached replay</option>
                <option value="progressive">Streaming</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="mode-select" className="popup-label">
                Player Mode
              </label>
              <select
                id="mode-select"
                value={playerMode}
                onChange={(e) => void handleModeChange(e.target.value as "docked" | "floating")}
                className="popup-select"
              >
                <option value="docked">Docked</option>
                <option value="floating">Floating</option>
              </select>
            </div>
          </div>
        </section>

        <section className="popup-card space-y-3">
          <div>
            <h2 className="popup-section-title">Visibility & exclusions</h2>
            <p className="popup-section-subtitle">Control default visibility and site exclusions.</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-700/80 bg-slate-900/55 px-3 py-2">
            <span className="text-sm text-slate-300">Player visible by default</span>
            <button
              type="button"
              onClick={() => void handleVisibleChange(!playerVisible)}
              className={`rounded px-2 py-1 text-xs font-semibold ${
                playerVisible
                  ? "bg-sky-500 text-slate-950 hover:bg-sky-400"
                  : "bg-slate-700 text-slate-100 hover:bg-slate-600"
              }`}
            >
              {playerVisible ? "On" : "Off"}
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="popup-label">Site exclusions</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={excludeInput}
                onChange={(e) => {
                  setExcludeInput(e.target.value);
                  if (excludeError) setExcludeError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && void handleAddExcludedSite()}
                placeholder="example.com or URL"
                className="popup-input"
              />
              <button type="button" onClick={() => void handleAddExcludedSite()} className="popup-secondary-button">
                Add
              </button>
            </div>
            {excludeError && <p className="popup-error">{excludeError}</p>}

            {excludedSites.length === 0 ? (
              <p className="text-xs text-slate-400">No excluded sites.</p>
            ) : (
              <div className="max-h-28 space-y-1 overflow-y-auto">
                {excludedSites.map((site) => (
                  <div
                    key={site}
                    className="flex items-center justify-between gap-2 rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-1"
                  >
                    <span className="truncate text-xs text-slate-200">{site}</span>
                    <button
                      type="button"
                      onClick={() => void handleRemoveExcludedSite(site)}
                      className="text-xs font-medium text-rose-300 hover:text-rose-200"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="popup-card space-y-3">
          <div>
            <h2 className="popup-section-title">Cache</h2>
            <p className="popup-section-subtitle">
              {cacheEntries} file(s), {formatBytes(cacheBytes)} used of {budgetMb} MB budget.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleClearCache()}
            disabled={clearingCache}
            className="popup-secondary-button w-full justify-center"
          >
            {clearingCache ? "Clearing..." : "Clear audio cache"}
          </button>
        </section>

        <section className="popup-card space-y-3">
          <div>
            <h2 className="popup-section-title">API key</h2>
            <p className="popup-section-subtitle">Connected key: ••••{apiKey.slice(-4)}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleRemoveKey()}
            className="text-left text-xs font-medium text-rose-300 hover:text-rose-200"
          >
            Remove
          </button>
        </section>
      </div>
    </div>
  );
}

export default App;
