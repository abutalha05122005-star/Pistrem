package com.example.ui.screens

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.example.data.model.Movie
import com.example.ui.theme.PiBlack
import com.example.ui.viewmodel.PiStreamViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

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

    // Manage screen orientation (lock to landscape for cinema viewing)
    DisposableEffect(Unit) {
        val originalOrientation = activity?.requestedOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        onDispose {
            activity?.requestedOrientation = originalOrientation
        }
    }

    // Initialize ExoPlayer
    val exoPlayer = remember {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
        }
    }

    var isPlayingState by remember { mutableStateOf(true) }
    var playbackPosition by remember { mutableLongStateOf(0L) }
    var videoDuration by remember { mutableLongStateOf(0L) }
    var isBuffering by remember { mutableStateOf(true) }
    var showControls by remember { mutableStateOf(true) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var currentSpeed by remember { mutableFloatStateOf(1.0f) }

    // Observe player listener callbacks
    DisposableEffect(exoPlayer) {
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
                playbackError = "Media streaming error: ${error.localizedMessage ?: "Fallback codec lookup failed"}"
            }
        }
        exoPlayer.addListener(listener)

        // Load visual source (HLS or standard format)
        val mediaItem = MediaItem.fromUri(movie.videoUrl)
        exoPlayer.setMediaItem(mediaItem)
        exoPlayer.prepare()

        // Seek to resume position if saved locally in Room
        if (movie.progressSeconds > 3) {
            exoPlayer.seekTo(movie.progressSeconds * 1000L)
        }

        onDispose {
            exoPlayer.removeListener(listener)
            exoPlayer.release()
        }
    }

    // Loop ticking for seeking synchronization in local Room + Pi synchronizers
    LaunchedEffect(exoPlayer) {
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

    // Auto-fade controls overlay
    LaunchedEffect(showControls) {
        if (showControls) {
            delay(5000L) // Hide after 5 seconds of silence
            showControls = false
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null
            ) {
                showControls = !showControls
            }
            .testTag("full_screen_player_container")
    ) {
        // Platform AndroidView for Media3 Surface rendering
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exoPlayer
                    useController = false // Use custom elegant jetpack controls instead
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // Custom Overlay controls
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
                                Color.Black.copy(alpha = 0.6f),
                                Color.Transparent,
                                Color.Black.copy(alpha = 0.8f)
                            )
                        )
                    )
            ) {
                // TOP BAR: Title, Back button, Speed toggle
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp)
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
                            Icon(Icons.Filled.ArrowBack, "Back to library", tint = Color.White)
                        }
                        Spacer(modifier = Modifier.width(16.dp))
                        Column {
                            Text(
                                text = movie.title,
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                color = Color.White
                            )
                            Text(
                                text = "Streaming in Adaptive Bitrate (" + (if (movie.videoUrl.contains(".m3u8")) "HLS" else "MP4") + ")",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.LightGray
                            )
                        }
                    }

                    // Speed controller
                    Button(
                        onClick = {
                            currentSpeed = when (currentSpeed) {
                                1.0f -> 1.25f
                                1.25f -> 1.5f
                                1.5f -> 2.0f
                                else -> 1.0f
                            }
                            exoPlayer.setPlaybackSpeed(currentSpeed)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color.Black.copy(alpha = 0.6f))
                    ) {
                        Icon(Icons.Filled.Speed, "Playback speed", modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("${currentSpeed}x", style = MaterialTheme.typography.labelMedium)
                    }
                }

                // CENTER PLAYBACK CONTROLS (Rewind, Play/Pause, Forward)
                Row(
                    modifier = Modifier.align(Alignment.Center),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(32.dp)
                ) {
                    IconButton(
                        onClick = {
                            val newPos = (exoPlayer.currentPosition - 10000L).coerceAtLeast(0L)
                            exoPlayer.seekTo(newPos)
                            playbackPosition = newPos
                        },
                        modifier = Modifier
                            .size(54.dp)
                            .background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                            .testTag("player_rewind_button")
                    ) {
                        Icon(Icons.Filled.Replay10, "10 Seconds rew", tint = Color.White, modifier = Modifier.size(32.dp))
                    }

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
                            contentDescription = "Play slash pause",
                            tint = Color.Black,
                            modifier = Modifier.size(40.dp)
                        )
                    }

                    IconButton(
                        onClick = {
                            val total = exoPlayer.duration
                            val newPos = (exoPlayer.currentPosition + 10000L).coerceAtMost(if (total > 0) total else Long.MAX_VALUE)
                            exoPlayer.seekTo(newPos)
                            playbackPosition = newPos
                        },
                        modifier = Modifier
                            .size(54.dp)
                            .background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                            .testTag("player_forward_button")
                    ) {
                        Icon(Icons.Filled.Forward10, "10 seconds fwd", tint = Color.White, modifier = Modifier.size(32.dp))
                    }
                }

                // BOTTOM CONTROLS (Progress Slider, Timer, Seek markers)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 16.dp)
                        .align(Alignment.BottomCenter),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val posSec = playbackPosition / 1000
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

                    // Interactive seek bar
                    Slider(
                        value = playbackPosition.toFloat(),
                        onValueChange = { value ->
                            playbackPosition = value.toLong()
                            exoPlayer.seekTo(playbackPosition)
                        },
                        valueRange = 0f..(if (videoDuration > 0) videoDuration.toFloat() else 100f),
                        colors = SliderDefaults.colors(
                            thumbColor = Color.Red,
                            activeTrackColor = Color.Red,
                            inactiveTrackColor = Color.LightGray.copy(alpha = 0.5f)
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("player_seek_slider")
                    )
                }
            }
        }

        // BUFFERING GRAPHICS
        if (isBuffering && playbackError == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.3f)),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = Color.Red)
            }
        }

        // ERROR ALERT DIALOG OR BOX COVER
        if (playbackError != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.85f)),
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
                        Icon(Icons.Filled.ErrorOutline, "Error", tint = Color.Red, modifier = Modifier.size(48.dp))
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(text = "Codec or Channel Error", color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(text = playbackError ?: "Fallback failed", color = Color.Gray)
                        Spacer(modifier = Modifier.height(24.dp))
                        Button(
                            onClick = {
                                playbackError = null
                                exoPlayer.prepare()
                                exoPlayer.play()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color.Red)
                        ) {
                            Text("Retry Connection")
                        }
                    }
                }
            }
        }
    }
}
