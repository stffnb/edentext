#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
chart="$repo_root/charts/edentext"
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local file=$1 pattern=$2 description=$3
  grep -Eq -- "$pattern" "$file" || fail "$description"
}

assert_not_contains() {
  local file=$1 pattern=$2 description=$3
  if grep -Eq -- "$pattern" "$file"; then
    fail "$description"
  fi
}

app_version=$(sed -n 's/^appVersion: "\(.*\)"$/\1/p' "$chart/Chart.yaml")
package_version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$repo_root/package.json")
[ "$app_version" = "v$package_version" ] \
  || fail "Chart.yaml appVersion $app_version does not match package.json version $package_version"

printf '%s\n' 'Linting chart'
helm lint "$chart" --strict

printf '%s\n' 'Rendering default resources'
helm template edentext "$chart" --namespace edentext > "$workdir/default.yaml"
assert_contains "$workdir/default.yaml" '^kind: Deployment$' 'default render has no Deployment'
assert_contains "$workdir/default.yaml" '^kind: Service$' 'default render has no Service'
assert_contains "$workdir/default.yaml" '^kind: ServiceAccount$' 'default render has no ServiceAccount'
assert_contains "$workdir/default.yaml" '^kind: ConfigMap$' 'default render has no nginx ConfigMap'
assert_contains "$workdir/default.yaml" "image: \"ghcr.io/stffnb/edentext:$app_version\"" 'default image does not follow appVersion'
assert_contains "$workdir/default.yaml" 'automountServiceAccountToken: false' 'service account token is mounted by default'
assert_contains "$workdir/default.yaml" 'runAsNonRoot: true' 'pod can run as root by default'
assert_contains "$workdir/default.yaml" 'runAsUser: 101' 'pod does not use the nginx user by default'
assert_contains "$workdir/default.yaml" 'readOnlyRootFilesystem: true' 'container root filesystem is writable by default'
assert_contains "$workdir/default.yaml" 'drop:' 'container does not declare dropped capabilities'
assert_contains "$workdir/default.yaml" '^[[:space:]]+- ALL$' 'container does not drop all capabilities by default'
assert_contains "$workdir/default.yaml" 'containerPort: 8080' 'container does not expose the unprivileged nginx port'
assert_contains "$workdir/default.yaml" 'readinessProbe:' 'default render has no readiness probe'
assert_contains "$workdir/default.yaml" 'livenessProbe:' 'default render has no liveness probe'
assert_not_contains "$workdir/default.yaml" '^kind: Ingress$' 'Ingress is enabled by default'

printf '%s\n' 'Rendering YAML-coercible label values as strings'
helm template true "$chart" --namespace edentext > "$workdir/coercible-label.yaml"
assert_contains "$workdir/coercible-label.yaml" 'app.kubernetes.io/instance: "true"' 'release name label was not quoted'

printf '%s\n' 'Rendering ingress and TLS settings'
helm template word "$chart" --namespace documents \
  --values "$repo_root/charts/edentext/ci/ingress-values.yaml" \
  > "$workdir/ingress.yaml"
assert_contains "$workdir/ingress.yaml" '^kind: Ingress$' 'enabled Ingress was not rendered'
assert_contains "$workdir/ingress.yaml" 'ingressClassName: "traefik"' 'Ingress class was not rendered as a string'
assert_contains "$workdir/ingress.yaml" 'cert-manager.io/cluster-issuer: "?letsencrypt-prod"?$' 'Ingress annotation was not rendered'
assert_contains "$workdir/ingress.yaml" 'host: "word.example.com"' 'Ingress host was not rendered'
assert_contains "$workdir/ingress.yaml" 'secretName: word-example-com-tls' 'Ingress TLS secret was not rendered'

printf '%s\n' 'Rendering an immutable image reference'
digest="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
helm template edentext "$chart" --namespace edentext \
  --set-string image.digest="$digest" > "$workdir/digest.yaml"
assert_contains "$workdir/digest.yaml" "image: \"ghcr.io/stffnb/edentext:$app_version@$digest\"" 'image digest was not appended to the tagged reference'

printf '%s\n' 'Rejecting invalid values'
if helm template edentext "$chart" --set replicaCount=0 > /dev/null 2>&1; then
  fail 'replicaCount accepted zero'
fi
if helm template edentext "$chart" --set-string image.digest=not-a-digest > /dev/null 2>&1; then
  fail 'image.digest accepted a malformed digest'
fi
if helm template edentext "$chart" --set podAnnotations.example=true > /dev/null 2>&1; then
  fail 'podAnnotations accepted a non-string value'
fi
if helm template edentext "$chart" --set containerPort=9000 > /dev/null 2>&1; then
  fail 'unsupported containerPort override was accepted'
fi
if helm template edentext "$chart" --set-string 'ingress.hosts[0].paths[0].path=relative' > /dev/null 2>&1; then
  fail 'Ingress accepted a path without a leading slash'
fi
if helm template edentext "$chart" --values "$repo_root/charts/edentext/ci/invalid-selector-label-values.yaml" > /dev/null 2>&1; then
  fail 'podLabels accepted a reserved selector label'
fi

printf '%s\n' 'Helm chart tests passed'
