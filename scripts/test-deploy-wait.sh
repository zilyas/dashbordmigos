#!/usr/bin/env bash
#
# Self-check for the "Wait for the deployment to finish" step in
# .github/workflows/ci.yml.
#
# That step is a polling state machine over Coolify's deployment status, and
# the only place it ever runs for real is a production deploy — the worst
# possible place to discover it mishandles a 404 or treats a failed build as a
# success. So the step's script is pulled straight out of the workflow (not
# copied here, which would drift) and replayed against canned responses with
# curl and sleep stubbed out.
#
#   bash scripts/test-deploy-wait.sh
#
# Needs node (for the YAML parse) and js-yaml, both already present after
# npm install.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

node -e '
const y=require("js-yaml"), fs=require("fs");
const d=y.load(fs.readFileSync(".github/workflows/ci.yml","utf8"));
const s=d.jobs.deploy.steps.find(s=>/Wait for the deployment/.test(s.name));
if(!s) { console.error("wait step not found in ci.yml"); process.exit(1); }
fs.writeFileSync(process.argv[1]+"/wait.sh", s.run);
' "$tmp"

# jq stand-in: ubuntu-latest has the real thing, this machine may not, and
# only `-r '.field // empty'` is ever used.
mkdir -p "$tmp/bin"
cat > "$tmp/bin/jq" <<'JQ'
#!/usr/bin/env bash
[ "$1" = "-r" ] && shift
key=$(printf '%s' "$1" | sed -E 's/^\.([A-Za-z_]+).*/\1/')
sed -nE "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" | head -n1
JQ
chmod +x "$tmp/bin/jq"
PATH="$tmp/bin:$PATH"

pass=0; fail=0
run_case() {
  local name="$1" want_rc="$2" want_txt="$3"; shift 3
  SEQ=("$@"); printf 0 > "$tmp/idx"
  # Stubbed. Each SEQ entry is "httpcode:status"; the last one repeats so a
  # case can end in a steady state without listing 90 entries.
  curl() {
    local n; n=$(cat "$tmp/idx")
    local pair="${SEQ[$n]:-}"
    [ -z "$pair" ] && pair="${SEQ[${#SEQ[@]}-1]}"
    printf %s $((n+1)) > "$tmp/idx"
    local code="${pair%%:*}" st="${pair#*:}"
    if [ "$code" = "200" ]; then printf '{"status":"%s","logs":"log one"}\n200' "$st"
    else printf '{"message":"nope"}\n%s' "$code"; fi
  }
  sleep() { :; }
  COOLIFY_WEBHOOK="https://coolify.example/api/v1/deploy?uuid=abc&force=false"
  COOLIFY_TOKEN="tok"
  DEPLOYMENT_UUID="dep-1"
  local out rc
  out=$(source "$tmp/wait.sh" 2>&1); rc=$?
  if [ "$rc" = "$want_rc" ] && echo "$out" | grep -q "$want_txt"; then
    printf 'ok    %-26s rc=%s\n' "$name" "$rc"; pass=$((pass+1))
  else
    printf 'FAIL  %-26s rc=%s (wanted %s matching "%s")\n%s\n' \
      "$name" "$rc" "$want_rc" "$want_txt" "$out"; fail=$((fail+1))
  fi
}

run_case "immediate finish"      0 "finished successfully"          "200:finished"
run_case "pending then finish"   0 "finished successfully"          "200:queued" "200:in_progress" "200:finished"
# The one that matters most: a broken build must not go green.
run_case "failed build"          1 "ended with status: failed"      "200:in_progress" "200:failed"
run_case "cancelled by user"     1 "cancelled-by-user"              "200:cancelled-by-user"
# A token that can deploy but not read is normal (Coolify makes the two
# abilities exclusive) and must not be reported as a failed deploy.
run_case "403 read-denied token" 0 "cannot read deployment status"  "403:x"
# coollabsio/coolify#8925: a just-queued deployment can 404 briefly.
run_case "404 then finish"       0 "finished successfully"          "404:x" "404:x" "200:finished"
run_case "404 permanent"         0 "not found after 5 attempts"     "404:x"
run_case "transient 500"         0 "finished successfully"          "500:x" "200:finished"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
