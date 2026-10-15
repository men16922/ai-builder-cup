import { useEffect, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';
import '../../apps/web/src/theme.generated.css';
import '../../apps/web/src/styles.css';
import { LanguageProvider, LanguageSelector } from '../../apps/web/src/i18n';
import { MobilityClient } from '../../apps/web/src/mobility/mobility-client';
import CallCenter from '../../apps/web/src/mobility/CallCenter';

// Synthetic fixture only. The API still authenticates and checks its private membership.
const client = new MobilityClient(async (path, input) => {
  const response = await fetch('/api/organizations/v1/synthetic-org/workspaces/synthetic-workspace/gcp' + path, {
    method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer synthetic-driver', ...(input ? { 'Content-Type': 'application/json', 'Idempotency-Key': input.key } : {}) },
    ...(input ? { body: JSON.stringify(input.body) } : {}),
  });
  const body = await response.json(); if (!response.ok) throw Object.assign(Error(body.code ?? 'mobility_request_failed'), { status: response.status }); return body;
});
function Fixture() {
  const board = useSyncExternalStore(client.subscribe, client.getSnapshot);
  useEffect(() => { client.open(); void client.load(); return () => client.close(); }, []);
  return <main><h1>Offline call uncertainty verification</h1><LanguageSelector/>
    <button disabled={board.busy || !board.state} onClick={async () => { await client.command({ operation: 'initialize' }); await client.command({ operation: 'call_incoming', scenario: 'meeting_reschedule', language: 'en' }); }}>Create synthetic call</button>
    <button disabled={board.busy} onClick={() => void client.load()}>Read server record</button>
    <CallCenter client={client}/>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture/></LanguageProvider>);
