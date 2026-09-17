"use client";

import { useState } from "react";
import { Printer, Download, Share2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { renderReceiptImage, receiptFileName } from "@/lib/receipt-image";
import type { SaleReceipt } from "@/lib/queries/sales";

export function ReceiptActions({ receipt }: { receipt: NonNullable<SaleReceipt> }) {
  const [busy, setBusy] = useState<"print" | "download" | "share" | null>(null);

  const withImage = async (kind: "print" | "download" | "share", run: (blob: Blob) => Promise<void> | void) => {
    setBusy(kind);
    try {
      await run(await renderReceiptImage(receipt));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare the receipt.");
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = () =>
    withImage("print", (blob) => {
      const url = URL.createObjectURL(blob);
      // A detached window carries none of the app's layout CSS, so the receipt
      // is centred and scaled to whatever paper is loaded — 58 mm, 80 mm, A4.
      const win = window.open("", "_blank", "width=420,height=640");
      if (!win) {
        URL.revokeObjectURL(url);
        toast.error("Allow pop-ups for this site to print the receipt.");
        return;
      }
      win.document.write(
        `<!doctype html><html><head><title>${receipt.invoiceNumber}</title><style>
          @page { margin: 8mm; }
          html, body { margin: 0; padding: 0; background: #fff; }
          body { display: flex; justify-content: center; }
          img { width: 100%; max-width: 80mm; height: auto; }
          @media print { img { max-width: 100%; } }
        </style></head><body><img src="${url}" alt="Receipt"></body></html>`
      );
      win.document.close();
      const img = win.document.querySelector("img");
      const go = () => {
        win.focus();
        win.print();
        win.onafterprint = () => win.close();
        URL.revokeObjectURL(url);
      };
      if (img?.complete) go();
      else img?.addEventListener("load", go, { once: true });
    });

  const handleDownload = () =>
    withImage("download", (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = receiptFileName(receipt);
      link.click();
      URL.revokeObjectURL(url);
    });

  const handleShare = () =>
    withImage("share", async (blob) => {
      const file = new File([blob], receiptFileName(receipt), { type: "image/png" });
      // Web Share hands the PNG straight to WhatsApp on mobile and on desktop
      // browsers that support it. Everywhere else, fall back to saving the file
      // and opening WhatsApp Web so the seller can attach it.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Receipt ${receipt.invoiceNumber}` });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = receiptFileName(receipt);
      link.click();
      URL.revokeObjectURL(url);
      window.open("https://wa.me/", "_blank", "noopener");
      toast.success("Receipt saved. Attach it in WhatsApp.");
    });

  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      <Button className="gap-1.5" onClick={handlePrint} disabled={busy !== null}>
        <Printer className="size-4" />
        Print
      </Button>
      <Button variant="outline" className="gap-1.5" onClick={handleDownload} disabled={busy !== null}>
        <Download className="size-4" />
        Download
      </Button>
      <Button variant="outline" className="gap-1.5" onClick={handleShare} disabled={busy !== null}>
        <Share2 className="size-4" />
        WhatsApp
      </Button>
    </div>
  );
}
