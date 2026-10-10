import { OrganizationWebAccess, type OrganizationWebSession, type VerifiedWebIdentity, type WebIdentityVerifier } from '../../cloud-auth';
import type { CloudStore, CloudTransaction } from '../../cloud-store';
import { CloudOperationError } from '../../../src/domain/cloud-workflow';
import type { VerifiedCloudContext } from '../../../src/domain/cloud-operations';
import { gcpScopeSchema, type GcpScope } from '../../../src/modules/gcp/domain/observations';
export type GcpWebSession = { context: VerifiedCloudContext; identity: VerifiedWebIdentity; organization?: OrganizationWebSession;
  /** Request-local bearer only; never serialize a session into evidence, replay or audit storage. */
  authorization: string; scope: GcpScope };
const denied = () => new CloudOperationError(401, 'web_sign_in_required', 'Sign in to the web application again.');

export class GcpWebAccess {
  readonly organization: OrganizationWebAccess;
  private readonly identities: WebIdentityVerifier;
  private readonly store: CloudStore;
  private readonly now: () => number;
  constructor(identities: WebIdentityVerifier, store: CloudStore, now = Date.now) {
    this.identities = identities; this.store = store; this.now = now; this.organization = new OrganizationWebAccess(identities, store, now);
  }
  /** Channel is selected by the trusted HTTP route, never a request body or token claim. */
  async authenticate(authorization: string | undefined, input: GcpScope, channel: 'web' | 'mobile' = 'web'): Promise<GcpWebSession> {
    const scope = gcpScopeSchema.parse(input);
    if (channel !== 'web' && channel !== 'mobile') throw denied();
    if (!authorization || authorization.length > 16384 || !/^Bearer [A-Za-z0-9_.~-]+$/.test(authorization)) throw denied();
    if (scope.edition === 'organization') {
      const organization = await this.organization.authenticate(authorization, scope.organizationId, scope.workspaceId);
      return { context: { ...organization.context, channel }, identity: organization.identity, organization, authorization, scope };
    }
    let identity: VerifiedWebIdentity;
    try { identity = await this.identities.verify(authorization.slice(7)); } catch { throw denied(); }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(identity.actorId) || !Number.isFinite(identity.expiresAt) || identity.expiresAt <= this.now()) throw denied();
    return { identity, authorization, scope, context: { actorId: identity.actorId, owner: { kind: 'personal', userId: identity.actorId }, workspaceId: scope.workspaceId, channel, roles: ['operator', 'reviewer'] } };
  }
  async assertCurrentIn(tx: CloudTransaction, session: GcpWebSession) {
    if (session.identity.expiresAt <= this.now()) throw denied();
    if (!['web', 'mobile'].includes(session.context.channel) || session.scope.workspaceId !== session.context.workspaceId || session.context.actorId !== session.identity.actorId) throw denied();
    if (session.organization) {
      if (JSON.stringify({ ...session.context, channel: 'web' }) !== JSON.stringify(session.organization.context)
        || session.scope.edition !== 'organization' || session.context.owner.kind !== 'organization' || session.scope.organizationId !== session.context.owner.organizationId) throw denied();
      await this.organization.assertCurrentIn(tx, session.organization); return;
    }
    if (session.scope.edition !== 'personal' || JSON.stringify(session.context.roles) !== JSON.stringify(['operator', 'reviewer'])) throw denied();
    if (session.context.owner.kind !== 'personal' || session.context.owner.userId !== session.identity.actorId || session.context.actorId !== session.identity.actorId) throw denied();
  }
  async current(session: GcpWebSession) {
    const fresh = await this.authenticate(session.authorization, session.scope, session.context.channel);
    if (fresh.identity.actorId !== session.identity.actorId || fresh.organization?.membershipVersion !== session.organization?.membershipVersion) throw denied();
    await this.store.transact(tx => this.assertCurrentIn(tx, session));
    return fresh.context;
  }
}
