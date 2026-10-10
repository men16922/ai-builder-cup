import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createFirebaseGcpServices } from './gcp';
import { gcpServerConfiguration } from '../../modules/gcp/configuration';
/** Reading this non-secret startup file never mints tokens or connects to a cloud service. */
export async function readGcpConfiguration(path: string) {
  let file;
  try {
    if (!isAbsolute(path)) throw Error(); file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat(); if (!info.isFile() || info.size > 65536) throw Error();
    const text = await file.readFile('utf8'); if (Buffer.byteLength(text) > 65536) throw Error();
    return gcpServerConfiguration.parse(JSON.parse(text));
  } catch { throw Error('GCP configuration is invalid. Use the server configuration template without embedded credentials.'); }
  finally { await file?.close(); }
}
export async function loadFirebaseGcp() {
  if (process.env.MOBILEOPS_GCP_ENABLED !== '1' || process.env.MOBILEOPS_OFFLINE_TEST === '1') return undefined;
  const config = await readGcpConfiguration(process.env.MOBILEOPS_GCP_CONFIG ?? '');
  return createFirebaseGcpServices(config, true);
}
