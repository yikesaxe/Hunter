import { z } from "zod";

export const moveInEnum = z.enum(["asap", "30", "60", "90", "flexible"]);

export const prefsSchema = z.object({
  name: z.string().min(1).max(200),
  minPrice: z.number().int().min(0).max(20000),
  maxPrice: z.number().int().min(0).max(20000),
  beds: z.array(z.number().int().min(0).max(10)),
  neighborhoods: z.array(z.string().min(1).max(100)),
  amenities: z.array(z.string().min(1).max(100)),
  moveIn: moveInEnum.or(z.literal("")).default(""),
  notes: z.string().max(2000).optional().default(""),
});

export type PrefsInput = z.infer<typeof prefsSchema>;
