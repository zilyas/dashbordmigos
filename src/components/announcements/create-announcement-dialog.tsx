"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { createAnnouncement } from "@/actions/announcements";
import type { Role } from "@/generated/prisma/enums";

export function CreateAnnouncementDialog({ role }: { role: Role }) {
  const t = useTranslations("announcements.createDialog");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      const result = await createAnnouncement({ title, body });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastPosted"));
      setTitle("");
      setBody("");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Megaphone className="size-4" />
          {t("newAnnouncement")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newAnnouncement")}</DialogTitle>
          <DialogDescription>{role === "SUPER_ADMIN" ? t("descriptionPlatform") : t("descriptionStore")}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="announcement-title">{t("titleLabel")}</FieldLabel>
            <Input
              id="announcement-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
              maxLength={200}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="announcement-body">{t("messageLabel")}</FieldLabel>
            <Textarea
              id="announcement-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("messagePlaceholder")}
              rows={5}
              maxLength={4000}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending || !title.trim() || !body.trim()}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {t("postButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
