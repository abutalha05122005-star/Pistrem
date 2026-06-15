import React, { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

// Styling override imports can be handled in a separate CSS file or as custom classes.
// Below is a highly durable, production-grade video.js player React wrapper.
export default function VideoPlayer({ 
  src, 
  type = 'hls', // 'hls' | 'dash' | 'auto'
  autoplay = false, 
  title = 'Live PiStream Feed',
  onPlayerReady = null,
  onProgress = null,
  onError = null
}) {
  const videoContainerRef = useRef(null);
  const playerRef = useRef(null);
  
  // Player state telemetry for rendering administrative stats panels inside low-power browsers
  const [telemetry, setTelemetry] = useState({
    activeSource: '',
    format: '',
    duration: 0,
    currentTime: 0,
    bufferedSeconds: 0,
    isBuffering: false,
    resolution: 'Unknown',
    resolutionWidth: 0,
    resolutionHeight: 0
  });
  
  const [showTelemetryPanel, setShowTelemetryPanel] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Resolve MIME type helper
  const getMimeType = (sourceUrl, streamType) => {
    if (streamType === 'hls' || sourceUrl.endsWith('.m3u8')) {
      return 'application/x-mpegURL';
    }
    if (streamType === 'dash' || sourceUrl.endsWith('.mpd')) {
      return 'application/dash+xml';
    }
    // Fallbacks
    if (sourceUrl.includes('.m3u8')) return 'application/x-mpegURL';
    if (sourceUrl.includes('.mpd')) return 'application/dash+xml';
    return 'video/mp4'; // Progressive fallback
  };

  useEffect(() => {
    if (!videoContainerRef.current) return;

    // To prevent React 18 Strict Mode double-invocation issues,
    // we dynamically create the HTML5 video element on Mount and clean it up completely on Unmount.
    const videoElement = document.createElement('video');
    videoElement.className = 'video-js vjs-big-play-centered vjs-theme-cosmic';
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.setAttribute('playsinline', 'true');
    videoElement.setAttribute('crossorigin', 'anonymous');
    videoContainerRef.current.appendChild(videoElement);

    // Raspberry Pi Chromium-Optimized VideoHS/VJS parameters:
    // 1. Lower buffer caps to avoid bloating finite RAM and stalling CPU cores.
    // 2. High retry counts to counter latency over Wi-Fi channels.
    const resolvedMime = getMimeType(src, type);
    const videoJsOptions = {
      autoplay,
      controls: true,
      responsive: true,
      fluid: true,
      preload: 'auto',
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      sources: [{
        src: src,
        type: resolvedMime
      }],
      controlBar: {
        children: [
          'playToggle',
          'currentTimeDisplay',
          'timeDivider',
          'durationDisplay',
          'progressControl',
          'volumePanel',
          'playbackRateMenuButton',
          'fullscreenToggle'
        ]
      },
      html5: {
        vhs: {
          overrideNative: true, // Guarantees buffer controls on Android/Raspbian Chromium
          maxBufferLength: 8,  // Caps buffer depth to 8 seconds to guard Pi RAM
          maxMaxBufferLength: 12,
          enableLowInitialPlaylist: true, // Starts streaming on low quality for instant playback load
          fastStart: true,
          limitRenditionByPlayerDimensions: true // Prevents loading heavy 4K frames if browser width is small
        }
      }
    };

    // Instantiate VideoJS player
    const player = videojs(videoElement, videoJsOptions, () => {
      videojs.log('⚡ PiStream Web Player initialized successfully.');
      if (onPlayerReady) {
        onPlayerReady(player);
      }
    });

    playerRef.current = player;

    // --- EVENT LISTENERS & PI TELEMETRY INTEGRATIONS ---
    
    // Periodically capture playback metrics (perfect for remote debugging)
    const updateStats = () => {
      if (!player || player.isDisposed()) return;
      
      const buffered = player.buffered();
      let bufferedSeconds = 0;
      if (buffered && buffered.length > 0) {
        const current = player.currentTime();
        for (let i = 0; i < buffered.length; i++) {
          if (current >= buffered.start(i) && current <= buffered.end(i)) {
            bufferedSeconds = buffered.end(i) - current;
            break;
          }
        }
      }

      // Read internal video element resolution dynamically
      const activeVideoEl = player.tech()?.el();
      const width = activeVideoEl?.videoWidth || 0;
      const height = activeVideoEl?.videoHeight || 0;

      setTelemetry({
        activeSource: player.src() || src,
        format: resolvedMime === 'application/x-mpegURL' ? 'HLS (m3u8)' : 'DASH (mpd)',
        duration: player.duration() || 0,
        currentTime: player.currentTime() || 0,
        bufferedSeconds: parseFloat(bufferedSeconds.toFixed(1)),
        isBuffering: player.seeking() || (player.state && player.state.buffering),
        resolution: width > 0 ? `${width}x${height}` : 'Calculating...',
        resolutionWidth: width,
        resolutionHeight: height
      });
    };

    player.on('timeupdate', () => {
      updateStats();
      if (onProgress) {
        onProgress(player.currentTime());
      }
    });

    player.on('loadedmetadata', updateStats);
    player.on('seeking', () => setTelemetry(prev => ({ ...prev, isBuffering: true })));
    player.on('seeked', () => setTelemetry(prev => ({ ...prev, isBuffering: false })));
    player.on('waiting', () => setTelemetry(prev => ({ ...prev, isBuffering: true })));
    player.on('playing', () => setTelemetry(prev => ({ ...prev, isBuffering: false })));

    // Custom Error handling optimized for Raspberry Pi's missing media licensing issues (Widevine, H.265/HEVC)
    player.on('error', () => {
      const vjsError = player.error();
      let advice = 'Check your connection parameters.';
      
      if (vjsError && vjsError.code === 4) {
        advice = 'Format unsupported. If streaming H.265 (HEVC), Raspberry Pi Chromium might lack hardware decoder flags. Try switching your server stream settings to H.264 (AVC) or install the Chromium-codecs-extra package.';
      }

      const formattedError = `Player Error (Code ${vjsError?.code || 'Unknown'}): ${vjsError?.message || 'Media stream loading failed.'}. ${advice}`;
      console.error('❌ PiStream Player Crash:', formattedError);
      setErrorMessage(formattedError);
      
      if (onError) {
        onError(vjsError);
      }
    });

    // --- KEYBOARD ACCESSIBILITY AND HOTKEYS ---
    const handleKeyDown = (e) => {
      if (!playerRef.current) return;
      
      // Only process controls if user is not typing in text fields
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ': // Space bar: Play / Pause
          e.preventDefault();
          if (player.paused()) {
            player.play();
          } else {
            player.pause();
          }
          break;
        case 'arrowright': // Arrow Right: Seek forward 10s
          e.preventDefault();
          player.currentTime(Math.min(player.duration(), player.currentTime() + 10));
          break;
        case 'arrowleft': // Arrow Left: Seek backward 10s
          e.preventDefault();
          player.currentTime(Math.max(0, player.currentTime() - 10));
          break;
        case 'arrowup': // Volume Up 10%
          e.preventDefault();
          player.volume(Math.min(1.0, player.volume() + 0.1));
          break;
        case 'arrowdown': // Volume Down 10%
          e.preventDefault();
          player.volume(Math.max(0.0, player.volume() - 0.1));
          break;
        case 'f': // Toggle Fullscreen
          e.preventDefault();
          if (player.isFullscreen()) {
            player.exitFullscreen();
          } else {
            player.requestFullscreen();
          }
          break;
        case 'm': // Mute / Unmute
          e.preventDefault();
          player.muted(!player.muted());
          break;
        case 't': // Toggle Telemetry Inspector Mode
          e.preventDefault();
          setShowTelemetryPanel(prev => !prev);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Clean up player on Unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (player) {
        player.dispose();
      }
      if (videoContainerRef.current) {
        videoContainerRef.current.innerHTML = '';
      }
      playerRef.current = null;
    };
  }, [src, type, autoplay]);

  // Format timestamp strings gracefully
  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === Infinity) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const sStr = s < 10 ? `0${s}` : s;
    if (h > 0) {
      const mStr = m < 10 ? `0${m}` : m;
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  };

  return (
    <div className="pistream-player-outer-wrapper">
      <div className="pistream-player-header">
        <div className="header-meta">
          <span className="badge-live">LIVE PIFEED</span>
          <h3 className="stream-title">{title}</h3>
        </div>
        <button 
          className={`telemetry-toggle-btn ${showTelemetryPanel ? 'active' : ''}`}
          onClick={() => setShowTelemetryPanel(prev => !prev)}
          title="Toggle Hardware Telemetry (Shortcut: T)"
        >
          {showTelemetryPanel ? 'Hide Telemetry' : 'Show Telemetry (T)'}
        </button>
      </div>

      <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: '12px', background: '#000' }}>
        {/* The video container mounted into React DOM */}
        <div ref={videoContainerRef} data-vjs-player />

        {/* Custom Loading / Buffering Overlay (Hardware optimized, low visual-render overhead) */}
        {telemetry.isBuffering && !errorMessage && (
          <div className="player-custom-overlay loading-overlay">
            <div className="spinner"></div>
            <p className="overlay-text">Buffering Stream Segments...</p>
            <span className="sub-caption">Buffer depth limit: 8s (Pi RAM Shield Active)</span>
          </div>
        )}

        {/* Media error troubleshooting overlay */}
        {errorMessage && (
          <div className="player-custom-overlay crash-overlay">
            <div className="alert-icon">⚠️</div>
            <p className="error-title">PiStream Transcoding Stood Down</p>
            <p className="error-body">{errorMessage}</p>
            <button className="retry-btn" onClick={() => window.location.reload()}>Re-initialize Stream</button>
          </div>
        )}
      </div>

      {/* 🚀 EXTENSIVE RASPBERRY PI METRICS MONITOR CARD */}
      {showTelemetryPanel && (
        <div className="pistream-telemetry-panel">
          <div className="panel-header">
            <h4>🛰️ Hardware & Stream Telemetry Inspector</h4>
            <span className="system-indicator">SBC Chromium Webkit</span>
          </div>
          <div className="metrics-grid">
            <div className="metric-cell">
              <span className="label">Stream Codec MIME</span>
              <span className="value monospace">{telemetry.format}</span>
            </div>
            <div className="metric-cell">
              <span className="label">Decoder Resolution</span>
              <span className="value bold text-accent">{telemetry.resolution}</span>
            </div>
            <div className="metric-cell">
              <span className="label">Active Source URL</span>
              <span className="value monospace scrollable" title={telemetry.activeSource}>
                {telemetry.activeSource.substring(0, 48)}...
              </span>
            </div>
            <div className="metric-cell">
              <span className="label">Buffered Reserves</span>
              <span className={`value bold ${telemetry.bufferedSeconds < 2 ? 'text-warning' : 'text-success'}`}>
                {telemetry.bufferedSeconds}s
              </span>
            </div>
            <div className="metric-cell">
              <span className="label">Time elapsed</span>
              <span className="value font-num">
                {formatTime(telemetry.currentTime)} / {formatTime(telemetry.duration)}
              </span>
            </div>
            <div className="metric-cell">
              <span className="label">Pi Buffer Guard</span>
              <span className="value text-success font-num">ACTIVE (max 8s)</span>
            </div>
          </div>
          <div className="panel-footer-guidance">
            💡 <strong>Keyboard Shortcuts:</strong> <code>[Space]</code> Play/Pause • <code>[← / →]</code> Seek 10s • <code>[↑ / ↓]</code> Volume • <code>[M]</code> Mute • <code>[F]</code> Fullscreen
          </div>
        </div>
      )}
    </div>
  );
}
