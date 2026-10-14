import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { SqliteCloudStore } from '../apps/gateway/src/store/sqlite-store';
import { CloudWorkflow } from '../apps/gateway/src/workflow/workflow';
import { createGcpApiServer } from '../apps/gateway/src/http/api';
import { GcpWebAccess } from '../apps/gateway/src/auth/web-access';
import { GcpObservations, type GcpRegistration } from '../apps/gateway/src/workflow/observations';
import { GcpAnalyses } from '../apps/gateway/src/workflow/analyses';
import { GcpOperations } from '../apps/gateway/src/workflow/operations';
import { createCloudRunAdapters } from '../apps/gateway/src/cloud-run/inspection-adapter';
import { cloudRunSnapshotSchema } from '@contracts/gcp/cloud-run';
import type { GcpApiServices } from '../apps/gateway/src/http/api';
import { firebaseIdentityVerifier } from '../apps/gateway/src/auth/firebase-identity';
import { identityActor } from '../apps/gateway/src/auth/organization-access';
import { GcpNotifications } from '../apps/gateway/src/notifications/notifications';
import type { GcpNotification } from '@contracts/gcp/notifications';
import { GcpMobility } from '../apps/gateway/src/mobility/service';

if (process.env.MOBILEOPS_OFFLINE_TEST !== '1') throw Error('Synthetic-only gate requires MOBILEOPS_OFFLINE_TEST=1.');
const directory = mkdtempSync(join(tmpdir(), 'mobileops-android-')), store = new SqliteCloudStore(join(directory, 'test.sqlite'));
const at = Date.parse('2026-10-10T01:00:00.000Z'), now = () => at;
const bundle = JSON.parse(readFileSync(new URL('../apps/android/core/src/main/resources/synthetic-organization.json', import.meta.url), 'utf8'))[0];
const snapshot = cloudRunSnapshotSchema.parse(bundle.original.snapshot); let collections = 0;
const registration: GcpRegistration = { id: 'synthetic-mobile-service', label: 'Synthetic Android service', binding: snapshot.binding, dataMode: 'synthetic', telemetryEnabled: true,
  collector: { async collect() { collections++; return { ...structuredClone(snapshot), id: randomUUID() }; } } };
const issuer = 'https://securetoken.google.com/example-mobileops-demo', uid = 'synthetic-native-user';
const personalBinding = { ...structuredClone(snapshot.binding), owner: { kind: 'personal' as const, userId: identityActor(issuer, uid) }, workspaceId: 'synthetic-firebase-workspace' };
const personal: GcpRegistration = { ...registration, id: 'synthetic-firebase-service', binding: personalBinding,
  collector: { async collect() { collections++; return { ...structuredClone(snapshot), binding: personalBinding, id: randomUUID() }; } } };
const registrations = [registration, personal];
const firebase = firebaseIdentityVerifier({ projectId: 'example-mobileops-demo' }, async token => {
  if (token !== 'synthetic-firebase-token') throw Error();
  return { iss: issuer, aud: 'example-mobileops-demo', uid, sub: uid, exp: at / 1000 + 3600, iat: at / 1000 - 30, auth_time: at / 1000 - 60 };
}, now);
const access = new GcpWebAccess({ async verify(token) { return token === 'synthetic-mobile-token' ? { actorId: bundle.scope.actorId, expiresAt: at + 3600000 } : firebase.verify(token); } }, store, now);
const observations = new GcpObservations(store, access, registrations, now);
const workflow = new CloudWorkflow(store, createCloudRunAdapters(registrations, 'synthetic', async () => { throw Error('Preparation must not execute'); }), now);
const analyses = new GcpAnalyses(store, access, observations, workflow, { engine: 'synthetic-fixture', modelId: 'synthetic-android', configurationId: 'android-v1', async analyze() {
  return { summary: bundle.initial.plan.payload.analysis.summary, findings: bundle.initial.plan.payload.analysis.findings, missingInformation: bundle.initial.plan.payload.analysis.missingInformation, serviceAssessment: 'unknown' };
} }, now);
let notification: GcpNotification | undefined;
const notifications = new GcpNotifications(store, access, { dataMode: 'synthetic', async current() { return true; }, async send(_token, data) { notification = data; return 'accepted'; } }, now);
const services: GcpApiServices = { access, observations, analyses, notifications, operations: new GcpOperations(store, access, analyses, registrations, now), publicOrigin: 'http://127.0.0.1' };
services.mobility = new GcpMobility(store,access,()=>true,{engine:'offline-fixture',async diagnose(vehicle,_language,_signal,cases=[]){
  return {summary:'Synthetic native HTTP diagnosis.',evidenceIds:['fault','signal'],unknowns:['No physical vehicle connected.'],runbook:vehicle.fault==='charge_handshake'||cases.length===1?'charge-reconnect-v1':'none'};
}},undefined,now);
const server = createGcpApiServer(services);
try {
  await access.organization.provision({ organizationId: bundle.scope.owner.organizationId, workspaceId: bundle.scope.workspaceId, actorId: bundle.scope.actorId, version: 1, active: true, roles: ['operator', 'reviewer'], updatedAt: new Date(at).toISOString() });
  const session = await access.authenticate('Bearer synthetic-mobile-token', { edition: 'organization', organizationId: bundle.scope.owner.organizationId, workspaceId: bundle.scope.workspaceId, label: 'Synthetic' });
  const observed = await observations.collect(session, { resourceId: registration.id }, randomUUID());
  const plan = await analyses.prepare(session, { observationId: observed.snapshot.id, language: 'en' }, randomUUID());
  await services.operations!.review(session, plan.id, { expectedVersion: plan.plan.version, expectedDigest: plan.planDigest }, randomUUID());
  const mobileSession = await access.authenticate('Bearer synthetic-mobile-token', session.scope, 'mobile');
  const device = await notifications.register(mobileSession, { installationId: randomUUID(), expectedGeneration: null, token: 'synthetic-kotlin-notification-address-12345' }, randomUUID());
  const notificationScope = { owner: mobileSession.context.owner, workspaceId: mobileSession.context.workspaceId };
  const pending = await notifications.pending(notificationScope);
  await notifications.deliver(notificationScope, pending.events[0], device.installationId);
  if (!notification) throw Error('Synthetic notification missing');
  const native = await access.authenticate('Bearer synthetic-firebase-token', { edition: 'personal', workspaceId: personalBinding.workspaceId, label: 'Synthetic native Firebase contract' });
  const nativeObservation = await observations.collect(native, { resourceId: personal.id }, randomUUID());
  const nativePlan = await analyses.prepare(native, { observationId: nativeObservation.snapshot.id, language: 'en' }, randomUUID());
  await services.operations!.review(native, nativePlan.id, { expectedVersion: nativePlan.plan.version, expectedDigest: nativePlan.planDigest }, randomUUID());
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw Error();
  services.publicOrigin = `http://127.0.0.1:${address.port}`;
  const child = spawn(resolve('apps/android/gradlew'), ['-p', 'apps/android', '-PcoreOnly=true', ':core:test', '--rerun-tasks', ...(process.env.MOBILEOPS_ANDROID_GRADLE_OFFLINE === '1' ? ['--offline'] : [])], {
    stdio: 'inherit', env: { ...process.env, GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? resolve('.tools/gradle-home'),
      MOBILEOPS_MOBILE_TEST_ORIGIN: services.publicOrigin, MOBILEOPS_MOBILE_NOTIFICATION_JSON: JSON.stringify(notification) },
  });
  child.on('error', () => { process.exitCode = 1; });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw Error('Android core gate failed.');
  if (collections !== 4) throw Error(`Expected two preparations + two explicit reads, observed ${collections}.`);
  console.log('Kotlin → native HTTP → GCP workflow/SQLite: organization and Firebase-derived personal owner, each with preparation + one explicit synthetic collection. No Google calls.');
} finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); store.close(); rmSync(directory, { recursive: true, force: true }); }
