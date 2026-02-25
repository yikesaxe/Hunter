import { prisma } from "@/lib/db";
import { getOrCreateDeviceId, getDeviceIdCookieOptions } from "./deviceId";

export type DeviceContext = { deviceId: string; isNew: boolean };

/**
 * Ensure device exists in DB (create if new cookie) and return deviceId.
 * Caller should set cookie on response when isNew is true.
 */
export async function getOrCreateDevice(): Promise<DeviceContext> {
  const { deviceId, isNew } = await getOrCreateDeviceId();
  await prisma.device.upsert({
    where: { id: deviceId },
    create: { id: deviceId },
    update: { lastSeenAt: new Date() },
  });
  return { deviceId, isNew };
}

export { getDeviceIdCookieOptions };
