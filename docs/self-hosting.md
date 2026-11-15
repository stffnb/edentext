# AI and dictation from the server

An installation can set up the AI assistant and dictation for all its users, so nobody
has to enter a provider or a speech server. EdenText stays static: it runs no model and
ships none. You point it at a server you operate or a provider you use.

## The preset file

`edentext.config.json` next to `index.html` is read once when the editor starts. Every
section and field is optional; without the file nothing is preset.

```json
{
  "ai": { "provider": "openai", "endpoint": "/ai/v1", "model": "qwen3:14b", "contextTokens": 32768, "locked": false },
  "dictation": { "server": "/stt/v1", "model": "Systran/faster-whisper-small", "locked": false, "webSpeech": true }
}
```

- **`enabled: false`** switches the feature off for the whole installation.
- **`provider`** is `openai` (any OpenAI-compatible API) or `anthropic`.
- **Order:** the options of a page that embeds EdenText come first, then this file, then
  what the user entered. A user who enters an address of their own uses it.
- **`locked: true`** fixes the preset: Settings shows it, but it cannot be changed. Users
  can still switch the feature off for themselves.
- **Dictation service:** users pick in Settings ▸ Editing between your speech server,
  their own (not while `locked`) and the browser's recognition, with yours as the default.
  `webSpeech: false` takes the browser's off the list, which can send the audio to the
  browser maker's service. Without the file, the browser's stays on offer as before.
- Unknown keys and values of the wrong type are ignored. The file is never stored in the
  browser; a change holds from the next start. The desktop app does not read it.

## Keys belong in the proxy

The file is public, so it never holds an API key. Instead, the web server forwards
`/ai/` and `/stt/` on the same host to your server and adds the key there; the browser
never sees it. Being on the same host also avoids CORS and mixed-content problems.

**Access:** such a proxy serves everyone who can reach the site, with your key. Put
authentication in front of it (basic auth, an OAuth2/OIDC proxy) or keep the site on an
internal network.

## Docker

The image writes the file and the proxies from environment variables when it starts:

| Variable | Meaning |
|---|---|
| `EDENTEXT_AI_ENABLED`, `EDENTEXT_DICTATION_ENABLED` | `false` switches the feature off |
| `EDENTEXT_AI_PROVIDER` | `openai` or `anthropic` |
| `EDENTEXT_AI_ENDPOINT`, `EDENTEXT_AI_MODEL`, `EDENTEXT_AI_CONTEXT_TOKENS` | the AI preset |
| `EDENTEXT_DICTATION_SERVER`, `EDENTEXT_DICTATION_MODEL` | the speech server preset |
| `EDENTEXT_AI_LOCKED`, `EDENTEXT_DICTATION_LOCKED` | `true` fixes the preset |
| `EDENTEXT_DICTATION_WEB_SPEECH` | `false` takes the browser's speech recognition off the list |
| `EDENTEXT_AI_PROXY_UPSTREAM`, `EDENTEXT_DICTATION_PROXY_UPSTREAM` | root URL that `/ai/` or `/stt/` forwards to; the preset address then defaults to `/ai/v1` or `/stt/v1` |
| `EDENTEXT_AI_PROXY_API_KEY`, `EDENTEXT_DICTATION_PROXY_API_KEY` | key the proxy adds (`Authorization: Bearer`, `x-api-key` for Anthropic) |

An external provider, its key from the host's environment:

```bash
docker run -p 8080:80 \
  -e EDENTEXT_AI_PROXY_UPSTREAM=https://api.mistral.ai \
  -e EDENTEXT_AI_PROXY_API_KEY="$MISTRAL_API_KEY" \
  -e EDENTEXT_AI_MODEL=mistral-small-latest \
  ghcr.io/stffnb/edentext
```

Servers you already run, here an Ollama and a speaches instance on the same Docker
network (`compose.yaml`):

```yaml
services:
  edentext:
    image: ghcr.io/stffnb/edentext
    ports: ["8080:80"]
    environment:
      EDENTEXT_AI_PROXY_UPSTREAM: http://ollama:11434
      EDENTEXT_AI_MODEL: qwen3:14b
      EDENTEXT_AI_CONTEXT_TOKENS: "32768"
      EDENTEXT_DICTATION_PROXY_UPSTREAM: http://speaches:8000
      EDENTEXT_DICTATION_MODEL: Systran/faster-whisper-small
```

Through `/v1`, Ollama ignores the context size a request asks for; set it on the server
with `OLLAMA_CONTEXT_LENGTH`.

## Kubernetes

The Helm chart has the same presets and proxies as values, with keys from Secrets; see
[`charts/edentext/README.md`](../charts/edentext/README.md).

## Choosing a speech model

Measured with synthetic voices (`docs/architecture/dictation-local.md`): a Whisper base
model is enough for German, English, Spanish, Portuguese, Russian and Chinese; for French,
Italian, Japanese, Ukrainian and Greek take a larger one, such as small.
