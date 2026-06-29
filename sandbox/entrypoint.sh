#!/bin/bash
set -e

if [ -z "${AGENT_TOKEN}" ]; then
  echo "AGENT_TOKEN is not set; refusing to start with an empty root password." >&2
  exit 1
fi

echo "root:${AGENT_TOKEN}" | chpasswd
exec /usr/sbin/sshd -D
