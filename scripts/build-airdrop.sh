#!/bin/bash
# Builds the AirDrop tools of Osmin (C, no libraries needed) into airdrop/build/ and runs their tests.
#   scripts/build-airdrop.sh
set -euo pipefail
cd "$(dirname "$0")/../airdrop"
mkdir -p build
CFLAGS="-O2 -Wall -Wextra -Werror"
gcc $CFLAGS -o build/test_awdl test_awdl.c awdl.c
./build/test_awdl
gcc $CFLAGS -o build/osmin-awdl osmin-awdl.c awdl.c
gcc $CFLAGS -o build/osmin-awdld osmin-awdld.c awdl.c
python3 test_airdrop.py | tail -1
echo "built airdrop/build/osmin-awdl and osmin-awdld"
