FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System tools + SSH + Python
RUN apt-get update && apt-get install -y \
        openssh-server \
        curl wget \
        nano vim \
        git \
        procps htop \
        net-tools iputils-ping \
        unzip zip \
        jq \
        python3 python3-pip python3-venv python3-dev \
        build-essential \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd \
    && sed -i 's|#\?Port 22$|Port 8023|' /etc/ssh/sshd_config \
    && sed -i 's|#\?PermitRootLogin.*|PermitRootLogin yes|' /etc/ssh/sshd_config \
    && sed -i 's|#\?PasswordAuthentication.*|PasswordAuthentication yes|' /etc/ssh/sshd_config

# Node.js (pinned NodeSource apt repo with a verified signing key — no curl | bash).
# apt then cryptographically verifies the nodejs package against the pinned key.
ARG NODE_MAJOR=22
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
         -o /etc/apt/keyrings/nodesource.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
         > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bun (pinned version, checksum-verified release artifact — no curl | bash).
ARG BUN_VERSION=1.3.14
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) BUN_ARCH=x64;       BUN_SHA256=951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f ;; \
        arm64) BUN_ARCH=aarch64;   BUN_SHA256=a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b ;; \
        *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${BUN_ARCH}.zip" -o /tmp/bun.zip; \
    echo "${BUN_SHA256}  /tmp/bun.zip" | sha256sum -c -; \
    unzip -q /tmp/bun.zip -d /tmp/bun; \
    install -Dm755 "/tmp/bun/bun-linux-${BUN_ARCH}/bun" /root/.bun/bin/bun; \
    rm -rf /tmp/bun.zip /tmp/bun
ENV PATH="/root/.bun/bin:$PATH"

# Claude Code
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://downloads.claude.ai/keys/claude-code.asc \
         -o /etc/apt/keyrings/claude-code.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/stable stable main" \
         > /etc/apt/sources.list.d/claude-code.list \
    && apt-get update && apt-get install -y claude-code \
    && rm -rf /var/lib/apt/lists/*

# Workplace — SSH sessions land here, bun on PATH, Claude config lives here
ENV CLAUDE_CONFIG_DIR=/workplace/.claude
RUN mkdir -p /workplace \
    && printf 'cd /workplace\nexport PATH="/root/.bun/bin:$PATH"\n' >> /root/.bashrc

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
