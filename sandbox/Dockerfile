FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Ubuntu leaves the locale unset, which makes agent TUIs and Python misrender
# non-ASCII output. C.UTF-8 is built in, so this needs no locales package.
# Repeated in /etc/environment below, because ENV does not reach SSH sessions.
ENV LANG=C.UTF-8

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
        ripgrep fd-find \
        tmux \
        sqlite3 tree file fzf \
        python3 python3-pip python3-venv python3-dev \
        build-essential \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd \
    && sed -i 's|#\?Port 22$|Port 8023|' /etc/ssh/sshd_config \
    && sed -i 's|#\?PermitRootLogin.*|PermitRootLogin yes|' /etc/ssh/sshd_config \
    && sed -i 's|#\?PasswordAuthentication.*|PasswordAuthentication yes|' /etc/ssh/sshd_config

# GitHub CLI (pinned apt repo with a verified signing key, same pattern as Node
# below) — agents need it for PR and issue work; plain git cannot do either.
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
         > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Node.js (pinned NodeSource apt repo with a verified signing key — no curl | bash).
# apt then cryptographically verifies the nodejs package against the pinned key.
ARG NODE_MAJOR=24
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

# uv — Python package and project manager
ARG UV_VERSION=0.12.1
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) UV_ARCH=x86_64;    UV_SHA256=90b2f223fb69d19db49e117da601f64978593417988530aa733d456141b4bcbb ;; \
        arm64) UV_ARCH=aarch64;   UV_SHA256=769d373e146692c639b5fbaae33b331c297a32e03d30448772051902df52bbf4 ;; \
        *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_ARCH}-unknown-linux-gnu.tar.gz" -o /tmp/uv.tar.gz; \
    echo "${UV_SHA256}  /tmp/uv.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/uv.tar.gz -C /tmp; \
    install -Dm755 "/tmp/uv-${UV_ARCH}-unknown-linux-gnu/uv" /usr/local/bin/uv; \
    install -Dm755 "/tmp/uv-${UV_ARCH}-unknown-linux-gnu/uvx" /usr/local/bin/uvx; \
    rm -rf /tmp/uv.tar.gz "/tmp/uv-${UV_ARCH}-unknown-linux-gnu"

# Claude Code — official installer, always the newest release.
# Installs the launcher into /root/.local/bin; the installer itself
# checksum-verifies the binary it downloads.
#
# The ADD below is the cache key: its content is the current version string, so
# Docker re-runs the install exactly when a new release ships and reuses the
# layer when it hasn't. Kept after the apt/Node/Bun layers on purpose — busting
# it only reruns the cheap steps that follow.
ADD https://downloads.claude.ai/claude-code-releases/latest /tmp/claude-code-version
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && rm -f /tmp/claude-code-version
ENV PATH="/root/.local/bin:$PATH"

# bunny CLI — this repo, published to npm. No install scripts; the platform
# binary comes in as an optional dependency. Its config follows
# XDG_CONFIG_HOME, which is pinned to /workplace below, so credentials persist
# without any extra wiring.
ADD https://registry.npmjs.org/@bunny.net/cli/latest /tmp/bunny-cli-version
RUN npm install -g @bunny.net/cli@latest \
    && rm -f /tmp/bunny-cli-version

# Workplace — SSH sessions land here, and Claude Code, the bunny CLI and gh all
# keep their config and credentials on the persistent volume (the latter two via
# XDG_CONFIG_HOME, which they both honour). /workplace/bin leads the PATH, so
# user scripts placed there run by name and survive a redeploy.
#
# These have to go in /etc/environment, not just ENV: sshd builds a fresh
# environment per session, so Docker ENV never reaches an SSH login. pam_env
# (UsePAM yes) reads this file for both interactive and non-interactive
# sessions, which is also why PATH is spelled out here — .bashrc alone misses
# `ssh <host> <cmd>`. ENV is kept as well so `docker exec` and the entrypoint
# see the same values.
ENV CLAUDE_CONFIG_DIR=/workplace/.claude \
    XDG_CONFIG_HOME=/workplace/.config
ENV PATH="/workplace/bin:$PATH"
RUN mkdir -p /workplace \
    && printf '%s\n' \
        'PATH=/workplace/bin:/root/.local/bin:/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
        'LANG=C.UTF-8' \
        'CLAUDE_CONFIG_DIR=/workplace/.claude' \
        'XDG_CONFIG_HOME=/workplace/.config' \
        >> /etc/environment \
    && printf 'cd /workplace\n' >> /root/.bashrc

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
