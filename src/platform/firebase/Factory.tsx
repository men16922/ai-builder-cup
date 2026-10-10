import type { ReactNode } from 'react';
import { WebIdentityFactoryProvider, type WebIdentityFactory } from '../OrganizationAccess';
const factory: WebIdentityFactory = async configuration => {
  if (configuration.method !== 'firebase-google') throw new Error('unsupported_web_identity');
  const { createFirebaseWebIdentity } = await import('./web-identity');
  return createFirebaseWebIdentity(configuration.firebase);
};
export default function FirebaseIdentityFactory({ children }: { children: ReactNode }) {
  return <WebIdentityFactoryProvider factory={factory}>{children}</WebIdentityFactoryProvider>;
}
