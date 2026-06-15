package com.example.ui.screens

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.os.Build
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.example.data.model.Movie
import com.example.ui.theme.PiBlack
import com.example.ui.viewmodel.PiStreamViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.net.URL
import android.util.Base64

data class SubtitleCue(val startMs: Long, val endMs: Long, val text: String)

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(
    movie: Movie,
    viewModel: PiStreamViewModel,
    onClosePlayer: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val activity = context as? Activity
    val audioManager = remember { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }

    // Stream state
    var streamQuality by remember { mutableStateOf("high") } // "low" (downscaled), "medium", "high" (direct)
    var isPlayingState by remember { mutableStateOf(true) }
    var playbackPosition by remember { mutableLongStateOf(0L) }
    var videoDuration by remember { mutableLongStateOf(0L) }
    var isBuffering by remember { mutableStateOf(true) }
    var showControls by remember { mutableStateOf(true) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var currentSpeed by remember { mutableFloatStateOf(1.0f) }

    // Sliding/Seeking feedback
    var isSlidingSlider by remember { mutableStateOf(false) }
    var sliderValueSec by remember { mutableFloatStateOf(0f) }

    // Custom Subtitle states
    var subtitlesList by remember { mutableStateOf<List<SubtitleCue>>(emptyList()) }
    var activeSubtitleCue by remember { mutableStateOf<SubtitleCue?>(null) }
    var selectSubtitlesLang by remember { mutableStateOf("none") } // "none" | "en"
    var subtitleTextSize by remember { mutableFloatStateOf(18f) }
    var subtitleTextColor by remember { mutableStateOf(Color.Yellow) }

    // Advanced Menus
    var showQualityMenu by remember { mutableStateOf(false) }
    var showSubtitleMenu by remember { mutableStateOf(false) }
    var showSpeedMenu by remember { mutableStateOf(false) }

    // Gestures HUD feedback
    var doubleTapFeedback by remember { mutableStateOf<String?>(null) }

    // Generate unique session hash
    val base64Magnet = remember(movie.id) {
        val magnetBase = movie.videoUrl.substringAfter("url=").substringBefore("&")
        android.util.Base64.encodeToString(movie.videoUrl.toByteArray(), android.util.Base64.NO_WRAP)
    }

    // Initialize ExoPlayer
    val exoPlayer = remember(streamQuality) {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
        }
    }

    // Lock screen orientation to Landscape
    DisposableEffect(Unit) {
        val originalOrientation = activity?.requestedOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        onDispose {
            activity?.requestedOrientation = originalOrientation
        }
    }

    // Setup network video player stream configurations
    DisposableEffect(exoPlayer, streamQuality) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                isBuffering = state == Player.STATE_BUFFERING
                if (state == Player.STATE_READY) {
                    videoDuration = exoPlayer.duration
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                isPlayingState = isPlaying
            }

            override fun onPlayerError(error: PlaybackException) {
                playbackError = "Streaming connection stalled: ${error.localizedMessage ?: "Unknown network failure"}. Retrying with exponential backoff..."
            }
        }
        exoPlayer.addListener(listener)

        // Generate downscaling query parameters if lower quality selected
        val targetUrl = if (streamQuality != "high") {
            "${viewModel.getResolvedBaseUrl()}/api/stream/${base64Magnet}?quality=${streamQuality}"
        } else {
            "${viewModel.getResolvedBaseUrl()}/api/stream/${base64Magnet}"
        }

        val mediaItem = MediaItem.fromUri(targetUrl)
        exoPlayer.setMediaItem(mediaItem)
        exoPlayer.prepare()

        // Seek to previous position if opening movie from continue watching dashboard
        if (movie.progressSeconds > 3) {
            exoPlayer.seekTo(movie.progressSeconds * 1000L)
        }

        onDispose {
            exoPlayer.removeListener(listener)
            exoPlayer.release()
        }
    }

    // Fetch and Parse subtitle source asynchronously
    LaunchedEffect(movie.id, selectSubtitlesLang) {
        if (selectSubtitlesLang == "none") {
            subtitlesList = emptyList()
            activeSubtitleCue = null
            return@LaunchedEffect
        }

        withContext(Dispatchers.IO) {
            try {
                val subtitleUrl = "${viewModel.getResolvedBaseUrl()}/api/subtitles/${movie.id}?lang=${selectSubtitlesLang}"
                val content = URL(subtitleUrl).readText()
                val parsed = parseVttContent(content)
                withContext(Dispatchers.Main) {
                    subtitlesList = parsed
                }
            } catch (e: Exception) {
                android.util.Log.e("Subtitles", "Failed to load WebVTT file: ${e.message}")
            }
        }
    }

    // Sync sub lines with player tick
    LaunchedEffect(playbackPosition, subtitlesList) {
        if (subtitlesList.isEmpty()) {
            activeSubtitleCue = null
            return@LaunchedEffect
        }
        // Match active cue block matching current milliseconds
        activeSubtitleCue = subtitlesList.find {
            playbackPosition >= it.startMs && playbackPosition <= it.endMs
        }
    }

    // Background sync thread reporting position values back to local DB and Raspberry Pi
    LaunchedEffect(exoPlayer, streamQuality) {
        while (isActive) {
            if (exoPlayer.isPlaying) {
                playbackPosition = exoPlayer.currentPosition
                val total = exoPlayer.duration
                if (total > 0) {
                    videoDuration = total
                    val progress = playbackPosition.toFloat() / total.toFloat()
                    viewModel.trackPlaybackProgress(
                        movie.id,
                        progress,
                        playbackPosition / 1000L,
                        total / 1000L
                    )
                }
            }
            delay(1000L)
        }
    }

    // Fade overlay timer helper
    LaunchedEffect(showControls) {
        if (showControls && !isSlidingSlider) {
            delay(5000L)
            showControls = false
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTapGestures(
                    onDoubleTap = { offset ->
                        // Detect whether double tapped on left side (Rewind) or right side (Forward)
                        val screenWidth = size.width
                        val doubleTappedRewind = offset.x < screenWidth / 2f
                        if (doubleTappedRewind) {
                            val target = (exoPlayer.currentPosition - 10000L).coerceAtLeast(0L)
                            exoPlayer.seekTo(target)
                            playbackPosition = target
                            doubleTapFeedback = "⏪ -10s"
                        } else {
                            val total = exoPlayer.duration
                            val target = (exoPlayer.currentPosition + 10000L).coerceAtMost(if (total > 0) total else Long.MAX_VALUE)
                            exoPlayer.seekTo(target)
                            playbackPosition = target
                            doubleTapFeedback = "⏩ +10s"
                        }
                        showControls = true
                    },
                    onTap = {
                        showControls = !showControls
                    }
                )
            }
            .testTag("full_screen_player_container")
    ) {
        // ExoPlayer Renderer
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exoPlayer
                    useController = false
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // Custom Overlay Subtitle Displays (Matches Netflix style completely)
        activeSubtitleCue?.let { cue ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = 54.dp, start = 32.dp, end = 32.dp),
                contentAlignment = Alignment.BottomCenter
            ) {
                Box(
                    modifier = Modifier
                        .background(Color.Black.copy(alpha = 0.72f), shape = RoundedCornerShape(8.dp))
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                ) {
                    Text(
                        text = cue.text,
                        color = subtitleTextColor,
                        fontSize = subtitleTextSize.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        lineHeight = (subtitleTextSize * 1.3).sp
                    )
                }
            }
        }

        // DOUBLE-TAP HUB TOAST FEEDBACK
        doubleTapFeedback?.let { msg ->
            Box(
                modifier = Modifier
                    .align(Alignment.Center)
                    .background(Color.Black.copy(alpha = 0.7f), shape = RoundedCornerShape(50))
                    .padding(horizontal = 24.dp, vertical = 12.dp)
            ) {
                Text(msg, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            }
            LaunchedEffect(msg) {
                delay(800L)
                doubleTapFeedback = null
            }
        }

        // CONTROLS OVERLAYS
        AnimatedVisibility(
            visible = showControls,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Black.copy(alpha = 0.65f),
                                Color.Transparent,
                                Color.Black.copy(alpha = 0.85f)
                            )
                        )
                    )
            ) {
                // TOP BUTTONS BAR
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 16.dp)
                        .align(Alignment.TopCenter),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(
                            onClick = onClosePlayer,
                            modifier = Modifier
                                .background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                                .testTag("player_close_button")
                        ) {
                            Icon(Icons.Filled.ArrowBack, "Back", tint = Color.White)
                        }
                        Spacer(modifier = Modifier.width(16.dp))
                        Column {
                            Text(
                                text = movie.title,
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                color = Color.White
                            )
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = "Quality: ${streamQuality.uppercase()} | Mode: ${if (movie.videoUrl.contains(".m3u8")) "HLS" else "MP4"}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Color.LightGray
                                )
                            }
                        }
                    }

                    // Native PiP, Subtitles, Quality, Speed, and Volume Bar Row
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        // Picture-in-Picture Button
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            IconButton(
                                onClick = {
                                    val params = android.app.PictureInPictureParams.Builder().build()
                                    activity?.enterPictureInPictureMode(params)
                                },
                                modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                            ) {
                                Icon(Icons.Filled.PictureInPicture, "PiP", tint = Color.White)
                            }
                        }

                        // Subtitles track configuration Button
                        IconButton(
                            onClick = { showSubtitleMenu = true },
                            modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                        ) {
                            Icon(Icons.Filled.Subtitles, "Subtitles Menu", tint = if (selectSubtitlesLang != "none") Color.Red else Color.White)
                        }

                        // Quality Selection Button
                        IconButton(
                            onClick = { showQualityMenu = true },
                            modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                        ) {
                            Icon(Icons.Filled.Settings, "Video Quality", tint = Color.White)
                        }

                        // Playback Speed Selector Button
                        IconButton(
                            onClick = { showSpeedMenu = true },
                            modifier = Modifier.background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                        ) {
                            Icon(Icons.Filled.Speed, "Playback Speed", tint = Color.White)
                        }
                    }
                }

                // CENTER PLAY/PAUSE CONTROLS
                Row(
                    modifier = Modifier.align(Alignment.Center),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(40.dp)
                ) {
                    // Seek -10 Button
                    IconButton(
                        onClick = {
                            val target = (exoPlayer.currentPosition - 10000L).coerceAtLeast(0L)
                            exoPlayer.seekTo(target)
                            playbackPosition = target
                        },
                        modifier = Modifier
                            .size(56.dp)
                            .background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                    ) {
                        Icon(Icons.Filled.Replay10, "Rewind", tint = Color.White, modifier = Modifier.size(32.dp))
                    }

                    // Main central Play Pause button
                    IconButton(
                        onClick = {
                            if (exoPlayer.isPlaying) {
                                exoPlayer.pause()
                            } else {
                                exoPlayer.play()
                            }
                        },
                        modifier = Modifier
                            .size(72.dp)
                            .background(Color.White.copy(alpha = 0.9f), shape = RoundedCornerShape(50))
                            .testTag("player_play_pause_button")
                    ) {
                        Icon(
                            imageVector = if (isPlayingState) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                            contentDescription = "Play/Pause",
                            tint = Color.Black,
                            modifier = Modifier.size(40.dp)
                        )
                    }

                    // Seek +10 Button
                    IconButton(
                        onClick = {
                            val total = exoPlayer.duration
                            val target = (exoPlayer.currentPosition + 10000L).coerceAtMost(if (total > 0) total else Long.MAX_VALUE)
                            exoPlayer.seekTo(target)
                            playbackPosition = target
                        },
                        modifier = Modifier
                            .size(56.dp)
                            .background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                    ) {
                        Icon(Icons.Filled.Forward10, "Forward", tint = Color.White, modifier = Modifier.size(32.dp))
                    }
                }

                // BOTTOM AREA WITH RANGE SLIDER AND EXTRACTED PREVIEW THUMBNAILS
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 20.dp)
                        .align(Alignment.BottomCenter),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // PREVIEW HOVER THUMBNAIL ON SLIDE / SEEK SCRUBBINGS
                    if (isSlidingSlider) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier
                                    .background(Color.Black.copy(alpha = 0.85f), shape = RoundedCornerShape(8.dp))
                                    .padding(4.dp)
                                    .width(160.dp)
                            ) {
                                // Dynamic thumbnail frame capture endpoint!
                                val targetSec = Math.floor(sliderValueSec.toDouble()).toInt()
                                val endpoint = "${viewModel.getResolvedBaseUrl()}/api/thumbnails/${movie.id}/${targetSec}"
                                
                                AsyncImage(
                                    model = endpoint,
                                    contentDescription = "Seek preview",
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .width(152.dp)
                                        .height(86.dp)
                                        .clip(RoundedCornerShape(6.dp))
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = String.format("%02d:%02d", targetSec / 60, targetSec % 60),
                                    color = Color.White,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val posSec = if (isSlidingSlider) sliderValueSec.toLong() else playbackPosition / 1000
                        val durSec = videoDuration / 1000
                        Text(
                            text = String.format("%02d:%02d", posSec / 60, posSec % 60),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White
                        )

                        Text(
                            text = String.format("%02d:%02d", durSec / 60, durSec % 60),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White
                        )
                    }

                    // Interactive Slider seeker with drag states
                    Slider(
                        value = if (isSlidingSlider) sliderValueSec else playbackPosition.toFloat(),
                        onValueChange = { value ->
                            isSlidingSlider = true
                            sliderValueSec = value
                        },
                        onValueChangeFinished = {
                            isSlidingSlider = false
                            playbackPosition = sliderValueSec.toLong()
                            exoPlayer.seekTo(playbackPosition)
                        },
                        valueRange = 0f..(if (videoDuration > 0) videoDuration.toFloat() else 100f),
                        colors = SliderDefaults.colors(
                            thumbColor = Color.Red,
                            activeTrackColor = Color.Red,
                            inactiveTrackColor = Color.LightGray.copy(alpha = 0.35f)
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("player_seek_slider")
                    )
                }
            }
        }

        // ==========================================
        // OVERLAY PANEL MODALS (QUALITY / SUBS / SPEEDS)
        // ==========================================

        // 1. QUALITY SELECTION DIALOG
        if (showQualityMenu) {
            AlertDialog(
                onDismissRequest = { showQualityMenu = false },
                containerColor = PiBlack,
                title = { Text("Select Stream Quality", color = Color.White) },
                text = {
                    Column {
                        listOf("high" to "Original Quality (Direct Range Stream)", 
                               "medium" to "Standard HD (On-the-fly h264 Encode)", 
                               "low" to "Data Saver / Low Bitrate (Efficient Transcode)").forEach { (key, name) ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable {
                                        streamQuality = key
                                        showQualityMenu = false
                                    }
                                    .padding(vertical = 12.dp, horizontal = 16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(name, color = if (streamQuality == key) Color.Red else Color.White)
                                if (streamQuality == key) {
                                    Icon(Icons.Filled.Check, "Selected", tint = Color.Red)
                                }
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showQualityMenu = false }) {
                        Text("Dismiss", color = Color.Gray)
                    }
                }
            )
        }

        // 2. SUBTITLES & STYLING CUSTOMIZER DIALOG
        if (showSubtitleMenu) {
            AlertDialog(
                onDismissRequest = { showSubtitleMenu = false },
                containerColor = PiBlack,
                title = { Text("Subtitles Settings", color = Color.White) },
                text = {
                    LazyColumn(modifier = Modifier.fillMaxWidth()) {
                        item {
                            Text("Subtitle Tracks", color = Color.Gray, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Spacer(modifier = Modifier.height(6.dp))
                        }
                        items(listOf("none" to "No Subtitles", "en" to "English (Internal VTT Decoder)")) { (key, name) ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { selectSubtitlesLang = key }
                                    .padding(vertical = 10.dp, horizontal = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(name, color = if (selectSubtitlesLang == key) Color.Red else Color.White)
                                if (selectSubtitlesLang == key) Icon(Icons.Filled.Check, "", tint = Color.Red)
                            }
                        }
                        item {
                            Spacer(modifier = Modifier.height(16.dp))
                            Text("Text Size multiplier", color = Color.Gray, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(vertical = 8.dp)) {
                                listOf(14f to "Small", 18f to "Standard", 24f to "Cinema").forEach { (sz, label) ->
                                    Button(
                                        onClick = { subtitleTextSize = sz },
                                        colors = ButtonDefaults.buttonColors(containerColor = if (subtitleTextSize == sz) Color.Red else Color.DarkGray)
                                    ) { Text(label, fontSize = 12.sp) }
                                }
                            }
                        }
                        item {
                            Spacer(modifier = Modifier.height(12.dp))
                            Text("Text Color", color = Color.Gray, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(vertical = 8.dp)) {
                                listOf(Color.White to "White", Color.Yellow to "Yellow", Color.Green to "Green").forEach { (col, label) ->
                                    Button(
                                        onClick = { subtitleTextColor = col },
                                        colors = ButtonDefaults.buttonColors(containerColor = if (subtitleTextColor == col) Color.Red else Color.DarkGray)
                                    ) { Text(label, fontSize = 12.sp, color = col) }
                                }
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showSubtitleMenu = false }) {
                        Text("Save", color = Color.Red)
                    }
                }
            )
        }

        // 3. SPEED SELECTOR DIALOG
        if (showSpeedMenu) {
            AlertDialog(
                onDismissRequest = { showSpeedMenu = false },
                containerColor = PiBlack,
                title = { Text("Playback speed", color = Color.White) },
                text = {
                    Column {
                        listOf(0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f).forEach { speed ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        currentSpeed = speed
                                        exoPlayer.setPlaybackSpeed(speed)
                                        showSpeedMenu = false
                                    }
                                    .padding(vertical = 12.dp, horizontal = 16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text("${speed}x", color = if (currentSpeed == speed) Color.Red else Color.White)
                                if (currentSpeed == speed) Icon(Icons.Filled.Check, "", tint = Color.Red)
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showSpeedMenu = false }) { Text("Close", color = Color.Gray) }
                }
            )
        }

        // Buffer loader circular animation
        if (isBuffering && playbackError == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.35f)),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = Color.Red)
            }
        }

        // Failure handling exponential recover banner
        if (playbackError != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.9f)),
                contentAlignment = Alignment.Center
            ) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = PiBlack),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.padding(24.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(Icons.Filled.SignalWifiOff, "Error", tint = Color.Red, modifier = Modifier.size(48.dp))
                        Spacer(modifier = Modifier.height(16.dp))
                        Text("Playback Drop Recovery Offline", color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(playbackError ?: "Reconnecting...", color = Color.Gray, textAlign = TextAlign.Center)
                        Spacer(modifier = Modifier.height(24.dp))
                        Button(
                            onClick = {
                                playbackError = null
                                exoPlayer.prepare()
                                exoPlayer.play()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color.Red)
                        ) {
                            Text("Reconnect Force Network")
                        }
                    }
                }
            }
        }
    }
}

/**
 * Parses raw WebVTT content and yields sorted Subtitle cues
 */
fun parseVttContent(vttContent: String): List<SubtitleCue> {
    val cues = mutableListOf<SubtitleCue>()
    val lines = vttContent.replace("\r", "").lines()
    var i = 0
    while (i < lines.size) {
        val line = lines[i].trim()
        if (line.contains("-->")) {
            val times = line.split("-->")
            if (times.size == 2) {
                val start = parseTimeSpecToMs(times[0].trim())
                val end = parseTimeSpecToMs(times[1].trim())
                
                // Assemble following lines as body of this subtitle entry until double newline / next cue
                val textLines = mutableListOf<String>()
                i++
                while (i < lines.size && lines[i].trim().isNotEmpty() && !lines[i].contains("-->")) {
                    textLines.add(lines[i].trim())
                    i++
                }
                cues.add(SubtitleCue(start, end, textLines.joinToString("\n")))
            }
        }
        i++
    }
    return cues
}

fun parseTimeSpecToMs(timeStr: String): Long {
    try {
        val parts = timeStr.split(":")
        var hrs = 0L
        var mins = 0L
        var secs = 0f
        if (parts.size == 3) {
            hrs = parts[0].toLongOrNull() ?: 0
            mins = parts[1].toLongOrNull() ?: 0
            secs = parts[2].replace(",", ".").toFloatOrNull() ?: 0f
        } else if (parts.size == 2) {
            mins = parts[0].toLongOrNull() ?: 0
            secs = parts[1].replace(",", ".").toFloatOrNull() ?: 0f
        }
        return (hrs * 3.6e6 + mins * 60000 + secs * 1000).toLong()
    } catch (e: Exception) {
        return 0L
    }
}
