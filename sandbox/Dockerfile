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

# Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bun
RUN curl -fsSL https://bun.sh/install | bash
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
