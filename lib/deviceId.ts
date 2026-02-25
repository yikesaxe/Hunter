import { cookies } from "next/headers";

const COOKIE_NAME = "hid";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type DeviceResult = { deviceId: string; isNew: boolean };

/**
 * Read or create anonymous device id from httpOnly cookie "hid".
 * Returns deviceId and whether it was newly created (caller should set cookie on response if isNew).
 */
export async function getOrCreateDeviceId(): Promise<DeviceResult> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing && existing.length > 0) {
    return { deviceId: existing, isNew: false };
  }
  const deviceId = crypto.randomUUID();
  return { deviceId, isNew: true };
}

export function getDeviceIdCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  };
}
