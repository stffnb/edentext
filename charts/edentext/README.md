# EdenText Helm chart

> **Community-maintained.** This chart was contributed by
> [Blair Hoddinott](https://github.com/blairhoddinott) and is maintained by the
> community. It is not covered by commercial support. Issues and pull requests
> are welcome.

This chart deploys [EdenText](https://github.com/stffnb/edentext), a fully client-side
word processor, to Kubernetes. The server only delivers static application files;
documents and recovery copies remain in the user's browser. The chart therefore
creates no database or persistent volume. Its nginx process listens on an
unprivileged port and the default pod security context is compatible with the
Kubernetes Restricted Pod Security Standard.

## Prerequisites

- Kubernetes 1.23 or newer
- Helm 3 or 4
- An ingress controller when ingress is enabled

## Install

From the repository root:

```bash
helm upgrade --install edentext ./charts/edentext \
  --namespace edentext \
  --create-namespace
```

The default release creates a ClusterIP Service without an Ingress. To expose it,
copy the example values and adapt the host, ingress class, annotations and TLS
Secret:

```bash
helm upgrade --install edentext ./charts/edentext \
  --namespace edentext \
  --create-namespace \
  --values ./charts/edentext/ci/ingress-values.yaml
```

The example cert-manager annotation asks the `letsencrypt-prod` ClusterIssuer to
create the named TLS Secret. Remove or replace that annotation when the cluster
uses a different certificate mechanism. HTTPS is recommended because browsers
restrict offline installation, direct file saves and clipboard features on plain
HTTP origins.

## Upgrade

Update the repository checkout, review the chart and application versions, then
run the same `helm upgrade --install` command. Set `image.digest` to a `sha256:`
manifest digest when the deployment must use an immutable image reference while
retaining its readable tag.

## Configuration

| Value | Description | Default |
| --- | --- | --- |
| `replicaCount` | Number of web-server replicas | `1` |
| `image.repository` | Container image repository | `ghcr.io/stffnb/edentext` |
| `image.tag` | Container tag; chart `appVersion` when empty | `""` |
| `image.digest` | Optional immutable `sha256:` manifest digest | `""` |
| `image.pullPolicy` | Container image pull policy | `IfNotPresent` |
| `serviceAccount.create` | Create a dedicated ServiceAccount | `true` |
| `serviceAccount.automount` | Mount its Kubernetes API token | `false` |
| `podSecurityContext` | Pod-level identity and seccomp settings | Restricted defaults |
| `securityContext` | Container capabilities and filesystem settings | Restricted defaults |
| `service.type` | Kubernetes Service type | `ClusterIP` |
| `service.port` | Service port | `80` |
| `resources` | Container requests and limits | See `values.yaml` |
| `livenessProbe` | HTTP liveness probe settings | Enabled on `/` |
| `readinessProbe` | HTTP readiness probe settings | Enabled on `/` |
| `ingress.enabled` | Create a standard Kubernetes Ingress | `false` |
| `ingress.className` | IngressClass name | `""` |
| `ingress.annotations` | Controller or certificate annotations | `{}` |
| `ingress.hosts` | Host and path rules | `edentext.example.com` |
| `ingress.tls` | TLS Secret and host declarations | `[]` |
| `nodeSelector` | Pod node selector | `{}` |
| `tolerations` | Pod tolerations | `[]` |
| `affinity` | Pod affinity rules | `{}` |

See [`values.yaml`](values.yaml) for every setting and its structure.

## Validate changes

```bash
bash scripts/test-helm-chart.sh
```

The test lints the chart, renders default, ingress and digest-pinned variants,
and verifies that invalid values are rejected by the chart schema.
