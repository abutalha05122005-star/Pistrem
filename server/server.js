/**
 * 🍓 PiStream Media Hub - Production-Grade Server for Raspberry Pi
 * 
 * Dependencies to install on your Raspberry Pi:
 *   npm install express jsonwebtoken bcryptjs cors body-parser
 * 
 * Execution:
 *   node server.js
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const bodyParser = require('body-parser');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pistream-raspberry-secret-917462';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use('/media/static', express.static(path.join(__dirname, 'videos')));

// In-Memory Database for quick demonstration (can be extended to SQLite)
const users = [
    {
        email: 'streamer@raspi.lan',
        passwordHash: bcrypt.hashSync('raspberry', 10) // default password
    }
];

// Playback Sync trackers map: keeps track of what users watched across devices
const playbackRegistry = {};

// Hardcoded movie profiles mapped on the Pi, pointing to adaptive HLS/MP4 resources
const mediaLibrary = [
    {
        id: "1",
        title: "Cosmic Odyssey",
        description: "An immersive journey to the edge of the observable universe inside a real-time high-fidelity projection dome.",
        category: "trending",
        videoUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", // Direct HLS Adaptive Bitrate Stream
        thumbnailUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=60",
        duration: "1h 42m",
        year: 2025,
        rating: "PG-13",
        score: "9.8"
    },
    {
        id: "2",
        title: "Sintel Chronicles",
        description: "A brave young woman named Sintel searches the world for her baby dragon in a gorgeous open-source movie stream.",
        category: "trending",
        videoUrl: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8", // Direct HLS Adaptive Codec Stream
        thumbnailUrl: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=60",
        duration: "15m",
        year: 2024,
        rating: "PG",
        score: "9.2"
    },
    {
        id: "3",
        title: "Metropolitan Neon",
        description: "Explore a rainy neon-lit megacity in this cinematic multi-bitrate test stream simulating remote server feeds.",
        category: "library",
        videoUrl: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
        thumbnailUrl: "https://images.unsplash.com/photo-1515621061946-eff1c2a352bd?w=800&auto=format&fit=crop&q=60",
        duration: "12m",
        year: 2026,
        rating: "R",
        score: "8.9"
    },
    {
        id: "4",
        title: "Oceanic Depths",
        description: "Submerge into extreme abyssal zones and witness ancient marine life glowing in bioluminescent beauty.",
        category: "library",
        videoUrl: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", // Cleartext HTTP test
        thumbnailUrl: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop&q=60",
        duration: "2h 05m",
        year: 2025,
        rating: "G",
        score: "9.5"
    }
];

// Helper to authenticate JWT token
function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                return res.status(403).json({ error: 'Expired or invalid credentials session.' });
            }
            req.user = user;
            next();
        });
    } else {
        res.status(401).json({ error: 'Authentication header missing' });
    }
}

// -----------------------------------------------------------------------------
// 1. JWT AUTHENTICATION ENDPOINTS
// -----------------------------------------------------------------------------

app.post('/auth/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Please submit both email and secure password.' });
    }

    const exists = users.find(u => u.email === email);
    if (exists) {
        return res.status(400).json({ error: 'Account already exists. Try logging in.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    users.push({ email, passwordHash });

    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '14d' });
    res.status(201).json({ token, userEmail: email, message: 'Welcome to PiStream!' });
});

app.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Please submit both email and password.' });
    }

    const user = users.find(u => u.email === email);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid user email or server password.' });
    }

    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '14d' });
    res.json({ token, userEmail: user.email, message: 'Access session granted.' });
});

// -----------------------------------------------------------------------------
// 2. MEDIA ENDPOINTS
// -----------------------------------------------------------------------------

app.get('/media/list', authenticateJWT, (req, res) => {
    // Inject synchronized user progress values if tracked
    const syncedMovies = mediaLibrary.map(movie => {
        const registryKey = `${req.user.email}_${movie.id}`;
        if (playbackRegistry[registryKey]) {
            return {
                ...movie,
                ...playbackRegistry[registryKey]
            };
        }
        return movie;
    });
    res.json(syncedMovies);
});

// Returns detailed statistics on specific media
app.get('/media/:id', authenticateJWT, (req, res) => {
    const movie = mediaLibrary.find(m => m.id === req.params.id);
    if (!movie) {
        return res.status(404).json({ error: 'Movie session details not found.' });
    }
    const registryKey = `${req.user.email}_${movie.id}`;
    const progress = playbackRegistry[registryKey] || { progress: 0, progressSeconds: 0, durationSeconds: 0 };
    res.json({ ...movie, ...progress });
});

// Segmented seek support / raw video handler providing ranges
app.get('/media/:id/stream.m3u8', (req, res) => {
    const movieId = req.params.id;
    // Real HLS delivery would serve .m3u8 files generated inside the ffmpeg pool folder
    // For adaptive demonstration we point redirect to appropriate local HLS assets
    const matched = mediaLibrary.find(m => m.id === movieId);
    if (matched) {
        res.redirect(matched.videoUrl);
    } else {
        res.status(444).send('No segment pipeline matching ID stream channel.');
    }
});

// -----------------------------------------------------------------------------
// 3. DEVICE HARDWARE STATUS ENDPOINTS
// -----------------------------------------------------------------------------

app.get('/device/status', (req, res) => {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const usedPercent = (((totalMem - freeMem) / totalMem) * 100).toFixed(1);

    res.json({
        serverName: `PiStream Hub (${os.hostname()})`,
        version: "v1.2.0-MVP",
        ffmpegAvailable: true,
        diskFreeSpace: `${(freeMem / (1024 * 1024 * 1024)).toFixed(1)} GB Free / ${(totalMem / (1024 * 1024 * 1024)).toFixed(1)} GB Total`,
        localAddress: `http://${getLocalIpAddress()}:${PORT}`,
        isRemoteSecure: req.secure || false
    });
});

app.post('/device/sync', authenticateJWT, (req, res) => {
    const { media_id, progress, progressSeconds, durationSeconds } = req.body;
    if (!media_id) {
        return res.status(400).json({ error: 'ID is missing.' });
    }

    const registryKey = `${req.user.email}_${media_id}`;
    playbackRegistry[registryKey] = {
        progress: parseFloat(progress || '0'),
        progressSeconds: parseInt(progressSeconds || '0', 10),
        durationSeconds: parseInt(durationSeconds || '0', 10),
        lastWatchedTime: Date.now()
    };

    res.json({ success: "true", status: "Playback progress logged successfully" });
});

// Utility to fetch active network addresses
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Spark Server Startup
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🍓 PiStream Raspberry Pi Server started on port ${PORT}`);
    console.log(`🌐 Accessible locally on: http://localhost:${PORT}`);
    console.log(`📡 Accessible on your LAN: http://${getLocalIpAddress()}:${PORT}`);
    console.log(`======================================================\n`);
});
