import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(60),
  description: z.string().max(300).optional().or(z.literal("")),
});

export type CategoryInput = z.infer<typeof categorySchema>;
