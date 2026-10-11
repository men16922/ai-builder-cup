import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../../apps/web/src/theme.generated.css';
import '../../apps/web/src/styles.css';
import { LanguageProvider } from '../../apps/web/src/i18n';
import { WebIdentityFactoryProvider, type WebIdentityFactory } from '../../apps/web/src/identity/OrganizationAccess';
import type { WebIdentity, WebIdentityClient } from '../../apps/web/src/identity/web-identity';
import ConsolePage from '../../apps/web/src/console/ConsolePage';
let identity: WebIdentity | null = null;
const clients = new Set<(identity: WebIdentity | null) => void>();
const emit = (key: string | null) => { identity = key ? { key, label: key } : null; clients.forEach(fn => fn(identity)); };
const factory: WebIdentityFactory = async () => {
  const owned = new Set<(identity: WebIdentity | null) => void>();
  const client: WebIdentityClient = { subscribe(fn) { owned.add(fn); clients.add(fn); fn(identity); return () => { owned.delete(fn); clients.delete(fn); }; },
    async signIn() { emit('user-a'); }, async signOut() { emit(null); }, async tokenFor(key) { if (identity?.key !== key) throw Error(); return key; },
    async close() { owned.forEach(fn => clients.delete(fn)); owned.clear(); } };
  return client;
};
function Fixture() {
  const [edition, setEdition] = useState<'personal' | 'organization'>('organization');
  return <><button data-testid="switch-user" onClick={() => emit('user-b')}>Synthetic user B</button><button data-testid="personal" onClick={() => { emit(null); setEdition('personal'); }}>Synthetic personal edition</button>
    <WebIdentityFactoryProvider factory={factory}><ConsolePage key={edition} edition={edition} /></WebIdentityFactoryProvider></>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><Fixture /></LanguageProvider></React.StrictMode>);
