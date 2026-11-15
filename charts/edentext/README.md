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
| `frameAncestors` | Origins allowed to frame the editor (CSP `frame-ancestors`); empty allows any | `""` |
| `ai.enabled` | `false` switches the AI assistant off for every user | `true` |
| `ai.provider` | `openai` (any OpenAI-compatible API) or `anthropic` | `openai` |
| `ai.endpoint` | API base URL preset for users; `/ai/v1` when empty and the proxy is on | `""` |
| `ai.model` | Model preset for users | `""` |
| `ai.contextTokens` | The model's context window; `0` leaves it to users | `0` |
| `ai.locked` | Users cannot pick another provider | `false` |
| `ai.proxy.enabled` | nginx forwards `/ai/` to `ai.proxy.upstream` | `false` |
| `ai.proxy.upstream` | Root URL of the operator's AI server | `""` |
| `ai.proxy.apiKeySecret.name` / `.key` | Secret and key holding the API key nginx adds | `""` / `api-key` |
| `dictation.enabled` | `false` switches dictation off for every user | `true` |
| `dictation.server` | Speech server preset; `/stt/v1` when empty and the proxy is on | `""` |
| `dictation.model` | Speech model preset | `""` |
| `dictation.locked` | Users cannot pick another speech server | `false` |
| `dictation.proxy.*` | As `ai.proxy`, for `/stt/` | off |
| `nodeSelector` | Pod node selector | `{}` |
| `tolerations` | Pod tolerations | `[]` |
| `affinity` | Pod affinity rules | `{}` |

See [`values.yaml`](values.yaml) for every setting and its structure.

## AI assistant and dictation

The chart can preset an AI provider and a speech recognition server for every user. It
runs neither: point it at a server you operate or a provider you use. The presets are
served as `/edentext.config.json`, which anyone can read, so a key never goes there.
Instead, nginx forwards `/ai/` and `/stt/` on the same host to the `upstream` and adds the
key from a Secret; the browser never sees it. Without `locked`, users may still enter
their own provider or server.

> **Access.** A proxy serves everyone who can reach the site, with your key. Put
> authentication in front of the ingress (basic auth, an OAuth2/OIDC proxy) or keep the
> site on an internal network. The chart builds no sign-in of its own.

An external provider with its key in a Secret:

```bash
kubectl -n edentext create secret generic ai-key --from-literal=api-key=...
helm upgrade --install edentext ./charts/edentext -n edentext \
  --set ai.proxy.enabled=true \
  --set-string ai.proxy.upstream=https://api.mistral.ai \
  --set-string ai.proxy.apiKeySecret.name=ai-key \
  --set-string ai.model=mistral-small-latest
```

Servers you already run in the cluster, for example Ollama and speaches, both
OpenAI-compatible, without keys:

```yaml
ai:
  model: qwen3:14b
  contextTokens: 32768   # also set the server's own context length (Ollama: OLLAMA_CONTEXT_LENGTH)
  locked: true
  proxy: { enabled: true, upstream: "http://ollama.ai.svc:11434" }
dictation:
  model: Systran/faster-whisper-small
  proxy: { enabled: true, upstream: "http://speaches.ai.svc:8000" }
```

Dictation only, on a server reachable from the users' browsers over HTTPS with CORS:

```yaml
ai: { enabled: false }
dictation: { server: "https://stt.example.com/v1", model: Systran/faster-whisper-base }
```

For dictation, a Whisper base model is enough for de, en, es, pt, ru and zh; take a
larger one for fr, it, ja, uk and el. The AI proxy streams without buffering, waits up
to 10 minutes and accepts 64 MB requests; the speech proxy waits 60 s and accepts 16 MB.
A changed Secret takes effect when the pods restart.

## Validate changes

```bash
bash scripts/test-helm-chart.sh
```

The test lints the chart, renders default, ingress, digest-pinned, preset and proxy
variants, and verifies that invalid values are rejected by the chart schema.
