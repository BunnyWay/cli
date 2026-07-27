#!/bin/bash
set -e

if [ -z "${AGENT_TOKEN}" ]; then
  echo "AGENT_TOKEN is not set; refusing to start with an empty root password." >&2
  exit 1
fi

echo "root:${AGENT_TOKEN}" | chpasswd

# The persistent volume mounts over /workplace after the image is built, so the
# agent config directories have to be created here — anything created at build
# time is hidden by the mount. Codex is strict about this: it aborts with
# "CODEX_HOME points to ... but that path does not exist" rather than creating
# it, so a missing directory would break `codex` entirely.
mkdir -p /workplace/.claude \
         /workplace/.codex \
         /workplace/.config \
         /workplace/.local/share \
         /workplace/.local/state

exec /usr/sbin/sshd -D
