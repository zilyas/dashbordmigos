import { z } from "zod";

export const colorSchema = z.object({
  name: z.string().min(1, "Name is required").max(30),
  hex: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, "Use a hex color like #1A2B3C")
    .optional()
    .or(z.literal("")),
  position: z.number().int().min(0).max(9999).optional(),
});

export type ColorInput = z.infer<typeof colorSchema>;
