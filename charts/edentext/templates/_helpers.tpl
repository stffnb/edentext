{{/* Chart name. */}}
{{- define "edentext.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Release-qualified resource name. */}}
{{- define "edentext.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* Chart label value. */}}
{{- define "edentext.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Common labels. */}}
{{- define "edentext.labels" -}}
helm.sh/chart: {{ include "edentext.chart" . }}
{{ include "edentext.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels. */}}
{{- define "edentext.selectorLabels" -}}
app.kubernetes.io/name: {{ include "edentext.name" . | quote }}
app.kubernetes.io/instance: {{ .Release.Name | quote }}
{{- end }}

{{/* Service account name. */}}
{{- define "edentext.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "edentext.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Tagged image with an optional immutable digest. */}}
{{- define "edentext.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag }}
{{- $image := printf "%s:%s" .Values.image.repository $tag }}
{{- if .Values.image.digest }}
{{- printf "%s@%s" $image .Values.image.digest }}
{{- else }}
{{- $image }}
{{- end }}
{{- end }}

{{/* edentext.config.json: only the presets that differ from the app's defaults; empty for none. */}}
{{- define "edentext.hostConfig" -}}
{{- $cfg := dict }}
{{- $ai := dict }}
{{- with .Values.ai }}
{{- if not .enabled }}{{ $_ := set $ai "enabled" false }}{{ end }}
{{- if ne .provider "openai" }}{{ $_ := set $ai "provider" .provider }}{{ end }}
{{- with (.endpoint | default (ternary "/ai/v1" "" .proxy.enabled)) }}{{ $_ := set $ai "endpoint" . }}{{ end }}
{{- with .model }}{{ $_ := set $ai "model" . }}{{ end }}
{{- with .contextTokens }}{{ $_ := set $ai "contextTokens" (int .) }}{{ end }}
{{- if .locked }}{{ $_ := set $ai "locked" true }}{{ end }}
{{- end }}
{{- if $ai }}{{ $_ := set $cfg "ai" $ai }}{{ end }}
{{- $dictation := dict }}
{{- with .Values.dictation }}
{{- if not .enabled }}{{ $_ := set $dictation "enabled" false }}{{ end }}
{{- with (.server | default (ternary "/stt/v1" "" .proxy.enabled)) }}{{ $_ := set $dictation "server" . }}{{ end }}
{{- with .model }}{{ $_ := set $dictation "model" . }}{{ end }}
{{- if .locked }}{{ $_ := set $dictation "locked" true }}{{ end }}
{{- end }}
{{- if $dictation }}{{ $_ := set $cfg "dictation" $dictation }}{{ end }}
{{- if $cfg }}{{ toPrettyJson $cfg }}{{ end }}
{{- end }}

{{/* Whether a proxy adds a key, which an init container writes into nginx.conf. */}}
{{- define "edentext.proxyKeys" -}}
{{- if or (and .Values.ai.proxy.enabled .Values.ai.proxy.apiKeySecret.name) (and .Values.dictation.proxy.enabled .Values.dictation.proxy.apiKeySecret.name) }}true{{ end }}
{{- end }}

{{/*
A same-origin proxy to the operator's server: nginx sets the key (or clears the browser's
headers) and drops Origin, which some servers refuse. Args: path, upstream, header, var.
*/}}
{{- define "edentext.proxyLocation" -}}
location {{ .path }} {
  proxy_pass {{ .upstream | trimSuffix "/" }}/;
  proxy_http_version 1.1;
  proxy_ssl_server_name on;
  proxy_set_header Origin "";
  proxy_set_header Cookie "";
  proxy_set_header Authorization {{ if and .var (eq .header "Authorization") }}"Bearer ${{ .var }}"{{ else }}""{{ end }};
  proxy_set_header x-api-key {{ if and .var (eq .header "x-api-key") }}"${{ .var }}"{{ else }}""{{ end }};
  proxy_buffering off;
  proxy_read_timeout {{ .timeout }};
  proxy_send_timeout {{ .timeout }};
  client_max_body_size {{ .body }};
}
{{- end }}
