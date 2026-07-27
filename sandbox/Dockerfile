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

# Codex CLI — installed from the npm registry, which integrity-checks the
# tarball, rather than the piped installer the docs lead with. The package has
# no install scripts; the platform binary comes in as an optional dependency,
# so amd64 and arm64 both resolve automatically.
#
# Same cache-key trick as above: this manifest changes only when a new version
# is published, so @latest is re-resolved exactly then.
ADD https://registry.npmjs.org/@openai/codex/latest /tmp/codex-version
RUN npm install -g @openai/codex@latest \
    && rm -f /tmp/codex-version

# opencode — same reasoning as Codex: npm over the piped installer, so the
# tarball is integrity-checked. Its postinstall picks the matching platform
# binary out of the optional dependencies, so this resolves per build platform.
ADD https://registry.npmjs.org/opencode-ai/latest /tmp/opencode-version
RUN npm install -g opencode-ai@latest \
    && rm -f /tmp/opencode-version \
    && rm -rf /root/.config/opencode /root/.local/share/opencode \
              /root/.local/state/opencode /root/.cache/opencode

# bunny CLI — this repo, published to npm. No install scripts; the platform
# binary comes in as an optional dependency. Its config follows
# XDG_CONFIG_HOME, which is pinned to /workplace below, so credentials persist
# without any extra wiring.
ADD https://registry.npmjs.org/@bunny.net/cli/latest /tmp/bunny-cli-version
RUN npm install -g @bunny.net/cli@latest \
    && rm -f /tmp/bunny-cli-version

# Workplace — SSH sessions land here, and every agent CLI keeps its config,
# credentials and session history on the persistent volume.
#
# These have to go in /etc/environment, not just ENV: sshd builds a fresh
# environment per session, so Docker ENV never reaches an SSH login. pam_env
# (UsePAM yes) reads this file for both interactive and non-interactive
# sessions, which is also why PATH is spelled out here — .bashrc alone misses
# `ssh <host> <cmd>`. ENV is kept as well so `docker exec` and the entrypoint
# see the same values.
ENV CLAUDE_CONFIG_DIR=/workplace/.claude \
    CODEX_HOME=/workplace/.codex \
    XDG_CONFIG_HOME=/workplace/.config \
    XDG_DATA_HOME=/workplace/.local/share \
    XDG_STATE_HOME=/workplace/.local/state
RUN mkdir -p /workplace \
    && printf '%s\n' \
        'PATH=/root/.local/bin:/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
        'LANG=C.UTF-8' \
        'CLAUDE_CONFIG_DIR=/workplace/.claude' \
        'CODEX_HOME=/workplace/.codex' \
        'XDG_CONFIG_HOME=/workplace/.config' \
        'XDG_DATA_HOME=/workplace/.local/share' \
        'XDG_STATE_HOME=/workplace/.local/state' \
        >> /etc/environment \
    && printf 'cd /workplace\n' >> /root/.bashrc

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
