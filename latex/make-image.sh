#!/bin/bash
set -x

basedir=$(dirname $(readlink -f "${BASH_SOURCE[0]}"))
cd "$basedir"

tmpdir=$(mktemp -d "$basedir/jobs/XXXXXXXXXX")
if [[ "$tmpdir" == "" ]]; then
  exit 2
fi
cat tex.head - tex.tail > "$tmpdir/input.tex"
podman run --rm -v "$tmpdir:/data" latexbuild:1.0 >&2
compilestatus=$?
echo "exit status: $compilestatus" >&2
exitstatus=0
if [[ $compilestatus == 0 ]]; then
  cat "$tmpdir/output.png"
else
  exitstatus=1
  cat "$tmpdir/input.log"
fi
rm -rf "$tmpdir"
exit $exitstatus
