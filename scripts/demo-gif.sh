#!/usr/bin/env bash
#
# demo-gif.sh — turn a screen recording into a README-ready GIF + MP4.
#
# Produces, from one input clip:
#   • <name>.mp4  — H.264, yuv420p, +faststart, audio stripped, sized for web
#   • <name>.gif  — looping, palette-optimized (or gifski if installed)
#
# Usage:
#   scripts/demo-gif.sh recording.mov                 # → assets/recording.{mp4,gif}
#   scripts/demo-gif.sh recording.mov agent-demo      # custom output basename
#   scripts/demo-gif.sh -w 800 -f 12 -o docs rec.mov  # width / fps / out dir
#
# Flags:
#   -w WIDTH   GIF width in px       (default 900;  keeps aspect ratio)
#   -f FPS     GIF frame rate        (default 15)
#   -m WIDTH   MP4 max width in px   (default 1280; only downscales)
#   -o DIR     output directory      (default ./assets)
#   -h         help
#
# Needs ffmpeg. If `gifski` is on PATH it's used for the GIF (smaller + crisper);
# otherwise we fall back to ffmpeg's two-pass palette method.

set -euo pipefail

GIF_WIDTH=900
FPS=15
MP4_WIDTH=1280
OUTDIR="assets"

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while getopts "w:f:m:o:h" opt; do
  case "$opt" in
    w) GIF_WIDTH="$OPTARG" ;;
    f) FPS="$OPTARG" ;;
    m) MP4_WIDTH="$OPTARG" ;;
    o) OUTDIR="$OPTARG" ;;
    h) usage 0 ;;
    *) usage 1 ;;
  esac
done
shift $((OPTIND - 1))

INPUT="${1:-}"
[ -z "$INPUT" ] && { echo "error: no input file"; echo; usage 1; }
[ -f "$INPUT" ] || { echo "error: '$INPUT' not found"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "error: ffmpeg not found (brew install ffmpeg)"; exit 1; }

BASE="${2:-$(basename "${INPUT%.*}")}"
mkdir -p "$OUTDIR"
MP4="$OUTDIR/$BASE.mp4"
GIF="$OUTDIR/$BASE.gif"

echo "▸ input : $INPUT"
echo "▸ output: $MP4 + $GIF  (gif ${GIF_WIDTH}px @ ${FPS}fps, mp4 ≤ ${MP4_WIDTH}px)"
echo

# ── MP4: downscale to MP4_WIDTH if wider, even dims, faststart, no audio ──
echo "→ encoding MP4…"
ffmpeg -y -loglevel error -i "$INPUT" \
  -vf "scale='min($MP4_WIDTH,iw)':-2:flags=lanczos" \
  -c:v libx264 -crf 26 -preset medium -pix_fmt yuv420p \
  -movflags +faststart -an "$MP4"

# ── GIF: gifski (preferred) or ffmpeg palette two-pass ──
if command -v gifski >/dev/null 2>&1; then
  echo "→ encoding GIF (gifski)…"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  ffmpeg -y -loglevel error -i "$INPUT" \
    -vf "fps=$FPS,scale=$GIF_WIDTH:-1:flags=lanczos" "$TMP/f%05d.png"
  gifski --quiet --fps "$FPS" -o "$GIF" "$TMP"/f*.png
else
  echo "→ encoding GIF (ffmpeg palette)…"
  PAL="$(mktemp -t palette.XXXXXX.png)"
  trap 'rm -f "$PAL"' EXIT
  ffmpeg -y -loglevel error -i "$INPUT" \
    -vf "fps=$FPS,scale=$GIF_WIDTH:-1:flags=lanczos,palettegen=stats_mode=diff" "$PAL"
  ffmpeg -y -loglevel error -i "$INPUT" -i "$PAL" \
    -lavfi "fps=$FPS,scale=$GIF_WIDTH:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
    "$GIF"
fi

echo
echo "✓ done"
du -h "$MP4" "$GIF" | sed 's/^/  /'
echo
echo "README embed:"
echo "  MP4:  drag $MP4 into the GitHub README editor (or):  https://…/$OUTDIR/$BASE.mp4"
echo "  GIF:  ![demo]($OUTDIR/$BASE.gif)"
