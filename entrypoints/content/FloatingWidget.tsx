import { useState, useEffect, useCallback, useRef } from "react";
import { AudioPlayer, PlaybackState } from "@/lib/audio";
import { extractPageContent, getReadableLength } from "@/lib/extractor";
import { getApiKey, getVoice, setVoice, getSpeed, setWidgetPosition, getWidgetPosition } from "@/lib/storage";
import { VOICES } from "@/lib/deepgram";
import { highlightChunk, clearHighlights } from "@/lib/highlighter";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function FloatingWidget() {
  const [state, setState] = useState<PlaybackState>("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(true);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [dragging, setDragging] = useState(false);
  const [contentInfo, setContentInfo] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [voice, setVoiceState] = useState("aura-asteria-en");
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);

  const audioRef = useRef<AudioPlayer | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const chunksRef = useRef<string[]>([]);

  // Initialize audio player
  useEffect(() => {
    audioRef.current = new AudioPlayer({
      onStateChange: (newState) => {
        setState(newState);
        if (newState === "idle") {
          clearHighlights();
          chunksRef.current = [];
        }
      },
      onProgress: (current, total) => setProgress({ current, total }),
      onError: setError,
      onChunkChange: (chunkIndex) => {
        const chunks = audioRef.current?.getChunks() || [];
        chunksRef.current = chunks;
        if (chunks[chunkIndex]) {
          highlightChunk(chunks[chunkIndex]);
        }
      },
    });

    // Load saved position
    getWidgetPosition().then((pos) => {
      if (pos) setPosition(pos);
    });

    // Check API key
    getApiKey().then((key) => setHasApiKey(!!key));

    // Load saved voice
    getVoice().then(setVoiceState);

    // Get content info
    const content = extractPageContent();
    if (content) {
      setContentInfo(getReadableLength(content.textContent));
    }

    return () => {
      audioRef.current?.stop();
      clearHighlights();
    };
  }, []);

  // Auto-hide logic
  useEffect(() => {
    if (state === "idle" && !expanded && !dragging) {
      hideTimeoutRef.current = setTimeout(() => setVisible(false), 3000);
    } else {
      setVisible(true);
    }
    return () => clearTimeout(hideTimeoutRef.current);
  }, [state, expanded, dragging]);

  // Show on scroll/mouse move
  useEffect(() => {
    const handleActivity = () => {
      setVisible(true);
      clearTimeout(hideTimeoutRef.current);
      if (state === "idle" && !expanded) {
        hideTimeoutRef.current = setTimeout(() => setVisible(false), 3000);
      }
    };

    window.addEventListener("scroll", handleActivity, { passive: true });
    window.addEventListener("mousemove", handleActivity, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleActivity);
      window.removeEventListener("mousemove", handleActivity);
    };
  }, [state, expanded]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = dragStartRef.current.x - e.clientX;
      const dy = dragStartRef.current.y - e.clientY;
      const newX = Math.max(0, Math.min(window.innerWidth - 60, dragStartRef.current.posX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 60, dragStartRef.current.posY + dy));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setDragging(false);
      setWidgetPosition(position);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, position]);

  const handlePlay = useCallback(async () => {
    if (!audioRef.current) return;

    const apiKey = await getApiKey();
    if (!apiKey) {
      setHasApiKey(false);
      setError("No API key. Click extension icon to add one.");
      return;
    }

    const content = extractPageContent();
    if (!content) {
      setError("Could not extract page content");
      return;
    }

    setError(null);
    const savedSpeed = await getSpeed();
    setSpeed(savedSpeed);
    audioRef.current.setSpeed(savedSpeed);

    await audioRef.current.play(content.textContent, { apiKey, voice });
  }, [voice]);

  const handleToggle = useCallback(() => {
    if (state === "idle") {
      handlePlay();
    } else if (state === "playing" || state === "paused") {
      audioRef.current?.togglePlayPause();
    }
  }, [state, handlePlay]);

  const handleStop = useCallback(() => {
    audioRef.current?.stop();
    clearHighlights();
  }, []);

  const handleSpeedChange = useCallback(() => {
    const currentIndex = SPEEDS.indexOf(speed);
    const nextIndex = (currentIndex + 1) % SPEEDS.length;
    const newSpeed = SPEEDS[nextIndex];
    setSpeed(newSpeed);
    audioRef.current?.setSpeed(newSpeed);
  }, [speed]);

  const handleVoiceChange = useCallback(async (newVoice: string) => {
    setVoiceState(newVoice);
    await setVoice(newVoice);
    setShowVoiceMenu(false);
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        handleToggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggle]);

  const isActive = state !== "idle";
  const showExpanded = expanded || isActive;

  return (
    <div
      ref={widgetRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => {
        if (!isActive) setExpanded(false);
        setShowVoiceMenu(false);
      }}
      style={{
        position: "fixed",
        right: `${position.x}px`,
        bottom: `${position.y}px`,
        zIndex: 2147483647,
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.9)",
        transition: "opacity 0.2s, transform 0.2s",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: showExpanded ? "8px 12px" : "0",
          background: "rgba(23, 23, 23, 0.95)",
          backdropFilter: "blur(8px)",
          borderRadius: showExpanded ? "24px" : "50%",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.1)",
          cursor: dragging ? "grabbing" : "grab",
          transition: "all 0.2s ease",
          width: showExpanded ? "auto" : "48px",
          height: showExpanded ? "auto" : "48px",
          justifyContent: "center",
        }}
      >
        {/* Play/Pause Button */}
        <button
          onClick={handleToggle}
          disabled={state === "loading"}
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            border: "none",
            background: state === "loading" ? "#4a4a4a" : "#6366f1",
            color: "white",
            cursor: state === "loading" ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            transition: "background 0.2s",
          }}
          title={state === "idle" ? "Play" : state === "playing" ? "Pause" : "Resume"}
        >
          {state === "loading" ? (
            <span style={{ animation: "spin 1s linear infinite" }}>⟳</span>
          ) : state === "playing" ? (
            "❚❚"
          ) : (
            "▶"
          )}
        </button>

        {showExpanded && (
          <>
            {/* Seekable progress bar */}
            {isActive && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#9ca3af", fontSize: "12px" }}>
                <div
                  style={{
                    width: "80px",
                    height: "8px",
                    background: "#374151",
                    borderRadius: "4px",
                    overflow: "hidden",
                    cursor: "pointer",
                    position: "relative",
                  }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const percent = x / rect.width;
                    const targetChunk = Math.floor(percent * progress.total);
                    audioRef.current?.seekTo(Math.min(targetChunk, progress.total - 1));
                  }}
                  title="Click to seek"
                >
                  {/* Chunk markers */}
                  {progress.total > 1 && Array.from({ length: progress.total - 1 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: `${((i + 1) / progress.total) * 100}%`,
                        top: 0,
                        bottom: 0,
                        width: "1px",
                        background: "rgba(255,255,255,0.2)",
                      }}
                    />
                  ))}
                  {/* Progress fill */}
                  <div
                    style={{
                      width: `${progress.total ? ((progress.current + 1) / progress.total) * 100 : 0}%`,
                      height: "100%",
                      background: "#6366f1",
                      transition: "width 0.3s",
                      borderRadius: "4px",
                    }}
                  />
                </div>
                <span>{progress.current + 1}/{progress.total}</span>
              </div>
            )}

            {/* Speed button */}
            <button
              onClick={handleSpeedChange}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "none",
                background: "#374151",
                color: "#e5e7eb",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 500,
              }}
              title="Change speed"
            >
              {speed}x
            </button>

            {/* Voice selector */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowVoiceMenu(!showVoiceMenu)}
                style={{
                  padding: "4px 8px",
                  borderRadius: "4px",
                  border: "none",
                  background: "#374151",
                  color: "#e5e7eb",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 500,
                  maxWidth: "80px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title="Change voice"
              >
                {VOICES.find(v => v.id === voice)?.name.split(" ")[0] || "Voice"}
              </button>
              {showVoiceMenu && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    right: "0",
                    marginBottom: "4px",
                    background: "rgba(23, 23, 23, 0.98)",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                    maxHeight: "200px",
                    overflowY: "auto",
                    minWidth: "160px",
                  }}
                >
                  {VOICES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => handleVoiceChange(v.id)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "6px 12px",
                        border: "none",
                        background: v.id === voice ? "#4f46e5" : "transparent",
                        color: "#e5e7eb",
                        cursor: "pointer",
                        fontSize: "11px",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Stop button */}
            {isActive && (
              <button
                onClick={handleStop}
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "4px",
                  border: "none",
                  background: "#374151",
                  color: "#e5e7eb",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                }}
                title="Stop"
              >
                ■
              </button>
            )}

            {/* Content info */}
            {!isActive && contentInfo && (
              <span style={{ color: "#6b7280", fontSize: "11px" }}>{contentInfo}</span>
            )}
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            right: "0",
            marginBottom: "8px",
            padding: "8px 12px",
            background: "#dc2626",
            color: "white",
            borderRadius: "8px",
            fontSize: "12px",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          {error}
        </div>
      )}

      {/* No API key warning */}
      {!hasApiKey && !error && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            right: "0",
            marginBottom: "8px",
            padding: "8px 12px",
            background: "#f59e0b",
            color: "black",
            borderRadius: "8px",
            fontSize: "12px",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          Click extension icon to add API key
        </div>
      )}

      {/* Spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
