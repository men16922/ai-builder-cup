import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, onIdTokenChanged, signOut } from 'firebase/auth';
import { firebaseBrowserConfigSchema } from '../web-config';
import type { WebIdentityClient } from '../web-identity';

export function createFirebaseWebIdentity(input: unknown): WebIdentityClient {
  const config = firebaseBrowserConfigSchema.parse(input);
  const app = initializeApp(config, `mobileops-web-${crypto.randomUUID()}`);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  auth.tenantId = config.tenantId ?? null;
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
  let closed = false;
  return {
    subscribe: listener => onIdTokenChanged(auth, user => {
      if (!closed) listener(user ? { key: `${config.projectId}:${config.tenantId ?? ''}:${user.uid}`, label: user.displayName?.slice(0, 128) || 'Signed-in user' } : null);
    }),
    async signIn() { if (closed) throw new Error('identity_closed'); await signInWithPopup(auth, provider); },
    async signOut() { await signOut(auth); },
    async tokenFor(key) {
      const user = auth.currentUser;
      if (closed || !user || `${config.projectId}:${config.tenantId ?? ''}:${user.uid}` !== key) throw new Error('identity_changed');
      const token = await user.getIdToken();
      if (closed || auth.currentUser !== user) throw new Error('identity_changed');
      return token;
    },
    async close() { if (closed) return; closed = true; await deleteApp(app); },
  };
}
