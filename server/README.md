# 🍓 PiStream - Raspberry Pi Live Media & HLS Transcoding Guide

This folder contains the complete, production-ready backend code and configuration manual to host your personal Netflix-like streaming hub on a Raspberry Pi (Pi 4/5 recommended).

---

## 🗺️ 1. SYSTEM ARCHITECTURE

```text
       +--------------------------------------------------------+
       |                  PISTREAM ANDROID APP                  |
       +--------------------------------------------------------+
                                   |
                  +----------------+----------------+
                  |                                 |
         [LOCAL MODE (LAN)]               [REMOTE MODE (TUNNEL)]
                  |                                 |
         (Direct HTTP over Wifi)           (Encrypted HTTPS Feed)
         http://192.168.1.100:3000          https://pistream.locallink.dev
                  |                                 |
                  |                                 |
                  v                                 v
       +------------------+                +------------------+
       |   LAN ROUTER     |                | CLOUDFLARE EDGE  |
       |  (Home Network)  |                |   (Zero Trust)   |
       +------------------+                +------------------+
                |                                   |
                |                                   | (Tunnel Protocol)
                +-----------------+-----------------+
                                  |
                                  v
       +--------------------------------------------------------+
       |            RASPBERRY PI HOST (MEDIA HUB)               |
       |                                                        |
       |  +--------------------+      +----------------------+  |
       |  | Node Express Server |<---->| SQLite / In-Memory   |  |
       |  | (API & Auth Guards) |      | (Playback Registry)  |  |
       |  +--------------------+      +----------------------+  |
       |            |                                           |
       |            v (Static delivery pipeline)                |
       |  +--------------------+      +----------------------+  |
       |  |  FFMPEG Segmentor  |<---->|   HLS Video Folder   |  |
       |  |   (HLS Engine)     |      |  (*.m3u8, *.ts files)|  |
       |  +--------------------+      +----------------------+  |
       +--------------------------------------------------------+
```

---

## 📦 2. INSTALLING RASPBERRY PI ENVIRONMENT

Follow these commands to configure Node.js and FFmpeg on your Raspberry Pi:

### Step 2.1: Update Repository Sources & Install Fast Codecs
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install ffmpeg nodejs npm -y
```

### Step 2.2: Setup the Media Server Directory
```bash
mkdir -p ~/pistream-server/videos
cd ~/pistream-server
# Download server.js to this directory
```

### Step 2.3: Install Production Dependencies
```bash
npm init -y
npm install express jsonwebtoken bcryptjs cors body-parser
```

### Step 2.4: Daemonize with PM2 (Auto start on power boot)
```bash
sudo npm install -y pm2 -g
pm2 start server.js --name "pistream-hub"
pm2 save
pm2 startup
```

---

## 🎬 3. HLS STREAMING SETUP (FFMPEG ENGINE)

To stream smoothly over variable local or cellular networks without buffer drops, you must convert your standard `.mp4` films into adaptive **HLS (HTTP Live Streaming)** playlists (`.m3u8`) and transport blocks (`.ts`).

Execute this robust FFmpeg segmenter script on your Pi to transcode any video:

### Complete HLS Transcode Command:
```bash
ffmpeg -i input.mp4 \
  -codec:v libx264 -profile:v high -level 4.1 -preset fast \
  -b:v 2000k -maxrate 2200k -bufsize 3000k \
  -vf "scale=trunc(iw/2)*2:720" \
  -codec:a aac -b:a 128k \
  -f hls \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "videos/stream_%03d.ts" \
  videos/playlist.m3u8
```

*   **`-hls_time 6`**: Slices video files into exact 6-second segments for optimal ExoPlayer cache buffers.
*   **`-hls_playlist_type vod`**: Creates a video-on-demand structure supporting fast seeking and resume.

---

## 🛡️ 4. SECURE REMOTE ACCESS (CLOUDFLARE INTERNET TUNNELS)

Instead of exposing your local household router ports to malicious scans, deploy a Cloudflare Zero Trust tunnel to provide encrypted remote endpoints.

### Step 4.1: Download Cloudflare Daemon on Raspberry Pi
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
```

### Step 4.2: Login and Authorize Domain Link
```bash
cloudflared tunnel login
```

### Step 4.3: Create and Map Tunnel Channels
```bash
cloudflared tunnel create pistream-tunnel
```

### Step 4.4: Map local port to your Cloudflare domain
```bash
# Binds local Pi socket to your registered domain safely
cloudflared tunnel route dns pistream-tunnel pistream.yourdomain.com
```

### Step 4.5: Run Tunnel Service
```bash
cloudflared tunnel run --url http://localhost:3000 pistream-tunnel &
```

---

## 📝 5. DEPLOYMENT INSTRUCTIONS

To connect your custom Client Android App to your new Pi server:

1.  Start your Node.js backend: `pm2 start server.js`
2.  Launch the **PiStream** App on your phone.
3.  Navigate to the **Settings Panel** (Gear Icon on top-left).
4.  Select your connection method:
    *   **Local LAN Mode**: Input the IP Address of your Pi (e.g. `192.168.1.100` port `3000`).
    *   **Remote Tunnel Mode**: Input your secure SSL Tunnel URL (e.g. `https://pistream.yourdomain.com`).
5.  Press **Apply & Ping Media Hub**. Your phone will fetch server metrics, check FFmpeg functionality, and sync media indices.
6.  Navigate back to the home page; enjoy flawless 60fps local / remote streaming!

---

## 🔒 6. SECURITY SETUP CHECKLIST

Ensure the following configuration criteria are met before taking your server public:

*   [ ] **JWT Secrets**: Always replace `JWT_SECRET` in `server.js` or define it as an environment variable (`process.env.JWT_SECRET`) with a high entropy key.
*   [ ] **Password Suffix Hashing**: Never save plain passwords. Confirm bcrypt is executing at least 10 salt rounds (`bcrypt.hashSync(pw, 10)`).
*   [ ] **Cleartext Mitigation**: Remotely, only stream with secure tunnels using `HTTPS` SSL wrappers. Cleartext traffic (`http`) is locked in PiStream to only function inside local IP parameters.
*   [ ] **Token Expirations**: JWT tokens default to an automatic 14-day expiry. Change token lifecycle values inside `jwt.sign()` for shorter windows if desired.
*   [ ] **Authorized Headers**: Ensure all media list queries are gated with `Authorization: Bearer <JWT>`. Anonymous scrapers are blocked.
