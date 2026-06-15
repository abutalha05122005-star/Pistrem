# 🛰️ PiStream Torrent Streaming & Delivery Guide
A complete, production-ready blueprint for deploying an ultra-fast parallel scraping, sequential downloading, and transparently encrypted media delivery system on your Raspberry Pi 4/5 or Ubuntu server.

---

## 🗺️ SYSTEM DESIGN & FLOW

```text
 📱 MOBILE APP (Android Jetpack Compose / React Native)
          |
          v (Searches Movie / Show)
 🛡️ API GATEWAY (POST /api/search)
          |
   +-------+-------------------------+
   | (Parallel Scrapes Scraper Pool)  |
   |  - 1337x, TPB, YTS, Nyaa         | ---> Checks Redis Cache (24h)
   |  - TorrentGalaxy, EZTV, Lime     |
   +-------+-------------------------+
          | (User Selects Torrent)
          v (GET /api/stream/:magnetHash)
 🌀 SEQUENTIAL DOWNLOAD ENGINE (WebTorrent) [Limited connections for Pi 4/5 RAM]
          |
       [Starts Downloading sequentially, prioritizing start/end chunks]
          |
          v
 🔒 TRANSPARENT ENCRYPTION FILESYSTEM OVERLAY (AES-256-CTR)
          | (Decrypts on read, Encrypts on write at physical level)
          +---------> If mp4: Stream Range Requests Proxy (Express)
          |
          +---------> If mkv: Transmux on-the-fly (FFmpeg copy codec)
          |
          +---------> If ?quality=low: Downscales on-the-fly to 360p (Data Saver on cellular)
          |
          v
 🎬 LIVE STREAMS IN THE HUD PLAYER (Custom captions, speed selectors, seekbar hover previews)
```

---

## 🗄️ 1. SYSTEM DELIVERABLES SUMMARY

*   **`/backend`**: Production Node.js + Express backend container configured with parallel search scrapers, transparent AES-256-CTR storage monkey-patching, active byte-range streams, seekbar previews capture, and (Duration * 2) auto-deletion schedules.
*   **`/app`**: Android Native Kotlin / Jetpack Compose application designed with a dark, cinematic Netflix interface, featuring double-tap seek controls, vertical hover seek previews, customisable subtitles and speed selectors.
*   **`/app-react-native`**: React Native (Expo) multiplatform application alternative featuring progressive custom buffering indicators.

---

## 🚀 2. DEPLOYING ON RASPBERRY PI 4 / 5 (ARM64 Docker setup)

Follow these steps to deploy the Torrent backend on a standard Raspberry Pi 4 or 5 running Raspberry Pi OS (64-bit) or Ubuntu.

### Step 2.1: Initial System Prep & Dependencies
Ensure your OS is 64-bit, update repositories, install Docker, and install FFmpeg:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install ffmpeg git curl -y
```

### Step 2.2: Setup Environments
Create your environment file:
```bash
cd backend
cp .env.example .env
```
Open `.env` using nano (`nano .env`) and set your customized variables:
```env
PORT=3000
TORRENT_PORT=3000
NODE_ENV=production
TEMP_DIR=/tmp/streamcache
MAX_CACHE_SIZE=5368709120 # 5 GB Limit
ENCRYPTION_KEY=SuperSecureStreamingEncryptionKey123
TMDB_API_KEY=your_optional_tmdb_key_here
```

### Step 2.3: Build & Spin Up with Docker-Compose
To build the server container and spin up Redis in daemonized background modes optimized for ARM64:
```bash
sudo docker compose up -d --build
```
Verify the services are running cleanly:
```bash
sudo docker compose ps
# View live logs to ensure startup:
sudo docker compose logs -f backend
```

---

## 🔒 3. CORE SECURITY & TEMPORARY STORAGE ENFORCEMENTS

### 🛡️ Transparent AES-256-CTR Encryption at Rest
All files stored inside `/tmp/streamcache` (downloaded video segments, captured thumbnails, subtitles) are automatically encrypted on write and decrypted on read. 
- Utilizes deterministic AES-256-CTR stream ciphers.
- Offset seeking aligns block boundaries `Math.floor(position / 16)` dynamically, allowing instant, random-access byte-range seeking for players with **zero decryption overhead**.
- Files remain 100% garbage on physical memory nodes should SD/SSD storage gets extracted from Raspberry Pi terminals.

### ⏱️ Dynamic (Duration * 2) Auto-Deletion Policies
Rather than rigid timer deletes, the system enforces a video duration-based garbage collector:
1.  **Stop-Stream Evaluation**: The instant a stream session active watcher client count reaches `0`, the server queries `ffmpeg.ffprobe` to determine the video's running duration in minutes.
2.  **Schedule Table Persistence**: The server schedules eviction for `(duration * 2)` minutes from the current stop time, writing this state to a local SQLite database (`pistream.db`).
3.  **Active Reset**: If the user re-initiates the exact same stream within the deletion countdown window, the timer resets, removing the database timer entry until streaming ceases again.
4.  **1-Minute Expiration Sweeper**: A background service checks the SQLite record every minute. Upon expiration, the daemon securely wipes the video files, VTT subtitle tracks, and thumbnail frame cache.
5.  **Abandoned Download Sweeper**: If a torrent starts downloading but stays idle (no active streams) for 10 minutes (e.g., zero peer stalling), it is automatically cancelled and deleted from the disk cache.

---

## 🛠️ 4. MOBILE CINEMATIC CONTROLS OVERVIEW

The upgraded Native Jetpack Compose screen packs premium Netflix‑parity interactions:
*   **Edge Double-Taps**: Double-tap on the left side of the screen rewinds exactly 10s; double-tap on the right side fast-forwards 10s.
*   **Adaptive Seek Thumbnails**: Sliding the seek bar triggers a hovering card above showing custom FFmpeg screenshot snapshots generated on-the-fly at that target second.
*   **Media Downscaler**: Allows switching on-the-fly between direct range streaming and a low-bitrate data economy stream encoded via high-efficiency `libx264` ultrafast profile to minimize mobile data utilization.
*   **Caption Styling Panel**: Displays custom captions from VTT files parsed in the background, allowing customization of size and color overlays.
*   **Picture-in-Picture**: Supports native picture-in-picture modes on Android Oreo (API 26) or higher.
*   **Network Exponential Backoff**: Recovers gracefully when losing network signal (Wi-Fi/4G cell drops) with recovery banners.
