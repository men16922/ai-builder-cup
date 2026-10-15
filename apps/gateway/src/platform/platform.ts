import { z } from 'zod';
import type { GcpWebAccess, GcpWebSession } from '../auth/web-access';
import type { GcpMobility } from '../mobility/service';
import type { IdTokenSource } from '../crew/chief-a2a';

/** The fields of an A2A Agent Card the dashboard displays. The endpoint URL is deliberately dropped. */
const agentCardSchema = z.object({
  name: z.string().min(1).max(120), description: z.string().max(2000).default(''), version: z.string().max(40).optional(),
  protocolVersion: z.string().max(20).optional(), preferredTransport: z.string().max(40).optional(),
  capabilities: z.object({ streaming: z.boolean().optional(), pushNotifications: z.boolean().optional(), stateTransitionHistory: z.boolean().optional() }).loose().default({}),
  defaultInputModes: z.array(z.string().max(80)).max(10).default([]), defaultOutputModes: z.array(z.string().max(80)).max(10).default([]),
  skills: z.array(z.object({ id: z.string().max(120), name: z.string().max(160), description: z.string().max(1000).default(''), tags: z.array(z.string().max(60)).max(12).default([]) }).loose()).max(20).default([]),
}).loose().transform(card => ({ name: card.name, description: card.description, version: card.version, protocolVersion: card.protocolVersion, preferredTransport: card.preferredTransport,
  capabilities: { streaming: !!card.capabilities.streaming, pushNotifications: !!card.capabilities.pushNotifications, stateTransitionHistory: !!card.capabilities.stateTransitionHistory },
  defaultInputModes: card.defaultInputModes, defaultOutputModes: card.defaultOutputModes, skills: card.skills.map(skill => ({ id: skill.id, name: skill.name, description: skill.description, tags: skill.tags })) }));
export type AgentCardView = z.output<typeof agentCardSchema>;
export type AgentCardSource = (signal: AbortSignal) => Promise<unknown>;

/** Reads the Chief's public A2A card with the runtime identity token; bounded size, fixed path, no redirects. */
export function chiefAgentCard(chiefUrl: string, idToken: IdTokenSource, fetcher: typeof fetch = fetch): AgentCardSource {
  const origin = new URL(chiefUrl).origin;
  return async signal => {
    const token = await idToken(origin, signal);
    const response = await fetcher(`${origin}/.well-known/agent-card.json`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal, redirect: 'error', cache: 'no-store' });
    if (!response.ok) { void response.body?.cancel(); throw Error('agent_card_unavailable'); }
    const text = await response.text(); if (text.length > 65536) throw Error('agent_card_invalid');
    return JSON.parse(text) as unknown;
  };
}

export type PlatformFacts = { modelId: string; modelLocation: string; crew: string[]; mapsMcp: boolean; placesPhotos: boolean; agents: boolean };
/** Technical view for the operator dashboard: live A2A card, topology facts and the caller's own budget. */
export class GcpPlatform {
  private cache?: { at: number; card: AgentCardView | null };
  private readonly access: GcpWebAccess; private readonly facts: PlatformFacts; private readonly card?: AgentCardSource; private readonly mobility?: GcpMobility; private readonly now: () => number;
  constructor(access: GcpWebAccess, facts: PlatformFacts, card?: AgentCardSource, mobility?: GcpMobility, now = Date.now) {
    this.access = access; this.facts = facts; this.card = card; this.mobility = mobility; this.now = now;
  }
  async read(session: GcpWebSession) {
    await this.access.current(session);
    let card: AgentCardView | null = null, cardState: 'live' | 'unavailable' | 'not_configured' = this.card ? 'unavailable' : 'not_configured', fetchedAt: string | undefined;
    if (this.card) {
      if (this.cache && this.now() - this.cache.at < 300_000) card = this.cache.card;
      else {
        try { card = agentCardSchema.parse(await this.card(AbortSignal.timeout(5000))); } catch { card = null; }
        this.cache = { at: this.now(), card };
      }
      if (card) { cardState = 'live'; fetchedAt = new Date(this.cache!.at).toISOString(); }
    }
    return { agentCard: card, cardState, fetchedAt, facts: this.facts, usage: this.mobility ? await this.mobility.usage(session) : null };
  }
}
