#!/usr/bin/env node
/**
 * Generate a fresh ECDSA P-256 keypair for the offline POS lease.
 *
 *   node scripts/generate-offline-lease-keys.mjs
 *
 * Prints the private key to STDOUT so an operator can paste it into a secret
 * store. That is the whole job: this script WRITES NOTHING TO DISK — no file in
 * the repo, no .env edit. Run it in a terminal you trust, paste the value, then
 * clear your scrollback. Anything that scrolls past here is key material.
 */

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const b64 = (buf) => Buffer.from(buf).toString("base64");
const privateKey = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
const publicKey = b64(await crypto.subtle.exportKey("spki", pair.publicKey));

console.log(`
Offline POS lease keypair (ECDSA P-256 / SHA-256)
=================================================

1. PRIVATE KEY — server runtime secret. Paste this into your deployment's
   secret store (Coolify env vars / your secret manager) as:

OFFLINE_LEASE_PRIVATE_KEY="${privateKey}"

   It must NEVER be committed, logged, or exposed to the browser. Only the
   server signs leases with it.

2. PUBLIC KEY — nothing to configure. The server derives it from the private
   key above and sends it to the till inside the POS offline snapshot payload,
   at request time. Do NOT set it as a NEXT_PUBLIC_* variable: a build-time
   public key would make rotation need a full rebuild and image prune.
   Shown here only so you can confirm a rotation took effect:

   (SPKI, derived) ${publicKey}

Rotation: replace OFFLINE_LEASE_PRIVATE_KEY and restart. Leases signed by the
old key stop verifying at sync time, so tills must come online once to get a
new lease. Rotate immediately if the private key is ever exposed.

Leaving OFFLINE_LEASE_PRIVATE_KEY unset is a supported state: offline mode is
simply OFF and the online POS is unaffected.
`);
