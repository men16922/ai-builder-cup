import type { WebIdentityVerifier } from '../auth/organization-access';
import type { CloudStore } from '../store/store';
import { CloudWorkflow } from '../workflow/workflow';
import { CloudRunCollector } from '../cloud-run/collector';
import { principalKey, type CloudRunTransport } from '../cloud-run/transport';
import type { GcpAnalysisModel } from '../google/gemini';
import { gcpServerConfiguration } from './configuration';
import { GcpWebAccess, type GcpWebSession } from '../auth/web-access';
import { GcpObservations } from '../workflow/observations';
import { GcpAnalyses } from '../workflow/analyses';
import { GcpOperations } from '../workflow/operations';
import { createCloudRunAdapters } from '../cloud-run/inspection-adapter';
import type { GcpApiServices } from '../http/api';
import { sameOwner, type CloudBinding } from '@contracts/core/operations';
import type { CloudRunTelemetryTransport } from '../cloud-run/telemetry-transport';
import { GcpNotifications, type GcpPushPorts } from '../notifications/notifications';
import { GcpAgentTasks, type ChiefPort } from '../crew/agent-tasks';
import { GcpOverview, type OverviewPorts } from '../crew/overview';
import { GcpMobility, type VehicleReasoner, type MobilityPlaces } from '../mobility/service';
import { approvalReviewPort } from '../crew/approval-review';
import { GcpPlatform, type AgentCardSource } from '../platform/platform';
/** Fixed composition contract; only the platform entry constructs real credentials and SDK clients. */
export function composeGcpServices(input: unknown, ports: {
  identity: WebIdentityVerifier; store: CloudStore; mode: 'live' | 'synthetic'; principal: string; sessionId: string;
  transport(binding: CloudBinding): CloudRunTransport; model: GcpAnalysisModel;
  telemetry?(binding: CloudBinding): CloudRunTelemetryTransport;
  notifications?: GcpPushPorts;
  mobility?: { reasoner?: VehicleReasoner; places?: MobilityPlaces; browserMapKey?: string };
  agents?: { chief: ChiefPort; approvalKey: Buffer; overview?: OverviewPorts; card?: AgentCardSource };
}): GcpApiServices {
  const config = gcpServerConfiguration.parse(input);
  if (ports.principal !== config.credentials.serviceAccountEmail || ports.model.engine !== (ports.mode === 'live' ? 'gemini' : 'synthetic-fixture')
    || ports.model.modelId !== config.model.modelId || (ports.model.enabled !== false) !== config.model.enabled) throw Error('GCP composition does not match the configured identity or model.');
  if (!!config.agents?.enabled !== !!ports.agents) throw Error('The agent gateway does not match the configuration.');
  if (config.mobility?.enabled && ports.mobility?.reasoner && ports.mobility.reasoner.engine !== (ports.mode === 'live' ? 'gemini' : 'offline-fixture')) throw Error('Mobility reasoner mode mismatch.');
  const access = new GcpWebAccess(ports.identity, ports.store);
  if (config.telemetry?.enabled && !ports.telemetry) throw Error('The configured telemetry transport is missing.');
  if (!!config.notifications?.enabled !== !!ports.notifications || ports.notifications && ports.notifications.dataMode !== ports.mode) throw Error('GCP notification transport does not match the configuration.');
  const registrations = config.resources.map(resource => {
    const transport = ports.transport(resource.binding); if (transport.dataMode !== ports.mode) throw Error('GCP transport mode mismatch.');
    const telemetry = config.telemetry?.enabled ? ports.telemetry!(resource.binding) : undefined;
    return { ...resource, dataMode: ports.mode, telemetryEnabled: !!telemetry, collector: new CloudRunCollector({ binding: resource.binding, transport, expectedIdentity: principalKey(ports), telemetry }) };
  });
  // Crew access follows resource ownership: the same rule that already scopes observations, plans and executions.
  const entitled = (session: GcpWebSession) => registrations.some(item => sameOwner(item.binding.owner, session.context.owner) && item.binding.workspaceId === session.context.workspaceId);
  // A signed-in driver owns only their actor-private simulated vehicle. Cloud service
  // ownership remains a separate requirement for operational reads and changes.
  const mobilityEntitled = (session: GcpWebSession) => config.scopes.some(scope => scope.edition === session.scope.edition && scope.workspaceId === session.scope.workspaceId
    && (scope.edition === 'personal' ? session.context.owner.kind === 'personal' && session.context.owner.userId === session.identity.actorId
      : session.context.owner.kind === 'organization' && scope.organizationId === session.context.owner.organizationId));
  const observations = new GcpObservations(ports.store, access, registrations);
  const workflow = new CloudWorkflow(ports.store, createCloudRunAdapters(registrations, ports.mode, async () => { throw Error('Only the authenticated execution facade may dispatch.'); }));
  const analyses = new GcpAnalyses(ports.store, access, observations, workflow, ports.model);
  const mobility = config.mobility?.enabled ? new GcpMobility(ports.store, access, mobilityEntitled, ports.mobility?.reasoner, config.mobility.placesEnabled ? ports.mobility?.places : undefined, Date.now, ports.mobility?.browserMapKey ?? null) : undefined;
  const platform = new GcpPlatform(access, { modelId: config.model.modelId, modelLocation: config.model.location, crew: config.agents?.enabled ? ['chief','diagnosis','guardian','ops'] : [],
    mapsMcp: !!config.mobility?.placesEnabled, placesPhotos: !!config.mobility?.placesEnabled, agents: !!config.agents?.enabled }, ports.agents?.card, mobility);
  return { access, observations, analyses, mobility, platform, operations: new GcpOperations(ports.store, access, analyses, registrations), notifications: new GcpNotifications(ports.store, access, ports.notifications), agents: ports.agents ? new GcpAgentTasks(ports.store, access, ports.agents.chief, ports.agents.approvalKey, entitled, Date.now,approvalReviewPort(config.agents?.executionTargets ?? [],ports.transport)) : undefined,
    overview: ports.agents?.overview && config.agents?.services.length ? new GcpOverview(access, config.agents.services.map(item => ({ name: item.name, project: config.projectId, region: item.region })), ports.agents.overview, entitled) : undefined, publicOrigin: config.publicOrigin,
    web: Object.fromEntries(config.scopes.map(scope => [scope.edition, { configured: true, scope, identity: { method: 'firebase-google', firebase: config.firebase } }])) };
}
