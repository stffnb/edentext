# AI, dictation, templates and collaboration from the server

An installation can set up the AI assistant and dictation for all its users, so nobody
has to enter a provider or a speech server, and decide which templates New from Template
offers. EdenText stays static: it runs no model and ships none. You point it at a server
you operate or a provider you use; template files are ordinary files on your web server.
Shared sessions need one small server of their own, the relay ([Collaboration](#collaboration)).

## The preset file

`edentext.config.json` next to `index.html` is read once when the editor starts. Every
section and field is optional; the file EdenText ships is empty and presets nothing.

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

## Templates

```json
{
  "templates": {
    "builtIn": false,
    "items": [
      { "id": "letter", "name": { "en": "Business letter", "de": "Geschäftsbrief" },
        "description": "With logo and footer", "url": "templates/letter.ott", "preview": "templates/letter.png" }
    ]
  }
}
```

- **`enabled: false`** removes New from Template and Save as Template, from both toolbars
  and the command search; **`save: false`** removes only Save as Template.
- **`builtIn: false`** leaves the built-in templates out of the gallery. With no entries
  left, New from Template goes as well.
- **`items`**: up to 50 `.ott`, `.odt`, `.dotx` or `.docx` files. `url` is required; a
  relative one is resolved against the editor's page, and only `http(s)` counts. `name`
  and `description` are a text or one per language tag: the UI language's is shown, then
  its base language's, then English's, then the first. Without `name` the file name shows.
  `id` defaults to the address. `preview` is a picture of the first page, a sketch without.
- A picked entry is fetched when it is picked, never cached, and opens as a new, unsaved
  document named after the entry, whatever its extension: the first Save asks where. If it
  cannot be loaded, the open document stays as it is. A password-protected file is refused.
- **Another origin** needs CORS: the file and the preview are fetched by script, so their
  server must send `Access-Control-Allow-Origin` with the editor's origin (or `*`). Same-origin
  files need nothing, and their cookies go along, so they can sit behind the site's sign-in.

**Embedded** (`docs/architecture/embed.md`), the editor offers no templates unless the host's
`templates` option is an object with `items` or `builtIn: true`; it then takes this file's
fields under its own, and an entry may carry `bytes` (an ArrayBuffer) and `fileName` instead
of `url`, so a host behind a sign-in publishes nothing. Save as Template never shows there.

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
| `EDENTEXT_TEMPLATES_ENABLED`, `EDENTEXT_TEMPLATES_BUILT_IN`, `EDENTEXT_TEMPLATES_SAVE` | `false` as `enabled`, `builtIn`, `save` above |
| `EDENTEXT_TEMPLATES_ITEMS` | the `items` array as JSON; mount the files, e.g. `-v ./templates:/usr/share/nginx/html/templates:ro` |
| `EDENTEXT_AI_PROXY_UPSTREAM`, `EDENTEXT_DICTATION_PROXY_UPSTREAM` | root URL that `/ai/` or `/stt/` forwards to; the preset address then defaults to `/ai/v1` or `/stt/v1` |
| `EDENTEXT_AI_PROXY_API_KEY`, `EDENTEXT_DICTATION_PROXY_API_KEY` | key the proxy adds (`Authorization: Bearer`, `x-api-key` for Anthropic) |
| `EDENTEXT_RELAY_UPSTREAM` | the collaboration relay `/relay` forwards to, as `http://host:port` (see below) |
| `EDENTEXT_RELAY_TRUSTED_PROXIES` | addresses or CIDR ranges of the proxies in front, whose `X-Forwarded-For` names the client |

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

## Collaboration

Shared sessions need the relay, a second image. The app offers *Collaborate…* only once
`/relay` on its own host reaches one, so point it there:

```yaml
services:
  edentext:
    image: ghcr.io/stffnb/edentext
    ports: ["8080:80"]
    environment:
      EDENTEXT_RELAY_UPSTREAM: http://relay:4390
    depends_on: [relay]
  relay:
    image: ghcr.io/stffnb/edentext-relay
    environment:
      TRUST_PROXY: "1"
      ALLOWED_ORIGINS: https://docs.example.org
```

- nginx looks the relay's host up when it starts, as it does for the proxies above, and
  does not start while that name is unknown; hence `depends_on`.
- **`TRUST_PROXY=1`** lets the relay count connections per client, not per app container.
  Behind another proxy, set `EDENTEXT_RELAY_TRUSTED_PROXIES` to its address, or every
  user shares the proxy's limit.
- **`ALLOWED_ORIGINS`** is the address users open EdenText at. Without it any web page
  may use your relay through its visitors' browsers.
- **HTTPS:** the browser then connects with `wss://` through the same host, so the TLS proxy
  in front must pass WebSocket upgrades on `/relay`.
- The relay's limits (people per session, connections per address) are environment
  variables, listed in [`relay/CLAUDE.md`](../relay/CLAUDE.md).

## Kubernetes

The Helm chart has the same presets and proxies as values, with keys from Secrets, mounts
a volume of template files under `/templates/` and runs the relay by default; see
[`charts/edentext/README.md`](../charts/edentext/README.md).

## Choosing a speech model

Measured with synthetic voices (`docs/architecture/dictation-local.md`): a Whisper base
model is enough for German, English, Spanish, Portuguese, Russian and Chinese; for French,
Italian, Japanese, Ukrainian and Greek take a larger one, such as small.
