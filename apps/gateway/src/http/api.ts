import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z, ZodError } from 'zod';
import { CloudAccessError } from '@contracts/core/operations';
import { CloudOperationError } from '@contracts/core/workflow';
import { gcpWebConfigurationSchema, type GcpWebConfiguration, type GcpScope } from '@contracts/gcp/observations';
import type { GcpWebAccess } from '../auth/web-access';
import type { GcpObservations } from '../workflow/observations';
import type { GcpAnalyses } from '../workflow/analyses';
import type { GcpOperations } from '../workflow/operations';
import type { GcpNotifications } from '../notifications/notifications';
import type { GcpAgentTasks } from '../crew/agent-tasks';
import type { GcpOverview } from '../crew/overview';
export type GcpApiServices = { access: GcpWebAccess; observations: GcpObservations; publicOrigin: string;
  analyses?: GcpAnalyses;
  operations?: GcpOperations;
  notifications?: GcpNotifications;
  agents?: GcpAgentTasks;
  overview?: GcpOverview;
  web?: Partial<Record<'personal' | 'organization', GcpWebConfiguration>> };
export const isGcpApiPath = (path: string) => path.startsWith('/api/gcp/') || path.startsWith('/api/mobile/v1/') || /^\/api\/(?:personal|organizations)\/v1\/.*\/gcp(?:\/|$)/.test(path);
export async function handleGcpApi(request: IncomingMessage, response: ServerResponse, services?: GcpApiServices) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (status: number, value: unknown) => { if (!response.destroyed) { response.writeHead(status); response.end(JSON.stringify(value)); } };
  const fail = (status: number, code: string) => new CloudOperationError(status, code, 'The GCP request is not available in this scope.');
  try {
    const configRoute = /^\/api\/gcp\/config\/(personal|organization)$/.exec(request.url ?? '');
    if (!services) { if (configRoute && request.method === 'GET') { send(200, { configured: false }); return; } throw fail(503, 'gcp_not_configured'); }
    const origin = new URL(services.publicOrigin);
    if (origin.origin !== services.publicOrigin || !(origin.protocol === 'https:' || origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw fail(503, 'gcp_not_configured');
    const mobile = /^\/api\/mobile\/v1\/(?:personal|organizations)\//.test(request.url ?? '');
    // Native clients have no browser Origin/Fetch Metadata. This exception is confined to
    // the bearer-only mobile facade; the existing web Origin boundary remains unchanged.
    const native = mobile && request.headers.origin === undefined && request.headers['sec-fetch-site'] === undefined;
    if (request.headers.host !== origin.host || (!native && (request.headers.origin ? request.headers.origin !== origin.origin : !(request.method === 'GET' && request.headers['sec-fetch-site'] === 'same-origin')))
      || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') throw fail(403, 'origin_required');
    const url = new URL(request.url ?? '/', origin);
    if (url.hash || url.search && !(mobile && request.method === 'GET' && url.pathname.endsWith('/gcp/inbox'))) throw fail(400, 'invalid_request');
    if (configRoute && request.method === 'GET') {
      const config = gcpWebConfigurationSchema.parse(services.web?.[configRoute[1] as 'personal' | 'organization'] ?? { configured: false });
      if (config.configured && config.scope.edition !== configRoute[1]) throw fail(503, 'gcp_not_configured');
      send(200, config); return;
    }
    const path = mobile ? url.pathname.replace('/api/mobile/v1/personal/', '/api/personal/v1/').replace('/api/mobile/v1/organizations/', '/api/organizations/v1/') : url.pathname;
    const personal = /^\/api\/personal\/v1\/workspaces\/([A-Za-z0-9_.:-]{1,128})\/gcp\/(inbox|resources|observations|analyses|plans|executions|devices|notifications|agent-tasks|overview)(?:\/([a-f0-9-]{36})(?:\/(review|decision|execute|handoff|cancel|revoke|retire))?)?$/.exec(path);
    const organization = /^\/api\/organizations\/v1\/([A-Za-z0-9_.:-]{1,128})\/workspaces\/([A-Za-z0-9_.:-]{1,128})\/gcp\/(inbox|resources|observations|analyses|plans|executions|devices|notifications|agent-tasks|overview)(?:\/([a-f0-9-]{36})(?:\/(review|decision|execute|handoff|cancel|revoke|retire))?)?$/.exec(path);
    if (!personal && !organization) throw fail(404, 'not_found');
    const scope: GcpScope = personal ? { edition: 'personal', workspaceId: personal[1], label: 'Personal' }
      : { edition: 'organization', organizationId: organization![1], workspaceId: organization![2], label: 'Organization' };
    const part = personal?.[2] ?? organization![3], id = personal?.[3] ?? organization?.[4];
    const action = personal?.[4] ?? organization?.[5];
    if (request.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === 'authorization').length !== 1) throw fail(401, 'web_sign_in_required');
    const readJson = async () => {
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw fail(415, 'json_required');
      const key = z.uuid().parse(request.headers['idempotency-key']); const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { const value = Buffer.from(chunk); bytes += value.length; if (bytes > 32768) throw fail(413, 'body_too_large'); chunks.push(value); }
      let input: unknown; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'invalid_json'); }
      return { key, input };
    };
    const session = await services.access.authenticate(request.headers.authorization, scope, mobile ? 'mobile' : 'web');
    if (part === 'inbox') {
      if (!mobile || request.method !== 'GET' || id || action) throw fail(404, 'not_found');
      if (!services.operations) throw fail(503, 'workflow_not_configured');
      const params = [...url.searchParams];
      if (new Set(params.map(([key]) => key)).size !== params.length || params.some(([key]) => !['status', 'limit', 'cursor'].includes(key))) throw fail(400, 'invalid_request');
      const query = Object.fromEntries(params);
      send(200, await services.operations.inbox(session, { ...query, ...(query.limit === undefined ? {} : { limit: Number(query.limit) }) })); return;
    }
    if (part === 'overview') {
      if (!services.overview) throw fail(503, 'overview_not_configured');
      if (request.method !== 'GET' || id || action) throw fail(405, 'method_not_allowed');
      send(200, await services.overview.read(session)); return;
    }
    if (part === 'agent-tasks') {
      if (!services.agents) throw fail(503, 'agents_not_configured');
      if (request.method === 'GET' && !action) { send(200, id ? await services.agents.get(session, id) : await services.agents.list(session)); return; }
      if (request.method !== 'POST' || !(!id && !action || !!id && action === 'decision')) throw fail(405, 'method_not_allowed');
      const { key, input } = await readJson();
      send(200, id ? await services.agents.decide(session, id, input, key) : await services.agents.create(session, input, key)); return;
    }
    const notification = ['devices', 'notifications'].includes(part);
    if (notification && !mobile) throw fail(404, 'not_found');
    if (notification && request.method === 'GET' && part === 'devices' && !id && !action) { send(200, { configured: !!services.notifications?.available }); return; }
    const retirement = part === 'devices' && !!id && ['revoke', 'retire'].includes(action ?? '');
    if (notification && (!services.notifications || !retirement && !services.notifications.available)) throw fail(503, 'notifications_not_configured');
    if (mobile && (part === 'resources' || !id && !notification)) throw fail(404, 'not_found');
    if (request.method === 'GET' && part === 'resources' && !id) { const list = await services.observations.list(session); send(200, { ...list, workflowAvailable: !!services.operations, agentsAvailable: !!services.agents, items: list.items.map(item => ({ ...item, analysisAvailable: services.analyses?.available(item.dataMode, item.telemetryEnabled) ?? false })) }); return; }
    if (request.method === 'GET' && part === 'observations' && id && !action) { send(200, await services.observations.get(session, id)); return; }
    if (part === 'analyses' && !services.analyses) throw fail(503, 'analysis_not_configured');
    if (request.method === 'GET' && part === 'analyses' && id && !action) { send(200, await services.analyses!.get(session, id)); return; }
    const workflow = ['plans', 'executions'].includes(part);
    if (workflow && !services.operations) throw fail(503, 'workflow_not_configured');
    if (request.method === 'GET' && workflow && !action) {
      if (part === 'plans') { send(200, id ? await services.operations!.get(session, id) : await services.operations!.list(session)); return; }
      if (id) { send(200, await services.operations!.getExecution(session, id)); return; }
    }
    const validPost = !id && !action && ['observations', 'analyses', 'devices', 'notifications'].includes(part) || !!id && !!action && (part === 'plans' && ['review', 'decision', 'execute'].includes(action) || part === 'executions' && ['handoff', 'cancel'].includes(action) || retirement);
    if (request.method !== 'POST' || !validPost) throw fail(405, 'method_not_allowed');
    const { key, input } = await readJson();
    if (part === 'devices') {
      if (action === 'retire') {
        const body = z.object({ registrationKey: z.uuid() }).strict().parse(input);
        send(200, await services.notifications!.retire(session, { installationId: id, ...body })); return;
      }
      if (action === 'revoke') {
        const body = z.object({ expectedGeneration: z.uuid() }).strict().parse(input);
        send(200, await services.notifications!.revoke(session, { installationId: id, ...body }));
      } else send(200, await services.notifications!.register(session, input, key));
      return;
    }
    if (part === 'notifications') {
      if (!services.operations) throw fail(503, 'workflow_not_configured');
      send(200, await services.notifications!.open(session, input, async (planId, version) => {
        const view = await services.operations!.get(session, planId);
        if (view.plan.payload.version !== version) throw fail(409, 'notification_changed');
        return view;
      })); return;
    }
    if (part === 'plans') {
      const operation = { review: 'review', decision: 'decide', execute: 'execute' } as const;
      send(200, await services.operations![operation[action as keyof typeof operation]](session, id!, input, key)); return;
    }
    if (part === 'executions') { send(200, action === 'handoff' ? await services.operations!.handoff(session, id!, input, key) : await services.operations!.cancel(session, id!, input, key)); return; }
    send(200, part === 'analyses' ? await services.analyses!.prepare(session, input, key) : await services.observations.collect(session, input, key));
  } catch (error) {
    if (error instanceof CloudOperationError) send(error.status, { code: error.code, message: error.message });
    else if (error instanceof CloudAccessError) send(403, { code: 'scope_denied', message: error.message });
    else if (error instanceof ZodError) send(400, { code: 'invalid_request', message: 'Use the registered request fields.' });
    else send(500, { code: 'gcp_request_failed', message: 'The GCP request could not be completed.' });
  }
}
export function createGcpApiServer(services: GcpApiServices) {
  const server = createServer((request, response) => { void handleGcpApi(request, response, services); });
  server.requestTimeout = 35000; server.headersTimeout = 10000; server.maxHeadersCount = 64; return server;
}
