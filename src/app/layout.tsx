import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Store Management Dashboard",
    template: "%s · Store Management",
  },
  description: "Manage products, inventory, sales, and reports.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets fixed/full-bleed surfaces (topbar, mobile drawers, dialogs) extend
  // under the iPhone notch/Dynamic Island and Android gesture bar instead of
  // leaving a hard edge — safe-area padding is applied where those surfaces
  // render (see globals.css and the app shell).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
