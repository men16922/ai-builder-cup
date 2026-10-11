import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import type { GoogleCredentials } from './credentials';
/** Explicit client prevents the SDK from searching ADC files or selecting a different service account. */
export function pinnedGoogleAuth(projectId: string, credentials: GoogleCredentials) {
  const client = new OAuth2Client({ forceRefreshOnFailure: false });
  client.refreshHandler = async () => {
    const token = await credentials.token(AbortSignal.timeout(5000));
    return { access_token: token.accessToken, expiry_date: token.expiresAt };
  };
  return new GoogleAuth({ projectId, authClient: client });
}
