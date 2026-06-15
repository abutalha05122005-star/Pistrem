package com.example.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val PiDarkColorScheme = darkColorScheme(
    primary = PiRed,
    secondary = PiDarkRed,
    tertiary = PiAccentNeon,
    background = PiBlack,
    surface = PiGrey,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onBackground = PiTextPrimary,
    onSurface = PiTextPrimary,
    surfaceVariant = PiCardBg,
    onSurfaceVariant = PiTextSecondary
)

@Composable
fun MyApplicationTheme(
    darkTheme: Boolean = true, // Force dark theme by default
    dynamicColor: Boolean = false, // Set to false to preserve strict movie-theatre black aesthetic
    content: @Composable () -> Unit,
) {
    // We always use the polished dark cinematic color scheme for the movie dashboard experience
    MaterialTheme(
        colorScheme = PiDarkColorScheme,
        typography = Typography,
        content = content
    )
}
