#!/bin/sh
# Writes edentext.config.json and the /ai/ and /stt/ proxies from EDENTEXT_* variables at
# container start (docs/self-hosting.md); without them neither exists. Keys reach nginx only.
set -eu

html=${EDENTEXT_HTML_DIR:-/usr/share/nginx/html}
nginx=${EDENTEXT_NGINX_DIR:-/etc/nginx}

fail() { echo "$0: $*" >&2; exit 1; }

fields=''
add() { fields="${fields:+$fields, }\"$1\": $2"; }
text() {
  case "$2" in *[[:cntrl:]]*) fail "$1 holds a control character" ;; esac
  [ -z "$2" ] || add "$1" "\"$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')\""
}
flag() {
  case "$2" in '') ;; true|false) add "$1" "$2" ;; *) fail "$3 must be true or false" ;; esac
}

json=''
section() {
  [ -z "$fields" ] || json="${json:+$json, }\"$1\": { $fields }"
  fields=''
}

ai_endpoint=${EDENTEXT_AI_ENDPOINT:-}
[ -n "$ai_endpoint" ] || [ -z "${EDENTEXT_AI_PROXY_UPSTREAM:-}" ] || ai_endpoint=/ai/v1
case "${EDENTEXT_AI_PROVIDER:-}" in ''|openai|anthropic) ;; *) fail 'EDENTEXT_AI_PROVIDER must be openai or anthropic' ;; esac
flag enabled "${EDENTEXT_AI_ENABLED:-}" EDENTEXT_AI_ENABLED
text provider "${EDENTEXT_AI_PROVIDER:-}"
text endpoint "$ai_endpoint"
text model "${EDENTEXT_AI_MODEL:-}"
case "${EDENTEXT_AI_CONTEXT_TOKENS:-}" in
  '') ;;
  *[!0-9]*) fail 'EDENTEXT_AI_CONTEXT_TOKENS must be a number' ;;
  *) [ "$EDENTEXT_AI_CONTEXT_TOKENS" -ge 2048 ] || fail 'EDENTEXT_AI_CONTEXT_TOKENS must be at least 2048'
     add contextTokens "$EDENTEXT_AI_CONTEXT_TOKENS" ;;
esac
flag locked "${EDENTEXT_AI_LOCKED:-}" EDENTEXT_AI_LOCKED
section ai

stt_server=${EDENTEXT_DICTATION_SERVER:-}
[ -n "$stt_server" ] || [ -z "${EDENTEXT_DICTATION_PROXY_UPSTREAM:-}" ] || stt_server=/stt/v1
flag enabled "${EDENTEXT_DICTATION_ENABLED:-}" EDENTEXT_DICTATION_ENABLED
text server "$stt_server"
text model "${EDENTEXT_DICTATION_MODEL:-}"
flag locked "${EDENTEXT_DICTATION_LOCKED:-}" EDENTEXT_DICTATION_LOCKED
flag webSpeech "${EDENTEXT_DICTATION_WEB_SPEECH:-}" EDENTEXT_DICTATION_WEB_SPEECH
section dictation

if [ -n "$json" ]; then
  printf '{ %s }\n' "$json" > "$html/edentext.config.json"
else
  rm -f "$html/edentext.config.json"
fi

# A same-origin proxy: nginx sets the key (or clears the browser's headers) and drops
# Origin and cookies, which the operator's server has no use for.
proxy() {
  path=$1 upstream=$2 header=$3 key=$4 timeout=$5 body=$6
  case "$upstream" in http://?*|https://?*) ;; *) fail "the upstream for $path must be an http(s) URL" ;; esac
  case "$upstream$key" in *[\"\\\$\;{}[:space:]]*) fail "the upstream or key for $path holds a character nginx cannot take" ;; esac
  auth='""' xkey='""'
  if [ -n "$key" ] && [ "$header" = x-api-key ]; then xkey="\"$key\""; elif [ -n "$key" ]; then auth="\"Bearer $key\""; fi
  cat <<CONF
location $path {
  proxy_pass ${upstream%/}/;
  proxy_http_version 1.1;
  proxy_ssl_server_name on;
  proxy_set_header Origin "";
  proxy_set_header Cookie "";
  proxy_set_header Authorization $auth;
  proxy_set_header x-api-key $xkey;
  proxy_buffering off;
  proxy_read_timeout $timeout;
  proxy_send_timeout $timeout;
  client_max_body_size $body;
}
CONF
}

conf="$nginx/edentext.d/proxy.conf"
rm -f "$conf"
if [ -n "${EDENTEXT_AI_PROXY_UPSTREAM:-}${EDENTEXT_DICTATION_PROXY_UPSTREAM:-}" ]; then
  mkdir -p "$nginx/edentext.d"
  umask 077
  {
    if [ -n "${EDENTEXT_AI_PROXY_UPSTREAM:-}" ]; then
      header=Authorization
      [ "${EDENTEXT_AI_PROVIDER:-}" != anthropic ] || header=x-api-key
      proxy /ai/ "$EDENTEXT_AI_PROXY_UPSTREAM" "$header" "${EDENTEXT_AI_PROXY_API_KEY:-}" 600s 64m
    fi
    if [ -n "${EDENTEXT_DICTATION_PROXY_UPSTREAM:-}" ]; then
      proxy /stt/ "$EDENTEXT_DICTATION_PROXY_UPSTREAM" Authorization "${EDENTEXT_DICTATION_PROXY_API_KEY:-}" 60s 16m
    fi
  } > "$conf"
  # The image's own server block gains the include once, after its IPv6 setup has run.
  site="$nginx/conf.d/default.conf"
  if ! grep -q 'edentext.d/' "$site"; then
    awk -v inc="    include $nginx/edentext.d/*.conf;" '{ print } !done && /^[[:space:]]*server[[:space:]]*\{/ { print inc; done = 1 }' "$site" > "$site.new"
    cat "$site.new" > "$site" && rm -f "$site.new"
  fi
fi
