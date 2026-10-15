package app.mobileops.agent.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.mobileops.agent.*
import app.mobileops.agent.app.mobility.CallOverlay
import app.mobileops.agent.app.mobility.CallsScreen
import app.mobileops.agent.app.mobility.DiagnosisCluster
import app.mobileops.agent.app.mobility.JourneyAutoAdvance
import app.mobileops.agent.app.mobility.JourneyScreen
import app.mobileops.agent.app.mobility.VehicleAssistance
import app.mobileops.agent.app.mobility.VehicleFailureDialog
import app.mobileops.agent.app.mobility.VehicleScreen
import app.mobileops.agent.app.mobility.VehicleSimulator
import app.mobileops.agent.app.mobility.VehicleViewModel
import app.mobileops.agent.mobility.MobilityCommand
import kotlinx.serialization.json.*

@OptIn(ExperimentalMaterial3Api::class)
/**
 * App route: collects lifecycle-aware state and connects stateless feature UI to ViewModel actions.
 */
@Composable
fun MobileOpsApp(
    model: MobileViewModel,
    onSignIn: (String) -> Unit,
    onboarding: OnboardingViewModel,
    vehicleModel: VehicleViewModel,
) {
    val vehicleBoard by vehicleModel.state.collectAsStateWithLifecycle()
    val state by model.workflowState.collectAsStateWithLifecycle()
    var tab by rememberSaveable(state.scope) { mutableIntStateOf(0) }
    var journeyKind by rememberSaveable(state.scope) { mutableStateOf("restaurant") }
    val connection by model.connectionState.collectAsStateWithLifecycle()
    val mode = connection.mode
    val board by model.agentState.collectAsStateWithLifecycle()
    val notificationState by model.notificationState.collectAsStateWithLifecycle()
    val onboardingState by onboarding.state.collectAsStateWithLifecycle()
    val requestLanguage = stringResource(R.string.agent_request_language)
    // Fresh telemetry is investigated by the server; rendering or refreshing never starts work.
    val liveState by model.liveState.collectAsStateWithLifecycle()
    val pendingNotification by model.notificationAvailable.collectAsStateWithLifecycle()
    BackHandler(enabled = state.scope != null) {
        if (state.selectedId != null) model.backToInbox() else model.leave()
    }
    MaterialTheme(colorScheme = opsColorScheme(isSystemInDarkTheme())) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Image(
                                painterResource(R.drawable.aide_ev),
                                contentDescription = null,
                                modifier = Modifier.size(32.dp),
                            )
                            Column {
                                Text(
                                    stringResource(R.string.app_name),
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    stringResource(R.string.app_tagline),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.tertiary,
                                )
                            }
                        }
                    },
                    actions = {
                        TextButton(onClick = onboarding::replay) {
                            Text(stringResource(R.string.onboarding_help))
                        }
                    },
                )
            },
            // The call surface stays visible on every mobility tab, outside the scrolling page.
            bottomBar = {
                if (!onboardingState.visible && state.scope != null && tab < MOBILITY_TABS)
                    CallOverlay(vehicleBoard, vehicleModel::command, vehicleModel::refresh)
            },
        ) { padding ->
            if (onboardingState.visible) {
                OnboardingScreen(
                    onboardingState,
                    onboarding::next,
                    onboarding::back,
                    onboarding::finish,
                    Modifier.padding(padding),
                )
                return@Scaffold
            }
            Column(
                Modifier.fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (pendingNotification && mode != "synthetic")
                    Card(Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.padding(18.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Title(stringResource(R.string.ui_gcp_work_notification))
                            Text(
                                stringResource(R.string.ui_sign_in_to_the_task_s_workspace),
                            )
                            Button(
                                onClick = { model.openNotification() },
                                enabled = mode == "server" && state.scope != null && !state.busy,
                            ) {
                                Text(stringResource(R.string.ui_open_latest_task))
                            }
                            TextButton(onClick = { model.dismissNotification() }) {
                                Text(
                                    stringResource(R.string.ui_dismiss_notification),
                                )
                            }
                        }
                    }
                if (state.scope == null) {
                    Text(
                        stringResource(R.string.ui_your_next_decision_wherever_you_are),
                        style = MaterialTheme.typography.headlineLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        stringResource(R.string.ui_review_gcp_evidence_explicitly_run_a_fixed),
                    )
                    ConfiguredAccess(model.configuration, liveState, onSignIn, model::leave)
                    Notice(
                        stringResource(R.string.workspace_value_title),
                        stringResource(R.string.workspace_value_body),
                    )
                } else {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(
                            if (mode == "server")
                                (liveState.workspace?.label
                                    ?: stringResource(R.string.ui_server_connection))
                            else if (state.scope!!.owner.kind == "personal")
                                stringResource(R.string.ui_personal_synthetic)
                            else stringResource(R.string.ui_organization_synthetic),
                            modifier = Modifier.weight(1f),
                            color = MaterialTheme.colorScheme.tertiary,
                            fontWeight = FontWeight.Bold,
                        )
                        TextButton(onClick = { model.leave() }) {
                            Text(
                                if (mode == "server") stringResource(R.string.ui_sign_out)
                                else stringResource(R.string.ui_leave_workspace),
                            )
                        }
                    }
                    PrimaryScrollableTabRow(selectedTabIndex = tab, edgePadding = 0.dp) {
                        listOf(
                                R.string.vehicle_tab,
                                R.string.journey_tab,
                                R.string.calls_tab,
                                R.string.assistance_tab,
                            )
                            .let { labels ->
                                if (mode == "server" && liveState.workspace?.edition == "personal")
                                    labels
                                else labels + R.string.operations_tab
                            }
                            .forEachIndexed { index, label ->
                                Tab(
                                    selected = tab == index,
                                    onClick = { tab = index },
                                    text = { Text(stringResource(label), maxLines = 1) },
                                )
                            }
                    }
                    if (tab < MOBILITY_TABS) {
                        VehicleFailureDialog(vehicleBoard.failure, vehicleBoard.failureCode)
                        JourneyAutoAdvance(vehicleBoard, vehicleModel::advanceAutomatically)
                    }
                    when (tab) {
                        0 -> {
                            VehicleScreen(
                                vehicleBoard,
                                vehicleModel::command,
                                vehicleModel::refresh,
                                onJourney = { kind ->
                                    journeyKind = kind
                                    tab = 1
                                },
                                onAssistance = { tab = 3 },
                                // A tapped trip proposal is the driver's explicit trip request.
                                onTrip = { kind, instruction ->
                                    journeyKind = kind
                                    tab = 1
                                    vehicleModel.command(
                                        MobilityCommand.RequestTrip(
                                            kind,
                                            instruction.ifBlank { kind }.take(300),
                                            requestLanguage,
                                        ),
                                    )
                                },
                            )
                            return@Column
                        }
                        1 -> {
                            JourneyScreen(vehicleBoard, vehicleModel::command, journeyKind)
                            return@Column
                        }
                        2 -> {
                            CallsScreen(vehicleBoard, vehicleModel::command)
                            return@Column
                        }
                        3 -> {
                            vehicleBoard.state?.vehicle?.let { vehicle ->
                                DiagnosisCluster(vehicle) {
                                    journeyKind = "poi"
                                    tab = 1
                                }
                            }
                            VehicleAssistance(vehicleBoard, vehicleModel::command, requestLanguage)
                            vehicleBoard.state?.vehicle?.let { vehicle ->
                                VehicleSimulator(vehicle, vehicleBoard.busy, vehicleModel::command)
                            }
                            return@Column
                        }
                    }
                    AgentScreen(
                        board,
                        onSend = { model.sendInstruction(it, requestLanguage) },
                        onSelect = model::selectAgentTask,
                        onDecide = model::decideAgentTask,
                    )
                    if (mode == "server") {
                        NotificationControls(
                            notificationState,
                            model::enableNotifications,
                            model::disableNotifications,
                        )
                        if (liveState.cleanupUnknown) NotificationCleanupNotice()
                    }
                    if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    state.failure?.let { failure ->
                        Notice(
                            stringResource(R.string.ui_refresh_required),
                            failureText(failure),
                        )
                    }
                    if (state.uncertain) {
                        Notice(
                            stringResource(R.string.ui_request_outcome_unknown),
                            stringResource(R.string.ui_do_not_start_a_new_request_read),
                        )
                        OutlinedButton(
                            onClick = { model.recover() },
                            enabled = !state.busy,
                        ) {
                            Text(stringResource(R.string.ui_read_latest_server_record))
                        }
                        if (state.detail != null && state.failure == null)
                            OutlinedButton(
                                onClick = { model.retrySameRequest() },
                                enabled = !state.busy,
                            ) {
                                Text(stringResource(R.string.ui_retry_identical_request))
                            }
                    }
                    if (state.selectedId == null)
                        InboxScreen(state, model::refreshInbox, model::openWorkflow)
                    else {
                        TextButton(
                            onClick = { model.backToInbox() },
                            enabled = !state.busy,
                        ) {
                            Text(stringResource(R.string.ui_inbox))
                        }
                        state.detail?.let {
                            DetailScreen(
                                state,
                                model::reviewEvidence,
                                model::canPerform,
                                model::perform,
                            )
                        }
                        OutlinedButton(
                            onClick = { model.openWorkflow(state.selectedId!!) },
                            enabled = !state.busy,
                        ) {
                            Text(stringResource(R.string.ui_refresh_details))
                        }
                    }
                }
            }
        }
    }
}

/** Vehicle, journey, calls and diagnosis; the operations tab follows them. */
private const val MOBILITY_TABS = 4
