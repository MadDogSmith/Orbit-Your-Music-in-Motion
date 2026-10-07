import { useEffect, useRef, useState } from "react";
import {
  connectSpotify,
  handleSpotifyCallback,
  isConnected,
  spotifyRequest,
  disconnectSpotify
} from "./spotify";
import "./App.css";

const DEFAULT_COLORS = {
  light: "#d1a6ae",
  middle: "#ac7c94",
  dark: "#381d36"
};

function formatTime(milliseconds = 0) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// A tiny colour palette extractor. No ColorThief dependency needed.
function extractAlbumColors(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, 48, 48);
  const pixels = ctx.getImageData(0, 0, 48, 48).data;
  const buckets = new Map();

  for (let i = 0; i < pixels.length; i += 16) {
    const [r, g, b, a] = pixels.slice(i, i + 4);
    if (a < 200) continue;
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    if (brightness < 18 || brightness > 242) continue;
    // Group similar pixels so a single unusual pixel doesn't dominate.
    const key = [r, g, b].map(v => Math.min(255, Math.round(v / 32) * 32)).join(",");
    const item = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    item.count++;
    item.r += r;
    item.g += g;
    item.b += b;
    buckets.set(key, item);
  }

  const palette = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 14)
    .map(item => [item.r / item.count, item.g / item.count, item.b / item.count]);
  if (!palette.length) return null;

  const brightness = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
  const sorted = [...palette].sort((a, b) => brightness(b) - brightness(a));
  const hex = rgb => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  return {
    light: hex(sorted[0]),
    middle: hex(sorted[Math.floor(sorted.length / 2)]),
    dark: hex(sorted[sorted.length - 1])
  };
}

export default function App() {
  const [connected, setConnected] = useState(isConnected());
  const [song, setSong] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [albumColors, setAlbumColors] = useState(DEFAULT_COLORS);
  const [launching, setLaunching] = useState(true);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const refreshing = useRef(false);
  const commanding = useRef(false);
  const songRef = useRef(null);
  const progressRef = useRef(0);
  const playingRef = useRef(false);
  const draggingRef = useRef(false);
  const refreshRef = useRef(null);
  const [volume, setVolume] = useState(50);
  const [previousVolume, setPreviousVolume] = useState(50);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const volumeTimerRef = useRef(null);

  songRef.current = song;
  playingRef.current = playing;
  refreshRef.current = refreshSong;

  useEffect(() => {
    handleSpotifyCallback()
      .then(result => { if (result) setConnected(true); })
      .catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    const leaveTimer = setTimeout(() => {
      setSplashLeaving(true);
    }, 1100);

    const finishTimer = setTimeout(() => {
      setLaunching(false);
    }, 1550);

    return () => {
      clearTimeout(leaveTimer);
      clearTimeout(finishTimer);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(volumeTimerRef.current);
    };
  }, []);

  async function refreshSong() {
    if (refreshing.current || commanding.current) return;
    refreshing.current = true;
    try {
      const data = await spotifyRequest("/me/player");
      if (commanding.current) return;
      if (!data?.item) {
        setSong(null);
        setPlaying(false);
        return;
      }
      const next = {
        id: data.item.id,
        title: data.item.name,
        artist: (data.item.artists || []).map(artist => artist.name).join(", "),
        cover: data.item.album?.images?.[0]?.url,
        duration: data.item.duration_ms ?? 0
      };
      const changed = songRef.current?.id !== next.id;
      songRef.current = next;
      setSong(previous =>
        previous?.id === next.id &&
          previous?.cover === next.cover &&
          previous?.title === next.title &&
          previous?.artist === next.artist &&
          previous?.duration === next.duration
          ? previous : next
      );
      playingRef.current = Boolean(data.is_playing);
      setPlaying(playingRef.current);
      if (data.device?.volume_percent != null) {
        setVolume(data.device.volume_percent);

        if (data.device.volume_percent > 0) {
          setPreviousVolume(data.device.volume_percent);
        }
      }

      setShuffle(Boolean(data.shuffle_state));
      setRepeatMode(data.repeat_state || "off");

      if (!draggingRef.current || changed) {
        progressRef.current = data.progress_ms ?? 0;
        setProgress(progressRef.current);
      }
      setError("");
    } catch (err) {
      console.error("Spotify refresh:", err);
      setError(err.message);
    } finally {
      refreshing.current = false;
    }
  }

  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    let timer;
    async function poll() {
      if (stopped) return;
      if (document.visibilityState === "visible") await refreshRef.current?.();
      if (stopped) return;
      const current = songRef.current;
      const remaining = current ? current.duration - progressRef.current : Infinity;
      timer = setTimeout(poll, playingRef.current && remaining <= 10000 ? 1000 : 3000);
    }
    function visible() {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        poll();
      }
    }
    poll();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [connected]);

  useEffect(() => {
    if (!playing || !song) return;
    const timer = setInterval(() => {
      if (draggingRef.current) return;
      progressRef.current = Math.min(progressRef.current + 1000, song.duration);
      setProgress(progressRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, song?.id, song?.duration]);

  // Extract colours when the artwork URL changes, not every progress tick.
  useEffect(() => {
    if (!song?.cover) {
      setAlbumColors(DEFAULT_COLORS);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      try {
        const colors = extractAlbumColors(image);
        if (colors) setAlbumColors(colors);
      } catch (err) {
        // Spotify artwork must allow cross-origin canvas access.
        console.warn("Could not read album colours:", err);
      }
    };
    image.onerror = () => console.warn("Could not load album artwork for colours.");
    image.src = song.cover;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [song?.cover]);

  async function playback(path, method = "POST") {
    if (commanding.current) return;
    commanding.current = true;
    setBusy(true);
    setError("");
    try {
      await spotifyRequest(path, { method });
    } catch (err) {
      setError(err.message);
    } finally {
      commanding.current = false;
      setBusy(false);
      setTimeout(() => refreshRef.current?.(), 350);
      setTimeout(() => refreshRef.current?.(), 1200);
    }
  }

  function togglePlayback() {
    if (commanding.current) return;
    const wasPlaying = playingRef.current;
    playingRef.current = !wasPlaying;
    setPlaying(!wasPlaying);
    playback(wasPlaying ? "/me/player/pause" : "/me/player/play", "PUT");
  }

  async function seek(position) {
    const next = Math.round(position);
    progressRef.current = next;
    setProgress(next);
    try {
      await spotifyRequest(`/me/player/seek?position_ms=${next}`, { method: "PUT" });
    } catch (err) {
      setError(err.message);
    }
  }

  function finishDragging() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    seek(progressRef.current);
  }
  // ==========================================
  // VOLUME
  // ==========================================

  function resetVolumeTimer() {
    clearTimeout(volumeTimerRef.current);

    volumeTimerRef.current = setTimeout(() => {
      setVolumeOpen(false);
    }, 3000);
  }

  function toggleVolumePopup() {
    setVolumeOpen(open => {
      const nextOpen = !open;

      if (nextOpen) {
        resetVolumeTimer();
      } else {
        clearTimeout(volumeTimerRef.current);
      }

      return nextOpen;
    });
  }

  function updateVolumeLocally(newVolume) {
    const nextVolume = Number(newVolume);

    setVolume(nextVolume);

    if (nextVolume > 0) {
      setPreviousVolume(nextVolume);
    }
  }

  async function commitVolume(newVolume) {
    const nextVolume = Math.max(
      0,
      Math.min(100, Math.round(Number(newVolume)))
    );

    setVolume(nextVolume);

    if (nextVolume > 0) {
      setPreviousVolume(nextVolume);
    }

    try {
      setError("");

      await spotifyRequest(
        `/me/player/volume?volume_percent=${nextVolume}`,
        {
          method: "PUT"
        }
      );
    } catch (err) {
      console.error("Volume error:", err);
      setError(err.message);
    }

    resetVolumeTimer();
  }

  async function toggleMute() {
    const oldVolume = volume;

    const nextVolume =
      oldVolume === 0
        ? Math.max(previousVolume, 25)
        : 0;

    if (oldVolume > 0) {
      setPreviousVolume(oldVolume);
    }

    setVolume(nextVolume);

    try {
      setError("");

      await spotifyRequest(
        `/me/player/volume?volume_percent=${nextVolume}`,
        {
          method: "PUT"
        }
      );
    } catch (err) {
      console.error("Mute error:", err);

      setVolume(oldVolume);
      setError(err.message);
    }

    resetVolumeTimer();
  }

  function getVolumeIcon() {
    if (volume === 0) return "🔇";
    if (volume <= 35) return "🔈";
    if (volume <= 70) return "🔉";

    return "🔊";
  }


  // ==========================================
  // SHUFFLE
  // ==========================================

  async function toggleShuffle() {
    const oldShuffle = shuffle;
    const nextShuffle = !shuffle;

    setShuffle(nextShuffle);

    try {
      setError("");

      await spotifyRequest(
        `/me/player/shuffle?state=${nextShuffle}`,
        {
          method: "PUT"
        }
      );
    } catch (err) {
      setShuffle(oldShuffle);
      setError(err.message);
    }
  }


  // ==========================================
  // REPEAT
  // ==========================================

  async function cycleRepeat() {
    const oldMode = repeatMode;

    let nextMode;

    if (repeatMode === "off") {
      nextMode = "context";
    } else if (repeatMode === "context") {
      nextMode = "track";
    } else {
      nextMode = "off";
    }

    setRepeatMode(nextMode);

    try {
      setError("");

      await spotifyRequest(
        `/me/player/repeat?state=${nextMode}`,
        {
          method: "PUT"
        }
      );
    } catch (err) {
      setRepeatMode(oldMode);
      setError(err.message);
    }
  }

  function getVolumeIcon() {
    if (volume === 0) return "🔇";
    if (volume <= 35) return "🔈";
    if (volume <= 70) return "🔉";

    return "🔊";
  }


  // ==========================================
  // SHUFFLE
  // ==========================================

  async function toggleShuffle() {
    const oldShuffle = shuffle;
    const nextShuffle = !shuffle;

    setShuffle(nextShuffle);

    try {
      await spotifyRequest(
        `/me/player/shuffle?state=${nextShuffle}`,
        {
          method: "PUT"
        }
      );
    } catch (err) {
      setShuffle(oldShuffle);
      setError(err.message);
    }
  }


  // ==========================================
  // REPEAT
  // ==========================================

  async function cycleRepeat() {
    const oldMode = repeatMode;

    let nextMode;

    if (repeatMode === "off") {
      nextMode = "context";
    } else if (repeatMode === "context") {
      nextMode = "track";
    } else {
      nextMode = "off";
    }

    setRepeatMode(nextMode);

    try {
      await spotifyRequest(
        `/me/player/repeat?state=${nextMode}`,
        {
          method: "PUT"
        }
      );
    } catch (err) {
      setRepeatMode(oldMode);
      setError(err.message);
    }
  }

  function logout() {
    disconnectSpotify();
    setSidebarOpen(false);
    setSong(null);
    setPlaying(false);
    setProgress(0);
    setAlbumColors(DEFAULT_COLORS);
    setError("");
    setConnected(false);
  }

  function quitOrbit() {
    window.orbit?.quit?.();
  }
  // ==========================================
  // SPLASH SCREEN
  // ==========================================

  if (launching) {
    return (
      <main
        className={`orbit-splash ${splashLeaving ? "leaving" : ""
          }`}
      >
        <div className="splash-glow splash-glow-one" />
        <div className="splash-glow splash-glow-two" />

        <div className="splash-content">
          <div className="splash-record">
            <div className="splash-record-grooves" />

            <div className="splash-record-label">
              <div className="splash-record-hole" />
            </div>
          </div>

          <div className="splash-brand">
            <h1>ORBIT</h1>
            <p>Your music, in motion.</p>
          </div>
        </div>
      </main>
    );
  }


  // ==========================================
  // WELCOME / CONNECT SPOTIFY SCREEN
  // ==========================================

  if (!connected) {
    return (
      <main className="welcome-screen">
        <div className="welcome-background">
          <div className="welcome-orb welcome-orb-one" />
          <div className="welcome-orb welcome-orb-two" />
          <div className="welcome-orb welcome-orb-three" />
        </div>

        <div className="welcome-content">
          <div className="welcome-brand">
            <span className="welcome-eyebrow">
              MUSIC IN MOTION
            </span>

            <h1>ORBIT</h1>

            <p>
              Your music deserves more than a progress bar.
            </p>
          </div>

          <div className="welcome-record-wrapper">
            <div className="welcome-record">
              <div className="welcome-record-shine" />

              <div className="welcome-record-label">
                <span>ORBIT</span>
                <div className="welcome-record-hole" />
              </div>
            </div>
          </div>

          <div className="welcome-actions">
            <button
              className="spotify-connect-button"
              onClick={async () => {
                try {
                  setError("");

                  await connectSpotify();

                  setConnected(true);
                } catch (err) {
                  setError(err.message);
                }
              }}
            >
              <span className="spotify-connect-icon">
                ♪
              </span>

              <span>Connect Spotify</span>

              <span className="spotify-connect-arrow">
                →
              </span>
            </button>

            <p className="welcome-note">
              Connect your Spotify account to begin.
            </p>
          </div>
        </div>

        {error && (
          <p
            className="error-message"
            role="alert"
          >
            {error}
          </p>
        )}
      </main>
    );
  }


  // ==========================================
  // MAIN PLAYER
  // ==========================================

  return (
    <main
      className="player"
      style={{
        "--album-light": albumColors.light,
        "--album-middle": albumColors.middle,
        "--album-dark": albumColors.dark
      }}
    >
      <button
        className={`menu-button ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(open => !open)}
        aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        aria-expanded={sidebarOpen}
      >
        <span />
        <span />
        <span />
      </button>

      <button
        className={`sidebar-backdrop ${sidebarOpen ? "visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-label="Close menu"
        tabIndex={sidebarOpen ? 0 : -1}
      />

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>Orbit</h2>
          <p>Music in Motion</p>
        </div>

        <div className="sidebar-content">
          <button
            className="sidebar-item"
            onClick={logout}
          >
            <span className="sidebar-icon">↪</span>

            <span>
              <strong>Log out</strong>
              <small>Disconnect Spotify</small>
            </span>
          </button>
        </div>

        <div className="sidebar-footer">
          <button
            className="sidebar-item quit"
            onClick={quitOrbit}
          >
            <span className="sidebar-icon">⏻</span>

            <span>
              <strong>Quit Orbit</strong>
              <small>Close application</small>
            </span>
          </button>
        </div>
      </aside>

      {song ? (
        <div className="player-layout">
          <div className="record-container">
            <div
              className={`record ${playing ? "spinning" : ""
                }`}
            >
              <img
                src={song.cover}
                alt={`${song.title} album cover`}
              />

              <div className="record-hole" />
            </div>
          </div>

          <div className="music-details">
            <div className="song-info">
              <h1>{song.title}</h1>
              <p>{song.artist}</p>
            </div>

            <div className="progress-section">
              <input
                type="range"
                min="0"
                max={song.duration}
                value={progress}
                onPointerDown={() => {
                  draggingRef.current = true;
                }}
                onPointerUp={finishDragging}
                onPointerCancel={finishDragging}
                onChange={event => {
                  progressRef.current =
                    Number(event.target.value);

                  setProgress(
                    progressRef.current
                  );
                }}
                onKeyUp={event => {
                  if (
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "Home",
                      "End"
                    ].includes(event.key)
                  ) {
                    seek(
                      progressRef.current
                    );
                  }
                }}
                aria-label="Song progress"
              />

              <div className="timestamps">
                <span>
                  {formatTime(progress)}
                </span>

                <span>
                  {formatTime(song.duration)}
                </span>
              </div>
            </div>

            <div className="playback-controls">

              <div className="controls">

                {/* SHUFFLE */}
                <button
                  className={`secondary-control ${shuffle ? "active" : ""
                    }`}
                  disabled={busy}
                  aria-label={
                    shuffle
                      ? "Turn shuffle off"
                      : "Turn shuffle on"
                  }
                  aria-pressed={shuffle}
                  onClick={toggleShuffle}
                >
                  <svg
                    className="control-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 7h2.5c2.2 0 3.5 1.2 5 3.5l2 3c1.5 2.3 2.8 3.5 5 3.5H21"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    <path
                      d="M18 14l3 3-3 3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    <path
                      d="M4 17h2.5c1.7 0 2.9-.7 4-2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />

                    <path
                      d="M14 9c1.2-1.3 2.5-2 4.5-2H21"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />

                    <path
                      d="M18 4l3 3-3 3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>


                {/* PREVIOUS */}
                <button
                  disabled={busy}
                  aria-label="Previous song"
                  onClick={() =>
                    playback("/me/player/previous")
                  }
                >
                  ⏮
                </button>


                {/* PLAY / PAUSE */}
                <button
                  disabled={busy}
                  className="play-button"
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={togglePlayback}
                >
                  {playing ? "Ⅱ" : "▶"}
                </button>


                {/* NEXT */}
                <button
                  disabled={busy}
                  aria-label="Next song"
                  onClick={() =>
                    playback("/me/player/next")
                  }
                >
                  ⏭
                </button>


                {/* REPEAT */}
                <button
                  className={`secondary-control ${repeatMode !== "off"
                    ? "active"
                    : ""
                    }`}
                  disabled={busy}
                  aria-label={`Repeat: ${repeatMode}`}
                  onClick={cycleRepeat}
                >
                  <span className="repeat-icon">
                    <svg
                      className="control-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M17 2l4 4-4 4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      <path
                        d="M3 11V9a3 3 0 0 1 3-3h18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />

                      <path
                        d="M7 22l-4-4 4-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      <path
                        d="M21 13v2a3 3 0 0 1-3 3H3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>

                    {repeatMode === "track" && (
                      <span className="repeat-one">
                        1
                      </span>
                    )}
                  </span>
                </button>

              </div>


              {/* VOLUME */}
              <div className="volume-control">

                <div
                  className={`volume-popup ${volumeOpen ? "visible" : ""
                    }`}
                  onPointerDown={resetVolumeTimer}
                >

                  <span className="volume-percent">
                    {volume}%
                  </span>


                  <div className="vertical-volume-wrapper">

                    <input
                      className="volume-slider"
                      type="range"
                      min="0"
                      max="100"
                      value={volume}

                      onChange={event => {
                        updateVolumeLocally(
                          event.target.value
                        );
                      }}

                      onPointerDown={() => {
                        clearTimeout(
                          volumeTimerRef.current
                        );
                      }}

                      onPointerUp={event => {
                        commitVolume(
                          event.currentTarget.value
                        );
                      }}

                      onPointerCancel={event => {
                        commitVolume(
                          event.currentTarget.value
                        );
                      }}

                      onKeyUp={event => {
                        if (
                          [
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowDown",
                            "Home",
                            "End",
                            "PageUp",
                            "PageDown"
                          ].includes(event.key)
                        ) {
                          commitVolume(
                            event.currentTarget.value
                          );
                        }
                      }}

                      aria-label="Volume"
                    />

                  </div>


                  <button
                    className="popup-volume-button"
                    onClick={toggleMute}
                    aria-label={
                      volume === 0
                        ? "Unmute"
                        : "Mute"
                    }
                  >
                    {getVolumeIcon()}
                  </button>

                </div>


                <button
                  className={`volume-button ${volumeOpen ? "active" : ""
                    }`}
                  onClick={toggleVolumePopup}
                  aria-label="Volume"
                  aria-expanded={volumeOpen}
                >
                  {getVolumeIcon()}
                </button>

              </div>

            </div>
          </div>
        </div>
      ) : (
        <div className="song-info empty-state">
          <h1>Nothing playing</h1>

          <p>
            Start a song on Spotify to see it here.
          </p>
        </div>
      )}

      {error && (
        <p
          className="error-message"
          role="alert"
        >
          {error}
        </p>
      )}
    </main>
  );
}


