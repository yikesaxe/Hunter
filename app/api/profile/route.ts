import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateDevice, getDeviceIdCookieOptions } from "@/lib/device";

export async function GET() {
  try {
    const { deviceId, isNew } = await getOrCreateDevice();
    const profile = await prisma.deviceProfile.findUnique({
      where: { deviceId },
    });
    const res = NextResponse.json(
      profile
        ? {
            id: profile.id,
            deviceId: profile.deviceId,
            weights: profile.weights,
            stats: profile.stats,
            updatedAt: profile.updatedAt.toISOString(),
          }
        : null
    );
    if (isNew) res.cookies.set("hid", deviceId, getDeviceIdCookieOptions());
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}
