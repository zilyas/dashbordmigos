import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(60),
  description: z.string().max(300).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  /** Optional parent category id for a shallow tree. */
  parentId: z.string().optional().or(z.literal("")),
  /** Opts the category into clothing variant support (stored in metadata). */
  isClothing: z.boolean().optional(),
});

export type CategoryInput = z.infer<typeof categorySchema>;
