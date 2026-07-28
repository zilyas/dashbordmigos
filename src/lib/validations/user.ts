import { z } from "zod";

export const createSellerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Must be at least 8 characters"),
  phone: z.string().max(30).optional().or(z.literal("")),
});

export const updateSellerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  email: z.email("Enter a valid email address"),
  phone: z.string().max(30).optional().or(z.literal("")),
});

export type CreateSellerInput = z.infer<typeof createSellerSchema>;
export type UpdateSellerInput = z.infer<typeof updateSellerSchema>;
