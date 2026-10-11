import { useEffect, useState, type ReactNode } from 'react';
import { useWebIdentityFactory } from '../identity/OrganizationAccess';
import { gcpWebConfigurationSchema } from '@contracts/gcp/observations';
import { GcpObservationClient } from './observation-client';
import type { WebIdentityClient } from '../identity/web-identity';
import type { Edition } from '@contracts/core/edition';
export type GcpAccessState = { status: 'loading' | 'unconfigured' | 'failed' } | { status: 'ready'; client: GcpObservationClient; label: string };
export default function GcpAccess({ edition, children }: { edition: Edition; children: (access: GcpAccessState) => ReactNode }) {
  const factory = useWebIdentityFactory(), [access, setAccess] = useState<GcpAccessState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController(); let auth: WebIdentityClient | undefined, client: GcpObservationClient | undefined;
    const timer = setTimeout(() => { if (!controller.signal.aborted) { setAccess({ status: 'failed' }); controller.abort(); } }, 15000);
    setAccess({ status: 'loading' });
    void (async () => {
      try {
        const response = await fetch(`/api/gcp/config/${edition}`, { signal: controller.signal, cache: 'no-store', redirect: 'error', credentials: 'omit' });
        if (response.status === 404) { if (!controller.signal.aborted) setAccess({ status: 'unconfigured' }); return; }
        if (!response.ok) throw Error(); const text = await response.text(); if (text.length > 16384) throw Error();
        const config = gcpWebConfigurationSchema.parse(JSON.parse(text)); if (controller.signal.aborted) return;
        if (!config.configured || !factory) { setAccess({ status: 'unconfigured' }); return; }
        if (config.scope.edition !== edition) throw Error();
        auth = await factory(config.identity); if (controller.signal.aborted) { await auth.close(); return; }
        client = new GcpObservationClient(auth, config.scope); setAccess({ status: 'ready', client, label: config.scope.label });
      } catch { if (!controller.signal.aborted) setAccess({ status: 'failed' }); }
      finally { clearTimeout(timer); }
    })();
    return () => { controller.abort(); clearTimeout(timer); client?.close(); void auth?.close().catch(() => undefined); };
  }, [edition, factory]);
  return children(access);
}
