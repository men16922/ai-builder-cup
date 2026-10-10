import { z } from 'zod';

// Transport data only. No owner, resource, result, note, URL or executable action.
export const gcpNotificationSchema = z.object({
  schemaVersion: z.literal('1'), provider: z.literal('gcp'),
  notificationId: z.string().regex(/^[a-f0-9]{64}$/), installationId: z.uuid(), generation: z.uuid(),
  planId: z.uuid(), planVersion: z.string().regex(/^[1-9][0-9]{0,8}$/), expiresAt: z.iso.datetime(),
}).strict();
export type GcpNotification = z.infer<typeof gcpNotificationSchema>;
export const gcpDeviceRequestSchema = z.object({
  installationId: z.uuid(), expectedGeneration: z.uuid().nullable(),
  // Legacy FCM token transport remains optional. An installation UUID is OUR identifier, not a Firebase FID.
  token: z.string().min(20).max(4096).regex(/^[A-Za-z0-9_:.-]+$/),
}).strict();
export const gcpDeviceRevokeSchema = z.object({ installationId: z.uuid(), expectedGeneration: z.uuid() }).strict();
export const gcpDeviceRetireSchema = z.object({ installationId: z.uuid(), registrationKey: z.uuid() }).strict();
export const gcpDeviceReceiptSchema = z.object({ installationId: z.uuid(), generation: z.uuid(), active: z.boolean(), expiresAt: z.iso.datetime() }).strict();
export type GcpDeviceReceipt = z.infer<typeof gcpDeviceReceiptSchema>;
