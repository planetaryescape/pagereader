import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Gauge,
  Loader2,
  Pause,
  Play,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { AudioPlayer, PlaybackPhase, PlaybackState } from "@/lib/audio";
import { canonicalizePageUrl, getReadableLength, hashContent } from "@/lib/extractor";
import { VOICES } from "@/lib/deepgram";
import { clearHighlights, highlightRange } from "@/lib/highlighter";
import { getPageTextModel } from "@/lib/page-text-model";
import {
  getApiKey,
  getAudioCacheBudgetMb,
  getPlaybackEngine,
  getSpeed,
  getVoice,
  getWidgetPosition,
  setSpeed,
  setVoice,
  setWidgetPosition,
} from "@/lib/storage";
import "./reader-player.css";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SPACER_ID = "pagereader-docked-spacer";
const PENDING_PHASES: PlaybackPhase[] = ["preparing", "connecting", "buffering", "stopping"];

export interface ReaderPlayerProps {
  mode: "docked" | "floating";
  visible: boolean;
  onVisibleChange: (nextVisible: boolean) => void;
  currentHostname?: string;
  onExcludeCurrentSite?: () => void;
  onCloseForTab?: () => void;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function ensureDockSpacer(height: number): void {
  let spacer = document.getElementById(SPACER_ID);
  if (!spacer) {
    spacer = document.createElement("div");
    spacer.id = SPACER_ID;
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.width = "100%";
    spacer.style.pointerEvents = "none";
    document.body.appendChild(spacer);
  }
  spacer.style.height = `${height}px`;
}

function removeDockSpacer(): void {
  document.getElementById(SPACER_ID)?.remove();
}

function getPhaseLabel(phase: PlaybackPhase): string {
  switch (phase) {
    case "preparing":
      return "Preparing";
    case "connecting":
      return "Connecting";
    case "buffering":
      return "Buffering";
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
    case "stopping":
      return "Stopping";
    case "error":
      return "Error";
    case "idle":
    default:
      return "Ready";
  }
}

function getPhaseDetail(phase: PlaybackPhase): string | null {
  switch (phase) {
    case "preparing":
      return "Preparing page audio...";
    case "connecting":
      return "Connecting to speech stream...";
    case "buffering":
      return "Buffering playback...";
    case "playing":
      return null;
    case "paused":
      return "Playback paused.";
    case "stopping":
      return "Stopping playback...";
    case "error":
      return "Playback failed. Check message below.";
    case "idle":
    default:
      return null;
  }
}

function getErrorRecoveryHint(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("decode")) {
    return "Try another voice or speed, then press Play again.";
  }
  if (lower.includes("network")) {
    return "Check connection and retry.";
  }
  if (lower.includes("api key") || lower.includes("token")) {
    return "Open extension settings and verify your DeepGram API key.";
  }
  if (lower.includes("extract")) {
    return "This page may block readable extraction. Try Reader Mode or another page.";
  }
  return "Try Play again. If it repeats, reload page and switch voice.";
}

export function ReaderPlayer({
  mode,
  visible,
  currentHostname,
  onExcludeCurrentSite,
  onCloseForTab,
}: ReaderPlayerProps) {
  const [state, setState] = useState<PlaybackState>("idle");
  const [phase, setPhase] = useState<PlaybackPhase>("idle");
  const [phaseDetail, setPhaseDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [highlightNotice, setHighlightNotice] = useState<string | null>(null);
  const [isStartPending, setIsStartPending] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [voice, setVoiceState] = useState("aura-2-thalia-en");
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [contentInfo, setContentInfo] = useState<string | null>(null);
  const [progress, setProgress] = useState({ currentSec: 0, totalSec: 0 });
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [dragging, setDragging] = useState(false);

  const audioRef = useRef<AudioPlayer | null>(null);
  const pageTextRef = useRef<ReturnType<typeof getPageTextModel> | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const voiceMenuRef = useRef<HTMLDivElement | null>(null);
  const startupGuardRef = useRef(false);

  useEffect(() => {
    audioRef.current = new AudioPlayer({
      onStateChange: (next) => {
        setState(next);
        if (next === "idle") {
          clearHighlights();
        }
      },
      onPhaseChange: (nextPhase, detail) => {
        setPhase(nextPhase);
        setPhaseDetail(detail || getPhaseDetail(nextPhase));
        startupGuardRef.current = PENDING_PHASES.includes(nextPhase);
        if (!PENDING_PHASES.includes(nextPhase)) {
          setIsStartPending(false);
        }
      },
      onProgress: (currentSec, totalSec) => {
        setProgress({ currentSec, totalSec });
      },
      onError: (msg) => {
        setError(msg);
      },
      onWarning: (msg) => {
        setWarning(msg);
      },
      onTranscriptRange: (startChar, endChar) => {
        const result = highlightRange(startChar, endChar, pageTextRef.current);
        if (!result.matched) {
          setHighlightNotice("Highlight unavailable on this section.");
          return;
        }
        setHighlightNotice(null);
      },
    });

    getApiKey().then((key) => setHasApiKey(!!key));
    getVoice().then(setVoiceState);
    getSpeed().then((saved) => {
      setSpeedState(saved);
      audioRef.current?.setSpeed(saved);
    });
    getWidgetPosition().then((saved) => {
      if (saved) setPosition(saved);
    });

    const model = getPageTextModel();
    if (model) {
      pageTextRef.current = model;
      setContentInfo(getReadableLength(model.textContent));
    }

    return () => {
      audioRef.current?.destroy();
      audioRef.current = null;
      clearHighlights();
      removeDockSpacer();
    };
  }, []);

  useEffect(() => {
    if (mode === "docked" && visible) {
      ensureDockSpacer(116);
      return () => removeDockSpacer();
    }
    removeDockSpacer();
  }, [mode, visible]);

  useEffect(() => {
    if (!showVoiceMenu) return;

    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (voiceMenuRef.current?.contains(target)) return;
      setShowVoiceMenu(false);
    };

    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [showVoiceMenu]);

  const handlePlay = useCallback(async () => {
    if (!audioRef.current) return;
    if (startupGuardRef.current || isStartPending || state === "loading") return;

    startupGuardRef.current = true;
    setIsStartPending(true);
    setPhase("preparing");
    setPhaseDetail("Preparing audio...");
    setError(null);
    setWarning(null);
    setHighlightNotice(null);

    const apiKey = await getApiKey();
    if (!apiKey) {
      setHasApiKey(false);
      setError("No API key. Open extension popup and add one.");
      startupGuardRef.current = false;
      setIsStartPending(false);
      setPhase("error");
      setPhaseDetail(getPhaseDetail("error"));
      return;
    }

    const model = getPageTextModel();
    if (!model) {
      setError("Could not extract readable content from this page.");
      startupGuardRef.current = false;
      setIsStartPending(false);
      setPhase("error");
      setPhaseDetail(getPhaseDetail("error"));
      return;
    }

    pageTextRef.current = model;
    setContentInfo(getReadableLength(model.textContent));

    const [savedSpeed, budgetMb, contentHash, playbackEngine] = await Promise.all([
      getSpeed(),
      getAudioCacheBudgetMb(),
      hashContent(model.textContent),
      getPlaybackEngine(),
    ]);

    setSpeedState(savedSpeed);
    audioRef.current.setSpeed(savedSpeed);

    try {
      await audioRef.current.play(model.textContent, {
        apiKey,
        voice,
        speed: savedSpeed,
        pageUrl: canonicalizePageUrl(window.location.href),
        contentHash,
        cacheBudgetMb: budgetMb,
        playbackEngine,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start playback.");
      setPhase("error");
      setPhaseDetail(getPhaseDetail("error"));
      startupGuardRef.current = false;
      setIsStartPending(false);
    }
  }, [isStartPending, state, voice]);

  const handleTogglePlay = useCallback(() => {
    if (state === "idle") {
      if (startupGuardRef.current || isStartPending || phase === "buffering" || phase === "connecting")
        return;
      void handlePlay();
      return;
    }
    if (state === "loading") return;
    audioRef.current?.togglePlayPause();
  }, [handlePlay, isStartPending, phase, state]);

  const handleStop = useCallback(() => {
    setError(null);
    setWarning(null);
    setHighlightNotice(null);
    startupGuardRef.current = false;
    setIsStartPending(false);
    void audioRef.current?.stop();
    clearHighlights();
  }, []);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    void audioRef.current?.seekToSec(value);
  }, []);

  const handleSpeedChange = useCallback(async () => {
    const currentIndex = SPEEDS.indexOf(speed);
    const nextSpeed = SPEEDS[(currentIndex + 1) % SPEEDS.length];
    setSpeedState(nextSpeed);
    audioRef.current?.setSpeed(nextSpeed);
    await setSpeed(nextSpeed);
  }, [speed]);

  const handleVoiceChange = useCallback(async (nextVoice: string) => {
    setVoiceState(nextVoice);
    await setVoice(nextVoice);
    setShowVoiceMenu(false);
  }, []);

  const startDrag = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (mode !== "floating") return;
      const target = event.target;
      if (target instanceof Element) {
        if (
          target.closest(
            "button, input, select, textarea, a, [role='button'], [data-pr-no-drag='true']"
          )
        ) {
          return;
        }
      } else {
        return;
      }

      setDragging(true);
      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        posX: position.x,
        posY: position.y,
      };
    },
    [mode, position]
  );

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (event: MouseEvent) => {
      const dx = dragStartRef.current.x - event.clientX;
      const dy = dragStartRef.current.y - event.clientY;
      const nextX = Math.max(0, Math.min(window.innerWidth - 360, dragStartRef.current.posX + dx));
      const nextY = Math.max(0, Math.min(window.innerHeight - 150, dragStartRef.current.posY + dy));
      setPosition({ x: nextX, y: nextY });
    };

    const onMouseUp = () => {
      setDragging(false);
      void setWidgetPosition(position);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, position]);

  const startupBusy =
    isStartPending ||
    state === "loading" ||
    phase === "preparing" ||
    phase === "connecting" ||
    phase === "buffering" ||
    phase === "stopping";
  const isActive = state === "playing" || state === "paused" || state === "loading";
  const duration = progress.totalSec || 0;
  const current = Math.min(progress.currentSec || 0, duration || progress.currentSec || 0);
  const phaseLabel = getPhaseLabel(phase);
  const playLabel = startupBusy ? "Loading..." : state === "playing" ? "Pause" : "Play";

  const containerStyle = useMemo<CSSProperties>(() => {
    if (mode === "docked") {
      return {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
      };
    }

    return {
      position: "fixed",
      right: `${position.x}px`,
      bottom: `${position.y}px`,
      zIndex: 2147483647,
      width: "360px",
    };
  }, [mode, position]);

  if (!visible) return null;

  return (
    <div
      className={`pr-player pr-player--${mode} ${dragging ? "is-dragging" : ""}`}
      style={containerStyle}
      onMouseDown={startDrag}
    >
      <div className="pr-header">
        <div className="pr-meta">
          <div className="pr-content-info">{contentInfo || "Ready to read this page"}</div>
          <span className={`pr-phase-chip pr-phase-chip--${phase}`}>{phaseLabel}</span>
        </div>
        <div className="pr-header-actions">
          {onExcludeCurrentSite && (
            <button
              type="button"
              className="pr-ghost-button"
              data-pr-no-drag="true"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onExcludeCurrentSite();
              }}
              title={currentHostname ? `Exclude ${currentHostname}` : undefined}
            >
              <Ban size={13} />
              Don't show on this site
            </button>
          )}
          {onCloseForTab && (
            <button
              type="button"
              className="pr-ghost-button"
              data-pr-no-drag="true"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onCloseForTab();
              }}
              aria-label="Close reader"
            >
              <X size={13} />
              Close
            </button>
          )}
        </div>
      </div>

      {phaseDetail && <div className="pr-phase-detail">{phaseDetail}</div>}

      <div className="pr-controls">
        <button
          type="button"
          className={`pr-primary-button ${startupBusy ? "is-loading" : ""}`}
          onClick={handleTogglePlay}
          disabled={startupBusy}
          aria-label={playLabel}
        >
          {startupBusy ? (
            <Loader2 size={16} className="pr-spin" />
          ) : state === "playing" ? (
            <Pause size={16} />
          ) : (
            <Play size={16} />
          )}
          {playLabel}
        </button>

        <button
          type="button"
          className="pr-secondary-button"
          onClick={handleStop}
          disabled={!isActive}
          aria-label="Stop playback"
        >
          <Square size={14} />
          Stop
        </button>

        <button
          type="button"
          className="pr-secondary-button"
          onClick={() => void handleSpeedChange()}
          aria-label="Change playback speed"
        >
          <Gauge size={14} />
          {speed}x
        </button>

        <div className="pr-voice-menu" ref={voiceMenuRef}>
          <button
            type="button"
            className="pr-secondary-button"
            onClick={() => setShowVoiceMenu((prev) => !prev)}
            aria-label="Choose voice"
          >
            <Volume2 size={14} />
            {VOICES.find((item) => item.id === voice)?.name.split(" ")[0] || "Voice"}
          </button>
          {showVoiceMenu && (
            <div className="pr-voice-dropdown">
              {VOICES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`pr-voice-option ${item.id === voice ? "is-active" : ""}`}
                  onClick={() => void handleVoiceChange(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pr-timeline">
        <span className="pr-time">{formatTime(current)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={0.1}
          value={duration > 0 ? current : 0}
          onChange={handleSeek}
          aria-label="Seek playback"
        />
        <span className="pr-time">{formatTime(duration)}</span>
      </div>

      {!hasApiKey && <div className="pr-warning-inline">Add API key in extension popup.</div>}
      {highlightNotice && !error && <div className="pr-notice-inline">{highlightNotice}</div>}
      {warning && !error && <div className="pr-warning-inline">{warning}</div>}
      {error && (
        <>
          <div className="pr-error-inline">
            <AlertTriangle size={14} />
            {error}
          </div>
          <div className="pr-error-hint">{getErrorRecoveryHint(error)}</div>
        </>
      )}
    </div>
  );
}
