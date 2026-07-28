"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { createSeller, updateSeller } from "@/actions/users";
import {
  createSellerSchema,
  updateSellerSchema,
  type CreateSellerInput,
  type UpdateSellerInput,
} from "@/lib/validations/user";
import type { SellerListItem } from "@/lib/queries/users";

export function CreateSellerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateSellerInput>({
    resolver: zodResolver(createSellerSchema),
    defaultValues: { name: "", email: "", password: "", phone: "" },
  });

  function onSubmit(values: CreateSellerInput) {
    startTransition(async () => {
      const result = await createSeller(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Seller created");
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New seller</DialogTitle>
          <DialogDescription>Create a new seller account for your store.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="new-seller-name">Full name</FieldLabel>
              <Input id="new-seller-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="new-seller-email">Email</FieldLabel>
              <Input id="new-seller-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.password}>
              <FieldLabel htmlFor="new-seller-password">Temporary password</FieldLabel>
              <Input id="new-seller-password" {...form.register("password")} />
              {form.formState.errors.password && (
                <FieldError>{form.formState.errors.password.message}</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="new-seller-phone">Phone</FieldLabel>
              <Input id="new-seller-phone" {...form.register("phone")} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Create seller
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditSellerDialog({
  open,
  onOpenChange,
  seller,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seller: SellerListItem;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateSellerInput>({
    resolver: zodResolver(updateSellerSchema),
    values: { name: seller.name, email: seller.email, phone: seller.phone ?? "" },
  });

  function onSubmit(values: UpdateSellerInput) {
    startTransition(async () => {
      const result = await updateSeller(seller.id, values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Seller updated");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit seller</DialogTitle>
          <DialogDescription>Update this seller&apos;s details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="edit-seller-name">Full name</FieldLabel>
              <Input id="edit-seller-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="edit-seller-email">Email</FieldLabel>
              <Input id="edit-seller-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-seller-phone">Phone</FieldLabel>
              <Input id="edit-seller-phone" {...form.register("phone")} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
