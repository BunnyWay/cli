#!/bin/bash
set -e

echo "root:${AGENT_TOKEN}" | chpasswd
exec /usr/sbin/sshd -D
