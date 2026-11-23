# CI's LibreOffice for the layout run on another platform (LAYOUT_LO=docker): the same
# TDF build and fonts as .github/workflows/ci.yml, since LibreOffice places a font's line
# gap per platform. LO_VERSION comes from ci.yml; the deb follows the host architecture.
FROM ubuntu:24.04
ARG LO_VERSION
ARG TARGETARCH
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    curl ca-certificates fonts-liberation poppler-utils \
    libx11-6 libx11-xcb1 libxext6 libxinerama1 libcairo2 libcups2t64 libdbus-1-3 libfontconfig1 \
    libfreetype6 libglib2.0-0t64 libnss3 libxml2 \
  && if [ "$TARGETARCH" = arm64 ]; then dir=aarch64 file=aarch64; else dir=x86_64 file=x86-64; fi \
  && curl -fsSL --retry 5 -o /tmp/lo.tgz "https://downloadarchive.documentfoundation.org/libreoffice/old/$LO_VERSION/deb/$dir/LibreOffice_${LO_VERSION}_Linux_${file}_deb.tar.gz" \
  && mkdir /tmp/lo && tar -xzf /tmp/lo.tgz -C /tmp/lo --strip-components=1 && dpkg -i /tmp/lo/DEBS/*.deb \
  && ln -s /opt/libreoffice*/program/soffice /usr/local/bin/soffice \
  && rm -rf /tmp/lo /tmp/lo.tgz /var/lib/apt/lists/*
ENV HOME=/tmp
