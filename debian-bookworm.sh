#!/bin/bash

cat <<EOF | tee /etc/apt/sources.list
deb http://deb.debian.org/debian bookworm main contrib non-free
deb http://deb.debian.org/debian bookworm-updates main contrib non-free
deb http://deb.debian.org/debian bookworm-backports main contrib non-free
deb http://security.debian.org/debian-security/ bookworm-security main contrib non-free
EOF
