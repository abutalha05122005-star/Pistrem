package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ui.screens.DetailScreen
import com.example.ui.screens.HomeScreen
import com.example.ui.screens.PlayerScreen
import com.example.ui.screens.SettingsScreen
import com.example.ui.theme.MyApplicationTheme
import com.example.ui.viewmodel.PiStreamViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MyApplicationTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AppNavigationOrchestrator()
                }
            }
        }
    }
}

@Composable
fun AppNavigationOrchestrator(
    viewModel: PiStreamViewModel = viewModel()
) {
    val activePlayingMovie by viewModel.activePlayingMovie.collectAsStateWithLifecycle()
    val selectedMovie by viewModel.selectedMovie.collectAsStateWithLifecycle()
    var isShowingSettings by remember { mutableStateOf(false) }

    when {
        // Player: Full screen ExoPlayer takes priority 1
        activePlayingMovie != null -> {
            PlayerScreen(
                movie = activePlayingMovie!!,
                viewModel = viewModel,
                onClosePlayer = { viewModel.launchPlayer(null) }
            )
        }

        // Details overview modal takes priority 2
        selectedMovie != null -> {
            DetailScreen(
                viewModel = viewModel,
                onBack = { viewModel.selectMovie(null) }
            )
        }

        // Configuration Settings dashboard takes priority 3
        isShowingSettings -> {
            SettingsScreen(
                viewModel = viewModel,
                onBack = { isShowingSettings = false }
            )
        }

        // Main Home Screen
        else -> {
            HomeScreen(
                viewModel = viewModel,
                onNavigateToSettings = { isShowingSettings = true }
            )
        }
    }
}
