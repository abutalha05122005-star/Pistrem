# 🪐 PiStream Video.js React Web Component
A production-ready, highly optimized, slate-dark React videoplayer component using **Video.js**. Specially tuned and configured to deliver smooth HLS (`.m3u8`) and DASH (`.mpd`) video streams on resource-constrained single-board computers (like **Raspberry Pi 3/4/5**) without crashing local browser tabs.

---

## 🚀 1. FEATURES DEFINITION

1. **Dual Format Playback**: Seamlessly handles HTTP Live Streaming (HLS) formats and Dynamic Adaptive Streaming over HTTP (DASH) profiles natively.
2. **Pi RAM Buffer Guard (Critical on SBCs)**: Automatically caps maximum pre-buffered video segments to **8 seconds** (down from Video.js's standard 30+ seconds). This prevents browsers like Chromium from running out of system RAM and crashing mid-stream.
3. **Advanced Live Telemetry Panel**: A full diagnostic board displaying real-time stream parameters, internal decoding resolutions, and remaining buffer safety margins (toggleable with `T` or a button click).
4. **Complete Keyboard Accessibility**: Custom keyboard bindings optimized for living room / remote HTPC setups:
   - `[Space]` ── Play or Pause
   - `[←] / [→]` ── Seek backward/forward 10 seconds
   - `[↑] / [↓]` ── Shift volume incrementals (10%)
   - `[M]` ── Mute or Unmute audio track
   - `[F]` ── Toggle Fullscreen
   - `[T]` ── Show or Hide Telemetry Inspector
5. **Modern Cosmic UI Style**: Sleek slate borders, neon red loading pulses, center big-play overlays, and high-contrast diagnostic indicators.

---

## 📦 2. INSTALLATION & SETUP

### Step 2.1: Pull down dependencies
Install `video.js` alongside standard React packages in your web frontend client folder:
```bash
npm install video.js react react-dom
```

### Step 2.2: Add Files
Copy standard files to your project's components layout:
- `VideoPlayer.jsx` ────> `/src/components/VideoPlayer.jsx`
- `VideoPlayer.css` ────> `/src/components/VideoPlayer.css`

---

## 🎬 3. HOW TO INTEGRATE (REACT IMPLEMENTATION)

Import and place the component inside any standard dashboard or player gate screen in your React client:

```jsx
import React, { useState } from 'react';
import VideoPlayer from './components/VideoPlayer';
import './components/VideoPlayer.css'; // Make sure styles are loaded!

function App() {
  const [streamSource, setStreamSource] = useState('http://YOUR_PI_IP:3000/api/stream/some_base64_hash');
  const [formatType, setFormatType] = useState('hls'); // 'hls' or 'dash'

  return (
    <div style={{ backgroundColor: '#070708', minHeight: '100vh', padding: '40px' }}>
      <header style={{ textAlignment: 'center', marginBottom: '30px' }}>
        <h1 style={{ color: '#fff', fontSize: '24px' }}>🍓 PiStream Client Browser</h1>
        <p style={{ color: '#aaa' }}>Raspberry Pi HLS/DASH Streaming Terminal</p>
      </header>

      {/* Dynamic Source Switcher Bar */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '24px' }}>
        <button 
          onClick={() => {
            setStreamSource('https://test-streams.mux.dev/x36xhg/main.m3u8');
            setFormatType('hls');
          }}
          style={btnStyle}
        >
          Load Demo HLS Stream (Big Buck Bunny)
        </button>
        <button 
          onClick={() => {
            setStreamSource('https://dash.akamaized.net/envivio/EnvivioDash3/manifest.mpd');
            setFormatType('dash');
          }}
          style={btnStyle}
        >
          Load Demo DASH Stream
        </button>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <VideoPlayer 
          src={streamSource} 
          type={formatType} 
          title="Dynamic Media Feed"
          autoplay={false}
          onProgress={(time) => console.log(`Current time: ${time}s`)}
        />
      </div>
    </div>
  );
}

const btnStyle = {
  backgroundColor: '#121214',
  border: '1px solid #222226',
  color: '#fff',
  padding: '10px 16px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: '600'
};

export default App;
```

---

## 🦾 4. TUNING RASPBERRY PI HARDWARE ACCELERATION

If you experience dropping frames or high CPU temperatures while running HTML5 streaming inside Chromium on a Raspberry Pi, verify these three critical operating system adjustments:

### Step 4.1: Enable Chromium GPU Decoder Flags
Open your Chromium browser on Raspberry Pi OS, navigate to `chrome://flags`, search for these keys, and enable them:
1. **`Override software rendering list`** ────> **Enabled**
   - *Forces Chrome to try GPU acceleration over standard software emulation.*
2. **`GPU rasterization`** ────> **Enabled**
   - *Uses the graphical chipset to rasterize standard web content.*
3. **`Hardware-accelerated video decode`** ────> **Enabled**
   - *Decodes H.264/AVC stream chunks directly on Raspberry Pi graphics chips instead of straining core processing units.*

Restart your browser once completed.

### Step 4.2: Increase GPU Allocation Memory (Raspberry Pi 3/4)
For Older model boards (such as Raspberry Pi 3 or 4), ensure your system config assigns sufficient RAM overhead to graphic buffers.
Open your terminal config panel:
```bash
sudo raspi-config
```
- Navigate to **Performance Options** ──> **GPU Memory**.
- Configure the assigned value strictly to **`128`** or **`256`** MB.
- Reboot your Pi: `sudo reboot`.
*(Note: Raspberry Pi 5 manages graphics memory allocation dynamically, so manual overrides are typically not needed).*

### Step 4.3: AVC Codec Limitations (Widevine / H.265 warning)
1. **HEVC/H.265**: Raspberry Pi has hardware support for H.265 playback, but many web browsers (including default Chromium architectures) might not map native decoders to pure H.265 HTML5 pipelines. For optimal results, ensure your media catalog streams transcode to **H.264 (H.264/AVC High Profile)**.
2. **Widevine DRM**: Commercial streaming sites (like Netflix or Prime Video) deliver DASH profiles encrypted with Widevine. To play them on Raspberry Pi Chromium, make sure you install the support wrapper:
   ```bash
   sudo apt install rpi-chromium-mods
   ```
   This loads required DRM libraries designed for ARM architecture.
