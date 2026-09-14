import { z } from "zod";

export const sizeSchema = z.object({
  name: z.string().min(1, "Name is required").max(30),
  position: z.number().int().min(0).max(9999).optional(),
});

export type SizeInput = z.infer<typeof sizeSchema>;
