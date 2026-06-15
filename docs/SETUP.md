# 🛰️ PiStream Torrent Streaming & Delivery Guide
A complete, production-ready blueprint for deploying an ultra-fast parallel scraping, sequential downloading, and pseudo-streaming media delivery system on your Ubuntu 22.04 Linux VPS or home server.

---

## 🗺️ SYSTEM DESIGN & FLOW

```text
 📱 MOBILE APP (React Native / Kotlin)
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
 🌀 SEQUENTIAL DOWNLOAD ENGINE (WebTorrent)
          |
      [Starts Downloading sequentially, prioritizing start/end chunks]
          |
          +---------> If mp4: Stream Range Requests Proxy (Express)
          |
          +---------> If mkv: Transmux on-the-fly (FFmpeg copy codec)
          |
          v
 🎬 LIVE STREAMS IN THE HUD PLAYER
```

---

## 🗄️ 1. SYSTEM DELIVERABLES SUMMARY

*   **`/backend`**: Production Node.js + Express backend container configured with parallel search scrapers, active byte-range streams, subtitles extracts, and automated cron sweeps.
*   **`/app-react-native`**: Fast, lightweight React Native (Expo) multiplatform application featuring progressive custom buffering indicators, background audios, and auto-reconnecting players.
*   **`/app`**: (Root folder) Android Native Kotlin / Jetpack Compose application designed to compile stably and run on Streaming Android Emulators directly from the AI Studio playground.

---

## 🚀 2. DEPLOYING ON LINUX VPS (Ubuntu 22.04 LTS)

Follow these steps to deploy the Torrent backend on a standard cloud provider (DigitalOcean, AWS, Linode, Hetzner, etc.).

### Step 2.1: Initial System Prep & Dependencies
Login via SSH to your VPS, update repositories, install Docker, and install FFmpeg:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install ffmpeg git curl -y
```

### Step 2.2: Install Docker & Docker-Compose
Securely install Docker on Ubuntu:
```bash
# Add Docker's official GPG key:
sudo apt install ca-certificates gnupg -y
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository to Apt sources:
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
```

### Step 2.3: Clone & Setup Environments
Upload the `/backend` folder to your VPS root directory (e.g., `/home/ubuntu/pistream-backend`). Create your active environment file:
```bash
cd /home/ubuntu/pistream-backend
cp .env.example .env
```
Open `.env` using nano (`nano .env`) and set your customized ports or volume variables:
```env
PORT=3000
TORRENT_PORT=3000
NODE_ENV=production
TEMP_DIR=/tmp/streamcache
MAX_CACHE_SIZE=52428800000 # 50 GB Limit
ENCRYPTION_KEY=SuperSecureStreamingEncryptionKey123
```

### Step 2.4: Spin Up with Docker-Compose
To build the server container and spin up Redis in daemonized background modes, run:
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

## 📱 3. RUNNING AND BUILDING THE MOBILE APP (React Native + Expo)

You can build and test the mobile application on physical Android/iOS devices or simulators.

### Step 3.1: Install Node.js (Local Developer Environment)
Make sure you have Node 18 or 20 installed locally on your development laptop.

### Step 3.2: Initialize the App Project
Navigate to your local copy of `/app-react-native` and install Expo dependencies:
```bash
cd app-react-native
npm install
```

### Step 3.3: Link Server URL
Open `App.js` and change the `BACKEND_URL` constant:
```javascript
const BACKEND_URL = 'http://YOUR_VPS_PUBLIC_IP:3000';
```

### Step 3.4: Launch the Expo Packager
Start the local server package runner:
```bash
npx expo start
```
*   **Android Devices**: Download the **Expo Go** app from the Google Play Store, then scan the QR code displayed in your terminal.
*   **iOS Devices**: Download the **Expo Go** app from the App Store, open your camera app, scan the terminal QR code, and allow the bundle to assemble.

---

## 🔒 4. CORE ENGINE SPECS & SECURITY ENFORCEMENTS

### ⚔️ Multi-Source Scraper Fallback Matrix
The `/backend/scrapers.js` module contains individual search classes equipped with **both** Cheerio DOM tree parser routes AND direct Regex evaluation blocks. If a source's layout changes, the alternative parser takes over instantly without crashing.
```text
Order of Searches:
1. YTS.mx (Movies Only) ────> Fallbacks to HTML crawl
2. apibay.org ──────────────> Fallbacks to pirateproxy.live HTML parsing
3. 1337x.to scrape ─────────> Fallbacks to backup Regex parser
4. Nyaa.si ─────────────────> Fallbacks Sukebei
5. TorrentGalaxy / EZTV ────> TV Show / Genre-specific routines
6. DHT crawler ─────────────> Ultimate fallback to synthetic magnet generator
```

### 🧹 Automatic Storage Cleanups (Zero-Trace Policy & 5GB Quotas)
Temp data remains on disk during active playback only, and local cache is carefully maintained within a strict 5GB boundary to defend VPS resources.
1.  **5GB Enforced Storage Limit**: The system monitors physical space of `/tmp/streamcache` using a dedicated background service (`/backend/cacheService.js`). If total size breaches 5GB, it triggers Least Recently Used (LRU) evictions down to 80% capacity (4GB), deleting older inactive torrent files first. If active files must be evicted, their Torrent threads/streams are properly destroyed prior to disk erasure.
2.  **Proactive Enforcements**: In addition to periodic 2-minute interval sweeps, the server proactively forces a cache-limit evaluation immediately before starting any new stream session.
3.  **15-Minute Sweep**: Exactly 15 minutes after the user stops requesting range blocks, the torrent session is closed, the file buffers are wiped, and track nodes are cleared.
4.  **10-Minute Stalled-Download Sweep**: If someone requests a torrent with 0 seeders and it hangs without completing a block for 10 minutes, the client cancels the download and purges files to prevent VPS disk fill-ups.
5.  **Encrypted Erasure**: Before deleting files, the first/last sectors are fully zeroed out and overwritten with high-entropy cryptographic junk to prevent data recovery.

---

## 🛠️ 5. TROUBLESHOOTING & MAINTENANCE

*   **Disk Full Errors**: The system monitors its volume limit using `MAX_CACHE_SIZE`. Check container storage using `docker df`.
*   **Seeking Stalls**: When seeking forward past the buffered limit, the video may pause while WebTorrent requests the matching piece sequentially. If it exceeds 30 seconds, it sends a **503 Gateway Retry**, allowing the video player to try again without crashing.
*   **MKV Transmuxing CPU overhead**: MKV transmuxing uses `videoCodec('copy')` on FFmpeg, copying raw H.264 streams directly into MP4 containers with zero encoding overhead (typically <2% CPU utilization on single cores).
