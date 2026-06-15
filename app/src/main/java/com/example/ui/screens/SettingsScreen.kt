package com.example.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.theme.PiBlack
import com.example.ui.theme.PiCardBg
import com.example.ui.theme.PiGrey
import com.example.ui.theme.PiRed
import com.example.ui.theme.PiDarkRed
import com.example.ui.theme.PiTextPrimary
import com.example.ui.theme.PiTextSecondary
import com.example.ui.viewmodel.ConnectionMode
import com.example.ui.viewmodel.PiStreamViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: PiStreamViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val serverIp by viewModel.serverIp.collectAsStateWithLifecycle()
    val serverPort by viewModel.serverPort.collectAsStateWithLifecycle()
    val serverTunnel by viewModel.serverTunnel.collectAsStateWithLifecycle()
    val connectionMode by viewModel.connectionMode.collectAsStateWithLifecycle()
    val isConnected by viewModel.isConnected.collectAsStateWithLifecycle()
    val isSyncing by viewModel.isSyncing.collectAsStateWithLifecycle()
    val syncMessage by viewModel.syncMessage.collectAsStateWithLifecycle()

    val isLoggedIn by viewModel.isLoggedIn.collectAsStateWithLifecycle()
    val userEmail by viewModel.userEmail.collectAsStateWithLifecycle()
    val authToken by viewModel.authToken.collectAsStateWithLifecycle()
    val authError by viewModel.authError.collectAsStateWithLifecycle()
    val isAuthLoading by viewModel.isAuthLoading.collectAsStateWithLifecycle()
    val deviceStatus by viewModel.deviceStatus.collectAsStateWithLifecycle()

    var editableIp by remember { mutableStateOf(serverIp) }
    var editablePort by remember { mutableStateOf(serverPort) }
    var editableTunnel by remember { mutableStateOf(serverTunnel) }
    var selectedMode by remember { mutableStateOf(connectionMode) }

    var emailInput by remember { mutableStateOf("") }
    var passwordInput by remember { mutableStateOf("") }
    var isRegisteringMode by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = PiBlack,
        topBar = {
            TopAppBar(
                title = { Text("Server Hub Configuration", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)) },
                navigationIcon = {
                    IconButton(onClick = onBack, modifier = Modifier.testTag("settings_back_button")) {
                        Icon(Icons.Filled.ArrowBack, "Back Arrow", tint = Color.White)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = PiBlack,
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
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            
            // SECTION 1: CONNECTIVITY MODE CHOOSER
            _CardContainer(title = "Network Access Channels") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedMode = ConnectionMode.LOCAL_DEMO }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = (selectedMode == ConnectionMode.LOCAL_DEMO),
                            onClick = { selectedMode = ConnectionMode.LOCAL_DEMO },
                            colors = RadioButtonDefaults.colors(selectedColor = PiRed)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text("Simulated Demo Mode", color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text("Plays fast public HLS streams in emulator immediately.", color = PiTextSecondary, style = MaterialTheme.typography.bodySmall)
                        }
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedMode = ConnectionMode.LAN }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = (selectedMode == ConnectionMode.LAN),
                            onClick = { selectedMode = ConnectionMode.LAN },
                            colors = RadioButtonDefaults.colors(selectedColor = PiRed)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text("Local Network Mode (LAN)", color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text("Connect directly to Raspberry Pi local address over local WiFi.", color = PiTextSecondary, style = MaterialTheme.typography.bodySmall)
                        }
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedMode = ConnectionMode.REMOTE_TUNNEL }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = (selectedMode == ConnectionMode.REMOTE_TUNNEL),
                            onClick = { selectedMode = ConnectionMode.REMOTE_TUNNEL },
                            colors = RadioButtonDefaults.colors(selectedColor = PiRed)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text("Remote Secure Internet Mode", color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text("Connect securely via Cloudflare / Tailscale dynamic route anywhere.", color = PiTextSecondary, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }

            // SECTION 2: ENDPOINT INPUT LAYOUTS
            AnimatedContent(
                targetState = selectedMode,
                transitionSpec = { fadeIn() togetherWith fadeOut() },
                label = "input_transition"
            ) { target ->
                when (target) {
                    ConnectionMode.LOCAL_DEMO -> {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(PiCardBg, shape = RoundedCornerShape(8.dp))
                                .padding(16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "No hardware configurations needed. Using auto-seeded high-fidelity demonstration content.",
                                color = PiTextPrimary,
                                textAlign = TextAlign.Center,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                    ConnectionMode.LAN -> {
                        _CardContainer(title = "Local LAN Raspberry Pi Host") {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                OutlinedTextField(
                                    value = editableIp,
                                    onValueChange = { editableIp = it },
                                    label = { Text("Local Pi IP Address") },
                                    leadingIcon = { Icon(Icons.Outlined.Computer, "IP", tint = PiTextSecondary) },
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedTextColor = Color.White,
                                        unfocusedTextColor = Color.White,
                                        focusedBorderColor = PiRed,
                                        unfocusedBorderColor = PiGrey
                                    ),
                                    modifier = Modifier.fillMaxWidth().testTag("local_ip_input")
                                )

                                OutlinedTextField(
                                    value = editablePort,
                                    onValueChange = { editablePort = it },
                                    label = { Text("Server Port") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedTextColor = Color.White,
                                        unfocusedTextColor = Color.White,
                                        focusedBorderColor = PiRed,
                                        unfocusedBorderColor = PiGrey
                                    ),
                                    modifier = Modifier.fillMaxWidth().testTag("local_port_input")
                                )
                            }
                        }
                    }
                    ConnectionMode.REMOTE_TUNNEL -> {
                        _CardContainer(title = "Secure Cloudflare Tunnel / DNS") {
                            Column {
                                OutlinedTextField(
                                    value = editableTunnel,
                                    onValueChange = { editableTunnel = it },
                                    label = { Text("Secure Remote URL Tunnel") },
                                    placeholder = { Text("https://pistream.yourtunnel.workers.dev") },
                                    leadingIcon = { Icon(Icons.Filled.CloudQueue, "Tunnel", tint = PiTextSecondary) },
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedTextColor = Color.White,
                                        unfocusedTextColor = Color.White,
                                        focusedBorderColor = PiRed,
                                        unfocusedBorderColor = PiGrey
                                    ),
                                    modifier = Modifier.fillMaxWidth().testTag("remote_url_input")
                                )
                            }
                        }
                    }
                }
            }

            // Save & Check Connection Status indicator button
            Button(
                onClick = {
                    viewModel.setConnectionConfig(
                        mode = selectedMode,
                        ip = editableIp,
                        port = editablePort,
                        tunnel = editableTunnel
                    )
                },
                colors = ButtonDefaults.buttonColors(containerColor = PiRed),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("apply_connection_button"),
                shape = RoundedCornerShape(6.dp)
            ) {
                if (isSyncing) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color.White)
                } else {
                    Icon(Icons.Filled.Sync, "Connect")
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Apply & Ping Media Hub", fontWeight = FontWeight.Bold, color = Color.White)
                }
            }

            // SECTION 3: Pi hardware status response (if connected)
            if (isConnected && deviceStatus != null) {
                _CardContainer(title = "Raspberry Pi Server Metrics") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("Hub Name:", color = PiTextSecondary, style = MaterialTheme.typography.bodyMedium)
                            Text(deviceStatus!!.serverName, color = Color.White, fontWeight = FontWeight.Bold)
                        }
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("Software version:", color = PiTextSecondary, style = MaterialTheme.typography.bodyMedium)
                            Text(deviceStatus!!.version, color = Color.White)
                        }
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("FFmpeg (HLS active):", color = PiTextSecondary, style = MaterialTheme.typography.bodyMedium)
                            Text(if (deviceStatus!!.ffmpegAvailable) "Active ✔" else "Unconfigured ✘", color = if (deviceStatus!!.ffmpegAvailable) Color.Green else Color.Red, fontWeight = FontWeight.Bold)
                        }
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("Available Storage:", color = PiTextSecondary, style = MaterialTheme.typography.bodyMedium)
                            Text(deviceStatus!!.diskFreeSpace, color = Color.LightGray)
                        }
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Text("Base Endpoint:", color = PiTextSecondary, style = MaterialTheme.typography.bodyMedium)
                            Text(deviceStatus!!.localAddress, color = PiRed)
                        }
                    }
                }
            }

            // SECTION 4: USER AUTHENTICATION PANEL
            _CardContainer(title = if (isLoggedIn) "Active Profiler Session" else "Credentials Authentication") {
                if (isLoggedIn) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(Icons.Filled.AccountCircle, "Profile", tint = PiTextPrimary, modifier = Modifier.size(54.dp))
                        Text(userEmail, fontWeight = FontWeight.Bold, color = Color.White)
                        
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(PiBlack, shape = RoundedCornerShape(4.dp))
                                .padding(12.dp)
                        ) {
                            Column {
                                Text("JWT TOKEN", style = MaterialTheme.typography.labelSmall, color = PiTextSecondary)
                                Text(
                                    text = authToken.take(30) + "...",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Color.Green,
                                    maxLines = 1
                                )
                            }
                        }

                        Button(
                            onClick = { viewModel.submitLogout() },
                            colors = ButtonDefaults.buttonColors(containerColor = PiDarkRed),
                            modifier = Modifier.fillMaxWidth().testTag("logout_button")
                        ) {
                            Text("Logout Session")
                        }
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            text = if (isRegisteringMode) "Register your Pi account credentials" else "Access your protected media library",
                            style = MaterialTheme.typography.bodySmall,
                            color = PiTextSecondary
                        )

                        OutlinedTextField(
                            value = emailInput,
                            onValueChange = { emailInput = it },
                            label = { Text("Account Email") },
                            leadingIcon = { Icon(Icons.Outlined.Mail, "Email", tint = PiTextSecondary) },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                focusedBorderColor = PiRed,
                                unfocusedBorderColor = PiGrey
                            ),
                            modifier = Modifier.fillMaxWidth().testTag("auth_email_input")
                        )

                        OutlinedTextField(
                            value = passwordInput,
                            onValueChange = { passwordInput = it },
                            label = { Text("Secured Password") },
                            visualTransformation = PasswordVisualTransformation(),
                            leadingIcon = { Icon(Icons.Outlined.Lock, "Lock", tint = PiTextSecondary) },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                focusedBorderColor = PiRed,
                                unfocusedBorderColor = PiGrey
                            ),
                            modifier = Modifier.fillMaxWidth().testTag("auth_password_input")
                        )

                        if (authError != null) {
                            Text(authError!!, color = Color.Red, style = MaterialTheme.typography.bodySmall)
                        }

                        Button(
                            onClick = {
                                if (isRegisteringMode) {
                                    viewModel.submitRegister(emailInput, passwordInput)
                                } else {
                                    viewModel.submitLogin(emailInput, passwordInput)
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(45.dp)
                                .testTag("login_signup_submit_button")
                        ) {
                            if (isAuthLoading) {
                                CircularProgressIndicator(color = Color.Black, modifier = Modifier.size(20.dp))
                            } else {
                                Text(
                                    text = if (isRegisteringMode) "Register Account" else "Sign In",
                                    color = Color.Black,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }

                        TextButton(
                            onClick = { isRegisteringMode = !isRegisteringMode },
                            modifier = Modifier.align(Alignment.CenterHorizontally).testTag("auth_mode_toggle_button")
                        ) {
                            Text(
                                text = if (isRegisteringMode) "Already have an account? Sign In" else "New to PiStream? Sign Up Now",
                                color = PiTextPrimary
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(40.dp))
        }
    }
}

@Composable
private fun _CardContainer(
    title: String,
    content: @Composable () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = PiCardBg),
        shape = RoundedCornerShape(8.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.ExtraBold),
                color = Color.White
            )
            HorizontalDivider(color = PiGrey)
            content()
        }
    }
}
