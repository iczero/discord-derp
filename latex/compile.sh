#!/bin/bash
# This script is called in the container to do the actual compilation
set -xe

timeout 5s pdflatex -no-shell-escape -interaction=batchmode input.tex
gs -dBATCH -dNOPAUSE -dSAFER -DTextAlphaBits=4 -dGraphicsOutputBits=4 -sDEVICE=pngalpha -r400 -o output.png input.pdf
