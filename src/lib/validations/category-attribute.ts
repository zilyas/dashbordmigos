import { z } from "zod";
import { ATTRIBUTE_TYPES } from "@/lib/attributes";

/** Defining a per-category attribute. `key` is derived from `label` server-side. */
export const attributeDefinitionSchema = z
  .object({
    label: z.string().min(1, "Label is required").max(60),
    type: z.enum(ATTRIBUTE_TYPES),
    options: z.array(z.string().min(1).max(60)).max(50).optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).max(9999).optional(),
  })
  .refine((d) => d.type !== "SELECT" || (d.options?.length ?? 0) > 0, {
    message: "Add at least one option for a Select attribute.",
    path: ["options"],
  });

export type AttributeDefinitionInput = z.infer<typeof attributeDefinitionSchema>;

/** One product attribute value (validated against its definition in the action). */
export const productAttributeValueSchema = z.object({
  definitionId: z.string().min(1),
  value: z.string().max(500),
});

export const productAttributeValuesSchema = z.array(productAttributeValueSchema).max(50);

export type ProductAttributeValueInput = z.infer<typeof productAttributeValueSchema>;
