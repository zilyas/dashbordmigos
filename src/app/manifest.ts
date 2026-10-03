import type { MetadataRoute } from "next";

/**
 * Web app manifest — what makes the dashboard installable to a phone home
 * screen. Served at /manifest.webmanifest by Next's metadata file convention.
 *
 * `start_url` is "/dashboard", not "/": an installed app that opens on the
 * marketing-less root only bounces through a redirect. Proxy sends a signed-out
 * user to /login from there anyway, so both states land correctly.
 *
 * Colours are the hex equivalents of the oklch values in globals.css
 * (--primary and --background); a manifest cannot read CSS variables, so these
 * two are duplicated by necessity — update both together if the theme changes.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Store OS",
    short_name: "Store OS",
    description: "Manage products, inventory, sales, and reports.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#4f39f6",
    categories: ["business", "productivity", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android masks icons to its own shape; "maskable" art keeps the glyph
      // inside the 80% safe zone so nothing is clipped on a circular mask.
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the installed icon to jump straight to the two things a phone
    // is actually used for on a shop floor.
    shortcuts: [
      { name: "New sale", short_name: "Sell", url: "/sales/new" },
      { name: "Products", short_name: "Products", url: "/products" },
    ],
  };
}
