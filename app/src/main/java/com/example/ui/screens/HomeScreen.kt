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
import androidx.compose.material.icons.outlined.Cabin
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.compose.rememberAsyncImagePainter
import coil.request.ImageRequest
import com.example.data.model.Movie
import com.example.data.model.UserProfile
import com.example.ui.theme.PiAccentNeon
import com.example.ui.theme.PiBlack
import com.example.ui.theme.PiCardBg
import com.example.ui.theme.PiGrey
import com.example.ui.theme.PiRed
import com.example.ui.theme.PiTextPrimary
import com.example.ui.theme.PiTextSecondary
import com.example.ui.viewmodel.ConnectionMode
import com.example.ui.viewmodel.PiStreamViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: PiStreamViewModel,
    onNavigateToSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    val movies by viewModel.filteredMovies.collectAsStateWithLifecycle()
    val continueWatchingList by viewModel.continueWatching.collectAsStateWithLifecycle()
    val favoritesList by viewModel.favorites.collectAsStateWithLifecycle()
    val searchQuery by viewModel.searchQuery.collectAsStateWithLifecycle()
    val isConnected by viewModel.isConnected.collectAsStateWithLifecycle()
    val currentMode by viewModel.connectionMode.collectAsStateWithLifecycle()
    val syncMessage by viewModel.syncMessage.collectAsStateWithLifecycle()

    val activeProfile by viewModel.activeProfile.collectAsStateWithLifecycle()
    var showProfileDialog by remember { mutableStateOf(false) }

    val trendingMovies = remember(movies) { movies.filter { it.category == "trending" } }
    val libraryMovies = remember(movies) { movies.filter { it.category == "library" } }

    var isSearchActive by remember { mutableStateOf(false) }

    if (showProfileDialog) {
        ProfileManagementDialog(
            viewModel = viewModel,
            onDismiss = { showProfileDialog = false }
        )
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = PiBlack,
        topBar = {
            Column {
                // Connection Mode indicator banner
                ConnectionStatusBar(
                    mode = currentMode,
                    isConnected = isConnected,
                    syncMessage = syncMessage,
                    onRefresh = { viewModel.testAndSyncServer() }
                )

                // Sleek Top Netflix-Style Bar
                CenterAlignedTopAppBar(
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                        containerColor = PiBlack.copy(alpha = 0.95f),
                        titleContentColor = PiRed
                    ),
                    title = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Text(
                                text = "PI",
                                style = MaterialTheme.typography.titleLarge.copy(
                                    fontWeight = FontWeight.ExtraBold,
                                    color = Color.White
                                )
                            )
                            Text(
                                text = "STREAM",
                                style = MaterialTheme.typography.titleLarge.copy(
                                    fontWeight = FontWeight.ExtraBold,
                                    color = PiRed
                                )
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(
                            onClick = onNavigateToSettings,
                            modifier = Modifier.testTag("nav_settings_button")
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Settings,
                                contentDescription = "Settings Panel",
                                tint = PiTextPrimary
                            )
                        }
                    },
                    actions = {
                        IconButton(
                            onClick = { isSearchActive = !isSearchActive },
                            modifier = Modifier.testTag("search_toggle_button")
                        ) {
                            Icon(
                                imageVector = if (isSearchActive) Icons.Filled.Close else Icons.Outlined.Search,
                                contentDescription = "Toggle Search",
                                tint = PiTextPrimary
                            )
                        }
                        IconButton(
                            onClick = { showProfileDialog = true },
                            modifier = Modifier.testTag("profiles_header_button")
                        ) {
                            ProfileBadge(
                                profile = activeProfile,
                                size = 32.dp
                            )
                        }
                    }
                )
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
            ) {
                // Animated Search Panel
                AnimatedVisibility(
                    visible = isSearchActive,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically()
                ) {
                    SearchSection(
                        query = searchQuery,
                        onQueryChange = { viewModel.updateSearchQuery(it) }
                    )
                }

                if (isSearchActive && searchQuery.isNotEmpty()) {
                    // Search Search results
                    Text(
                        text = "Search Results for \"$searchQuery\"",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = Color.White,
                        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 8.dp)
                    )

                    if (movies.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(250.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Filled.Movie, "No match", tint = PiTextSecondary, modifier = Modifier.size(48.dp))
                                Spacer(modifier = Modifier.height(8.dp))
                                Text("No streaming titles match your search.", color = PiTextSecondary)
                            }
                        }
                    } else {
                        // Display Grid-breaking asymmetric flows
                        FlowRow(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp),
                            maxItemsInEachRow = 2
                        ) {
                            movies.forEach { movie ->
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .padding(4.dp)
                                ) {
                                    MovieGridCard(
                                        movie = movie,
                                        onClick = { viewModel.selectMovie(movie) }
                                    )
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(100.dp))
                } else {
                    // Core Dashboard UI Content
                    val featureMovie = remember(trendingMovies) { trendingMovies.firstOrNull() }

                    if (featureMovie != null) {
                        HeroBannerSection(
                            movie = featureMovie,
                            onPlayClick = { viewModel.launchPlayer(featureMovie) },
                            onInfoClick = { viewModel.selectMovie(featureMovie) }
                        )
                    }

                    // Row 1: Continue Watching
                    if (continueWatchingList.isNotEmpty()) {
                        ShelfHeader(title = "Continue Watching")
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.testTag("continue_watching_shelf")
                        ) {
                            items(continueWatchingList, key = { it.id }) { movie ->
                                ContinueWatchingCard(
                                    movie = movie,
                                    onClick = { viewModel.selectMovie(movie) },
                                    onPlayQuick = { viewModel.launchPlayer(movie) }
                                )
                            }
                        }
                    }

                    // Row 2: Trending Media
                    ShelfHeader(title = "Trending Now")
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(trendingMovies, key = { it.id }) { movie ->
                            MovieStandardCard(
                                movie = movie,
                                onClick = { viewModel.selectMovie(movie) }
                            )
                        }
                    }

                    // Row 3: Saved Library / Bookmarks
                    if (favoritesList.isNotEmpty()) {
                        ShelfHeader(title = "My Bookmarked Library")
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(favoritesList, key = { it.id }) { movie ->
                                MovieStandardCard(
                                    movie = movie,
                                    onClick = { viewModel.selectMovie(movie) }
                                )
                            }
                        }
                    }

                    // Row 4: Entire Pi Library Database
                    if (libraryMovies.isNotEmpty()) {
                        ShelfHeader(title = "Pi Media Database")
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(libraryMovies, key = { it.id }) { movie ->
                                MovieStandardCard(
                                    movie = movie,
                                    onClick = { viewModel.selectMovie(movie) }
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(80.dp))
                }
            }
        }
    }
}

@Composable
fun ConnectionStatusBar(
    mode: ConnectionMode,
    isConnected: Boolean,
    syncMessage: String?,
    onRefresh: () -> Unit
) {
    val containerBg = when {
        !isConnected -> Color(0xFFB81D24).copy(alpha = 0.9f)
        mode == ConnectionMode.LOCAL_DEMO -> Color(0xFF1E3A1E).copy(alpha = 0.9f)
        else -> Color(0xFF102E10).copy(alpha = 0.9f)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(containerBg)
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clickable { onRefresh() },
        verticalAlignment = Alignment.CenterVertically
    ) {
        val icon = when {
            !isConnected -> Icons.Filled.WifiOff
            mode == ConnectionMode.LOCAL_DEMO -> Icons.Filled.Tv
            mode == ConnectionMode.LAN -> Icons.Filled.Router
            else -> Icons.Filled.CloudQueue
        }
        val label = when {
            !isConnected -> "Offline / Ping Error"
            mode == ConnectionMode.LOCAL_DEMO -> "Simulated Local Demo (Ready)"
            mode == ConnectionMode.LAN -> "Raspberry Pi Local Mode"
            else -> "Secure Tunnel Remote Mode"
        }

        Icon(
            imageVector = icon,
            contentDescription = "Status",
            tint = Color.White,
            modifier = Modifier.size(16.dp)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = syncMessage ?: "$label - Tap to Ping",
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
            color = Color.White,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        if (isConnected) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(Color.Green, shape = RoundedCornerShape(50))
            )
        }
    }
}

@Composable
fun HeroBannerSection(
    movie: Movie,
    onPlayClick: () -> Unit,
    onInfoClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(340.dp)
    ) {
        // Asymmetric backdrop picture fading into base black
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(movie.thumbnailUrl)
                .crossfade(true)
                .build(),
            contentDescription = "Featured Picture",
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )

        // Gradient fading bottom 60% and top 10%
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            PiBlack.copy(alpha = 0.6f),
                            Color.Transparent,
                            PiBlack.copy(alpha = 0.9f),
                            PiBlack
                        ),
                        startY = 0f
                    )
                )
        )

        // Feature Text Overlays
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Box(
                    modifier = Modifier
                        .background(PiRed, shape = RoundedCornerShape(2.dp))
                        .padding(horizontal = 4.dp, vertical = 2.dp)
                ) {
                    Text(
                        "PREMIER",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.ExtraBold,
                            color = Color.White
                        )
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                _FeaturedDetailBadge(movie.rating)
                Spacer(modifier = Modifier.width(6.dp))
                _FeaturedDetailBadge(movie.duration)
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "IMDb ★${movie.score}",
                    style = MaterialTheme.typography.labelSmall.copy(color = Color.Yellow, fontWeight = FontWeight.Bold)
                )
            }
            
            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = movie.title,
                style = MaterialTheme.typography.titleLarge.copy(
                    fontWeight = FontWeight.Black,
                    color = Color.White
                ),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(10.dp))

            // Action Triggers
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center
            ) {
                Button(
                    onClick = onPlayClick,
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                    shape = RoundedCornerShape(4.dp),
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp)
                        .testTag("hero_play_button")
                ) {
                    Icon(Icons.Filled.PlayArrow, "Play", tint = Color.Black)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Play", color = Color.Black, fontWeight = FontWeight.Bold)
                }

                Button(
                    onClick = onInfoClick,
                    colors = ButtonDefaults.buttonColors(containerColor = PiCardBg),
                    shape = RoundedCornerShape(4.dp),
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp)
                ) {
                    Icon(Icons.Filled.Info, "Details", tint = Color.White)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Info", color = Color.White, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun _FeaturedDetailBadge(text: String) {
    Box(
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.15f), shape = RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 3.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = Color.White
        )
    }
}

@Composable
fun ShelfHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium.copy(
            fontWeight = FontWeight.ExtraBold,
            color = Color.White
        ),
        modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 10.dp)
    )
}

@Composable
fun MovieStandardCard(movie: Movie, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .width(110.dp)
            .height(165.dp)
            .clickable { onClick() }
            .testTag("movie_card_${movie.id}"),
        colors = CardDefaults.cardColors(containerColor = PiGrey),
        shape = RoundedCornerShape(6.dp)
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(movie.thumbnailUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = movie.title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )

            // Rating small tag
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(4.dp)
                    .background(Color.Black.copy(alpha = 0.7f), shape = RoundedCornerShape(2.dp))
                    .padding(horizontal = 4.dp, vertical = 1.dp)
            ) {
                Text(
                    text = movie.rating,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp, fontWeight = FontWeight.Bold),
                    color = Color.White
                )
            }
        }
    }
}

@Composable
fun ContinueWatchingCard(
    movie: Movie,
    onClick: () -> Unit,
    onPlayQuick: () -> Unit
) {
    Card(
        modifier = Modifier
            .width(180.dp)
            .height(130.dp)
            .clickable { onClick() }
            .testTag("continue_card_${movie.id}"),
        colors = CardDefaults.cardColors(containerColor = PiCardBg),
        shape = RoundedCornerShape(8.dp)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                AsyncImage(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(movie.thumbnailUrl)
                        .crossfade(true)
                        .build(),
                    contentDescription = movie.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )

                // Quick Play Circle Overlay
                IconButton(
                    onClick = onPlayQuick,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .size(34.dp)
                        .background(Color.Black.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
                ) {
                    Icon(Icons.Filled.PlayArrow, "Quick Play", tint = Color.White, modifier = Modifier.size(20.dp))
                }
            }

            // Watch Progression Bar (Netflix Red Progress)
            LinearProgressIndicator(
                progress = { movie.progress.coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().height(4.dp),
                color = PiRed,
                trackColor = Color.White.copy(alpha = 0.2f)
            )

            // Dynamic bottom text row holding titles
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = movie.title,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                    color = PiTextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    imageVector = Icons.Filled.Info,
                    contentDescription = "Details Indicator",
                    tint = PiTextSecondary,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}

@Composable
fun MovieGridCard(movie: Movie, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(140.dp)
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = PiCardBg),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(modifier = Modifier.fillMaxSize()) {
            AsyncImage(
                model = movie.thumbnailUrl,
                contentDescription = movie.title,
                modifier = Modifier
                    .width(100.dp)
                    .fillMaxHeight(),
                contentScale = ContentScale.Crop
            )

            Column(
                modifier = Modifier
                    .padding(8.dp)
                    .fillMaxSize(),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        movie.title,
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        movie.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = PiTextSecondary,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(movie.rating, color = PiAccentNeon, style = MaterialTheme.typography.labelSmall)
                    Text(movie.duration, color = PiTextSecondary, style = MaterialTheme.typography.labelSmall)
                    Text(movie.year.toString(), color = PiTextSecondary, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
fun SearchSection(
    query: String,
    onQueryChange: (String) -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        TextField(
            value = query,
            onValueChange = onQueryChange,
            placeholder = { Text("Search TV shows, films, transcripts...", color = PiTextSecondary) },
            leadingIcon = { Icon(Icons.Filled.Search, "Search Icon", tint = PiTextSecondary) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = { onQueryChange("") }) {
                        Icon(Icons.Filled.Clear, "Clear Text", tint = PiTextSecondary)
                    }
                }
            },
            colors = TextFieldDefaults.colors(
                focusedContainerColor = PiGrey,
                unfocusedContainerColor = PiGrey,
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
                focusedIndicatorColor = PiRed,
                unfocusedIndicatorColor = Color.Transparent
            ),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .testTag("search_text_input")
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FlowRow(
    modifier: Modifier = Modifier,
    maxItemsInEachRow: Int = Int.MAX_VALUE,
    content: @Composable () -> Unit
) {
    Layout(
        content = content,
        modifier = modifier
    ) { measurables, constraints ->
        val childConstraints = constraints.copy(minWidth = 0)
        val rows = mutableListOf<List<Placeable>>()
        var currentRow = mutableListOf<Placeable>()
        var currentRowWidth = 0
        var totalHeight = 0
        var maxRowHeight = 0

        measurables.forEach { measurable ->
            val placeable = measurable.measure(childConstraints)
            val spacing = 8.dp.roundToPx()

            if (currentRow.size >= maxItemsInEachRow || (currentRowWidth + placeable.width + spacing > constraints.maxWidth && currentRow.isNotEmpty())) {
                rows.add(currentRow)
                totalHeight += maxRowHeight + spacing
                currentRow = mutableListOf()
                currentRowWidth = 0
                maxRowHeight = 0
            }

            currentRow.add(placeable)
            currentRowWidth += placeable.width + spacing
            maxRowHeight = maxOf(maxRowHeight, placeable.height)
        }
        
        if (currentRow.isNotEmpty()) {
            rows.add(currentRow)
            totalHeight += maxRowHeight
        }

        layout(constraints.maxWidth, maxOf(totalHeight, constraints.minHeight)) {
            var y = 0
            rows.forEach { rowPlaceables ->
                var x = 0
                var rowHeight = 0
                rowPlaceables.forEach { placeable ->
                    placeable.placeRelative(x, y)
                    x += placeable.width + 8.dp.roundToPx()
                    rowHeight = maxOf(rowHeight, placeable.height)
                }
                y += rowHeight + 8.dp.roundToPx()
            }
        }
    }
}

@Composable
fun ProfileBadge(
    profile: UserProfile?,
    size: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier
) {
    val name = profile?.name ?: "Guest"
    val avatarColor = remember(profile) {
        when (profile?.avatarUrl) {
            "avatar_red" -> Color(0xFFE50914)
            "avatar_blue" -> Color(0xFF1E88E5)
            "avatar_green" -> Color(0xFF43A047)
            "avatar_yellow" -> Color(0xFFFDD835)
            "avatar_purple" -> Color(0xFF8E24AA)
            else -> Color(0xFF757575)
        }
    }

    Box(
        modifier = modifier
            .size(size)
            .background(avatarColor, shape = RoundedCornerShape(50))
            .border(1.5.dp, Color.White.copy(alpha = 0.8f), shape = RoundedCornerShape(50)),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = name.take(1).uppercase(),
            style = MaterialTheme.typography.bodyLarge.copy(
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileManagementDialog(
    viewModel: PiStreamViewModel,
    onDismiss: () -> Unit
) {
    val profiles by viewModel.profiles.collectAsStateWithLifecycle()
    val activeProfile by viewModel.activeProfile.collectAsStateWithLifecycle()
    
    var showCreateForm by remember { mutableStateOf(false) }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PiCardBg,
        textContentColor = Color.White,
        titleContentColor = Color.White,
        title = {
            Text(
                text = if (showCreateForm) "Create Profile" else "Who's Watching?",
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
            )
        },
        text = {
            if (showCreateForm) {
                ProfileCreationForm(
                    onSave = { name, avatar, isKids, genre ->
                        viewModel.createOrUpdateProfile(name, avatar, isKids, genre)
                        showCreateForm = false
                    },
                    onCancel = { showCreateForm = false }
                )
            } else {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    profiles.forEach { p ->
                        val isSelected = p.id == activeProfile?.id
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    if (isSelected) Color.White.copy(alpha = 0.12f) else Color.Transparent,
                                    shape = RoundedCornerShape(8.dp)
                                )
                                .border(
                                    width = if (isSelected) 1.5.dp else 0.dp,
                                    color = if (isSelected) PiRed else Color.Transparent,
                                    shape = RoundedCornerShape(8.dp)
                                )
                                .clickable {
                                    viewModel.selectProfile(p)
                                    onDismiss()
                                }
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            ProfileBadge(profile = p, size = 40.dp)
                            Spacer(modifier = Modifier.width(12.dp))
                            
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = p.name,
                                    style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Bold),
                                    color = Color.White
                                )
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "Genre: ${p.favoriteGenre}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = PiTextSecondary
                                    )
                                    if (p.isKids) {
                                        Box(
                                            modifier = Modifier
                                                .background(PiAccentNeon.copy(alpha = 0.2f), shape = RoundedCornerShape(4.dp))
                                                .padding(horizontal = 4.dp, vertical = 1.dp)
                                        ) {
                                            Text(
                                                "KIDS",
                                                style = MaterialTheme.typography.labelSmall.copy(color = PiAccentNeon, fontWeight = FontWeight.Bold)
                                            )
                                        }
                                    }
                                }
                            }

                            if (profiles.size > 1 && !isSelected) {
                                IconButton(
                                    onClick = { viewModel.deleteProfile(p.id) },
                                    modifier = Modifier.size(24.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Filled.Delete,
                                        contentDescription = "Delete Profile",
                                        tint = PiRed,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    }
                    
                    Button(
                        onClick = { showCreateForm = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp)
                            .testTag("create_profile_button"),
                        colors = ButtonDefaults.buttonColors(containerColor = PiRed),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Icon(Icons.Filled.Add, "Add")
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Add New Profile", fontWeight = FontWeight.Bold)
                    }
                }
            }
        },
        confirmButton = {
            if (!showCreateForm) {
                TextButton(onClick = onDismiss) {
                    Text("Close", color = Color.White)
                }
            }
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileCreationForm(
    onSave: (name: String, avatar: String, isKids: Boolean, favoriteGenre: String) -> Unit,
    onCancel: () -> Unit
) {
    var name by remember { mutableStateOf("") }
    var selectAvatar by remember { mutableStateOf("avatar_red") }
    var isKids by remember { mutableStateOf(false) }
    var favoriteGenre by remember { mutableStateOf("Sci-Fi") }
    
    val avatarOptions = listOf("avatar_red", "avatar_blue", "avatar_green", "avatar_yellow", "avatar_purple")
    val genreOptions = listOf("Sci-Fi", "Action", "Documentaries", "Nature")
    
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Profile Name", color = Color.White) },
            maxLines = 1,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = PiRed,
                focusedLabelColor = PiRed,
                unfocusedBorderColor = PiTextSecondary,
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White
            ),
            modifier = Modifier.fillMaxWidth()
        )
        
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text("Kids Content Locking", color = Color.White, style = MaterialTheme.typography.bodyMedium)
            Switch(
                checked = isKids,
                onCheckedChange = { isKids = it },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Color.White,
                    checkedTrackColor = PiRed
                )
            )
        }
        
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Avatar Styling Theme", color = PiTextSecondary, style = MaterialTheme.typography.bodySmall)
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                avatarOptions.forEach { av ->
                    val color = when (av) {
                        "avatar_red" -> Color(0xFFE50914)
                        "avatar_blue" -> Color(0xFF1E88E5)
                        "avatar_green" -> Color(0xFF43A047)
                        "avatar_yellow" -> Color(0xFFFDD835)
                        "avatar_purple" -> Color(0xFF8E24AA)
                        else -> Color.Gray
                    }
                    val isPicked = selectAvatar == av
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .background(color, shape = RoundedCornerShape(50))
                            .border(
                                width = if (isPicked) 2.5.dp else 0.dp,
                                color = if (isPicked) Color.White else Color.Transparent,
                                shape = RoundedCornerShape(50)
                            )
                            .clickable { selectAvatar = av }
                    )
                }
            }
        }
        
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Personalized Fav Genre", color = PiTextSecondary, style = MaterialTheme.typography.bodySmall)
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(vertical = 4.dp)
            ) {
                genreOptions.forEach { gen ->
                    val isChosen = favoriteGenre == gen
                    FilterChip(
                        selected = isChosen,
                        onClick = { favoriteGenre = gen },
                        label = { Text(gen) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = PiRed,
                            selectedLabelColor = Color.White,
                            containerColor = Color.White.copy(alpha = 0.1f),
                            labelColor = PiTextSecondary
                        )
                    )
                }
            }
        }
        
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            horizontalArrangement = Arrangement.End
        ) {
            TextButton(onClick = onCancel) {
                Text("Cancel", color = PiTextSecondary)
            }
            Spacer(modifier = Modifier.width(8.dp))
            Button(
                onClick = { if (name.isNotBlank()) onSave(name, selectAvatar, isKids, favoriteGenre) },
                colors = ButtonDefaults.buttonColors(containerColor = PiRed),
                enabled = name.isNotBlank()
            ) {
                Text("Save", fontWeight = FontWeight.Bold)
            }
        }
    }
}
