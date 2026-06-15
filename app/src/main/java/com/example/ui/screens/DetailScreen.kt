package com.example.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.example.data.model.Movie
import com.example.ui.theme.PiBlack
import com.example.ui.theme.PiCardBg
import com.example.ui.theme.PiGrey
import com.example.ui.theme.PiRed
import com.example.ui.theme.PiTextPrimary
import com.example.ui.theme.PiTextSecondary
import com.example.ui.viewmodel.PiStreamViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(
    viewModel: PiStreamViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val movie by viewModel.selectedMovie.collectAsState()
    val allMovies by viewModel.movies.collectAsState()

    // Filter similar recommendations
    val recommendations = remember(movie, allMovies) {
        allMovies.filter { it.id != movie?.id }
    }

    if (movie == null) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(PiBlack),
            contentAlignment = Alignment.Center
        ) {
            Text("Select a media asset from library", color = Color.White)
        }
        return
    }

    val activeMovie = movie!!
    val hasProgress = activeMovie.progress > 0.02f
    val minutesLeft = remember(activeMovie) {
        if (activeMovie.durationSeconds > 0) {
            val remain = activeMovie.durationSeconds - activeMovie.progressSeconds
            remain / 60
        } else {
            0L
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = PiBlack,
        topBar = {
            TopAppBar(
                title = { Text("Details", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)) },
                navigationIcon = {
                    IconButton(onClick = onBack, modifier = Modifier.testTag("detail_back_button")) {
                        Icon(Icons.Filled.ArrowBack, "Back icon", tint = Color.White)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = PiBlack.copy(alpha = 0.9f),
                    titleContentColor = Color.White
                )
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
        ) {
            // Hero Image backdrop
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(240.dp)
            ) {
                AsyncImage(
                    model = activeMovie.thumbnailUrl,
                    contentDescription = activeMovie.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )

                // Overlay Gradient
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                colors = listOf(Color.Transparent, PiBlack.copy(alpha = 0.6f), PiBlack),
                                startY = 100f
                            )
                        )
                )

                _PlayOverlayIcon(
                    modifier = Modifier.align(Alignment.Center)
                ) {
                    viewModel.launchPlayer(activeMovie)
                }
            }

            // Text Metadata Detail Section
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
            ) {
                Text(
                    text = activeMovie.title,
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Black),
                    color = Color.White
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Tags details row
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = activeMovie.year.toString(),
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                        color = PiTextSecondary
                    )

                    Box(
                        modifier = Modifier
                            .background(PiGrey, shape = RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = activeMovie.rating,
                            color = Color.White,
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.ExtraBold)
                        )
                    }

                    Text(
                        text = activeMovie.duration,
                        style = MaterialTheme.typography.bodyMedium,
                        color = PiTextSecondary
                    )

                    Text(
                        text = "Score ★${activeMovie.score}",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, color = Color.Yellow)
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Playback Launcher Actions (with resume states)
                if (hasProgress) {
                    // Playback progress representation
                    Column(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "Remaining: ~${minutesLeft} mins left",
                                style = MaterialTheme.typography.labelMedium,
                                color = PiRed,
                                fontWeight = FontWeight.Bold
                            )
                            val resumeMins = activeMovie.progressSeconds / 60
                            val resumeSecs = activeMovie.progressSeconds % 60
                            Text(
                                "Resuming at ${resumeMins}m ${resumeSecs}s",
                                style = MaterialTheme.typography.labelMedium,
                                color = PiTextSecondary
                            )
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                        LinearProgressIndicator(
                            progress = { activeMovie.progress.coerceIn(0f, 1f) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(3.dp)),
                            color = PiRed,
                            trackColor = PiGrey
                        )
                    }

                    Button(
                        onClick = { viewModel.launchPlayer(activeMovie) },
                        colors = ButtonDefaults.buttonColors(containerColor = PiRed),
                        shape = RoundedCornerShape(6.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                            .testTag("resume_playback_button")
                    ) {
                        Icon(Icons.Filled.PlayArrow, "Resume", tint = Color.White)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Resume Playback", fontWeight = FontWeight.Bold, color = Color.White)
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    OutlinedButton(
                        onClick = {
                            // Reset local history seek tracker and play fresh
                            viewModel.trackPlaybackProgress(activeMovie.id, 0f, 0L, 0L)
                            viewModel.launchPlayer(activeMovie)
                        },
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                        shape = RoundedCornerShape(6.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                            .testTag("restart_playback_button")
                    ) {
                        Icon(Icons.Filled.Replay, "Replay", tint = Color.White)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Watch From Beginning", fontWeight = FontWeight.SemiBold)
                    }
                } else {
                    Button(
                        onClick = { viewModel.launchPlayer(activeMovie) },
                        colors = ButtonDefaults.buttonColors(containerColor = PiRed),
                        shape = RoundedCornerShape(6.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                            .testTag("play_movie_button")
                    ) {
                        Icon(Icons.Filled.PlayArrow, "Play", tint = Color.White)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Play Movie Stream", fontWeight = FontWeight.Bold, color = Color.White)
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Short Description
                Text(
                    text = activeMovie.description,
                    style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 22.sp),
                    color = PiTextPrimary,
                    textAlign = TextAlign.Justify
                )

                Spacer(modifier = Modifier.height(20.dp))

                // Action Buttons Row (Add bookmarks, Offline sync description)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    // Favorite Coordinator Sync (Reactively binds to local room)
                    val isFavorite = activeMovie.isFavorite
                    _ActionIconButton(
                        icon = if (isFavorite) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                        label = if (isFavorite) "Bookmarked" else "My List",
                        tint = if (isFavorite) PiRed else PiTextPrimary,
                        onClick = { viewModel.toggleFavoriteMovie(activeMovie.id, isFavorite) }
                    )

                    _ActionIconButton(
                        icon = Icons.Outlined.FileDownload,
                        label = "Go Offline",
                        tint = PiTextPrimary,
                        onClick = {
                            // Simulate download offline media
                        }
                    )

                    _ActionIconButton(
                        icon = Icons.Filled.Share,
                        label = "Share Sync",
                        tint = PiTextPrimary,
                        onClick = {
                            // Share link
                        }
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Recommendations Shelf section
                if (recommendations.isNotEmpty()) {
                    Text(
                        "More Like This",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = Color.White,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )

                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        items(recommendations) { rec ->
                            Card(
                                modifier = Modifier
                                    .width(130.dp)
                                    .height(150.dp)
                                    .clickable { viewModel.selectMovie(rec) },
                                shape = RoundedCornerShape(6.dp)
                            ) {
                                Box(modifier = Modifier.fillMaxSize()) {
                                    AsyncImage(
                                        model = rec.thumbnailUrl,
                                        contentDescription = rec.title,
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Crop
                                    )
                                    Box(
                                        modifier = Modifier
                                            .fillMaxSize()
                                            .background(
                                                Brush.verticalGradient(
                                                    colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.8f))
                                                )
                                            )
                                    )
                                    Text(
                                        text = rec.title,
                                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                        color = Color.White,
                                        modifier = Modifier
                                            .align(Alignment.BottomStart)
                                            .padding(6.dp),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(60.dp))
            }
        }
    }
}

@Composable
private fun _PlayOverlayIcon(
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    IconButton(
        onClick = onClick,
        modifier = modifier
            .size(64.dp)
            .background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
            .border(2.dp, Color.White.copy(alpha = 0.8f), shape = RoundedCornerShape(50))
    ) {
        Icon(
            imageVector = Icons.Outlined.PlayArrow,
            contentDescription = "Active Play icon overlay",
            tint = Color.White,
            modifier = Modifier.size(36.dp)
        )
    }
}

@Composable
private fun _ActionIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    tint: Color,
    onClick: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clickable { onClick() }
            .padding(10.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = tint,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
            color = PiTextSecondary
        )
    }
}
