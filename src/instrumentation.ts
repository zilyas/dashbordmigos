/**
 * Next.js startup hook. `register()` is called ONCE when a new server instance
 * is initiated and must complete before the server handles any request — which
 * is exactly the gate a missing required secret should fail at.
 *
 * Convention and semantics per
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
 * (file lives at the project root, or in `src/` when using a src folder;
 * `register` runs in every runtime, so branch on `process.env.NEXT_RUNTIME`).
 *
 * Build safety: Next skips `register()` during `next build`
 * (see registerInstrumentation() in
 * node_modules/next/dist/server/lib/router-utils/instrumentation-globals.external.js,
 * which returns early when NEXT_PHASE === "phase-production-build"). The same
 * check is repeated below so the build stays green without runtime secrets even
 * if that internal behaviour changes — commit c61cb20 deliberately removed
 * DATABASE_URL and AUTH_SECRET from the build args, and that must not regress.
 */
export async function register() {
  // Node runtime only: the validator uses Buffer and this must never reach the
  // Edge runtime or the browser bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { assertEnvOrThrow } = await import("@/lib/env-validation");
  assertEnvOrThrow();
}
