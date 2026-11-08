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

{{/* The relay's resources, named apart from the web server's. */}}
{{- define "edentext.relayName" -}}
{{- printf "%s-relay" (include "edentext.fullname" . | trunc 57 | trimSuffix "-") }}
{{- end }}

{{/* The relay's selector labels: a name of its own, so the web server's selector,
     which is name and instance only, never takes in a relay pod. */}}
{{- define "edentext.relaySelectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-relay" (include "edentext.name" . | trunc 57 | trimSuffix "-") | quote }}
app.kubernetes.io/instance: {{ .Release.Name | quote }}
{{- end }}

{{/* The relay's tagged image with an optional immutable digest. */}}
{{- define "edentext.relayImage" -}}
{{- $tag := default .Chart.AppVersion .Values.relay.image.tag }}
{{- $image := printf "%s:%s" .Values.relay.image.repository $tag }}
{{- if .Values.relay.image.digest }}
{{- printf "%s@%s" $image .Values.relay.image.digest }}
{{- else }}
{{- $image }}
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
