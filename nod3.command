#!/usr/bin/env bash
# Double-click this in Finder to start nod3.
#
# macOS opens .command files in Terminal, which is what makes the single click
# work. The window stays open while the app runs; closing it stops the app.
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
exec ./scripts/start.sh "$@"
