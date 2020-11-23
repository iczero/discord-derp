#!/bin/bash
# This script is called in the container to do the actual compilation
set -xe

timeout 15s latex --no-shell-escape -interaction=batchmode input.tex
dvipng -bg Transparent -fg 'rgb 1.0 1.0 1.0' -D 192 input.dvi -o output.png
