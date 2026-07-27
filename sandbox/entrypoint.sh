#!/bin/bash
set -e

if [ -z "${AGENT_TOKEN}" ]; then
  echo "AGENT_TOKEN is not set; refusing to start with an empty root password." >&2
  exit 1
fi

echo "root:${AGENT_TOKEN}" | chpasswd

# The persistent volume mounts over /workplace after the image is built, so the
# config directories have to be created here — anything created at build time is
# hidden by the mount.
mkdir -p /workplace/.claude \
         /workplace/.config

exec /usr/sbin/sshd -D
