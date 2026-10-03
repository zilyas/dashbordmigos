import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { InstallPrompt } from "@/components/pwa/install-prompt";
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
  // iOS ignores the web app manifest for both of these: standalone display and
  // the home-screen icon only come from these legacy meta/link tags.
  appleWebApp: {
    capable: true,
    title: "Store OS",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets fixed/full-bleed surfaces (topbar, mobile drawers, dialogs) extend
  // under the iPhone notch/Dynamic Island and Android gesture bar instead of
  // leaving a hard edge — safe-area padding is applied where those surfaces
  // render (see globals.css and the app shell).
  viewportFit: "cover",
  // Tints the Android task switcher and the iOS status bar area so an installed
  // app does not show a browser-grey chrome strip. Matches --primary / --background.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4f39f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
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
        <Providers>
          <OfflineBanner />
          {children}
          <InstallPrompt />
        </Providers>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
