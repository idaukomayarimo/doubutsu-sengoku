#!/bin/sh
# index.html → artifact.html（claude.ai 公開用）
#   - 改行コード（CRLF）をそろえる
#   - 外枠タグ（DOCTYPE/html/head/body）と charset/viewport を除去（公開側が付ける）
#   - PWA 専用部分（pwa:start〜pwa:end）を除去
#   - <title> を先頭へ移動し、二重になる安全域余白を 0 に上書き
set -e
cd "$1"
perl -0pe '
  s/\x0d//g;
  s/[ \t]*<!--\s*pwa:start.*?pwa:end\s*-->\n//gs;
  s/^[ \t]*<!DOCTYPE html>\n//mi;
  s/^[ \t]*<html[^>]*>\n//m;
  s/^[ \t]*<\/html>\n?//m;
  s/^[ \t]*<head>\n//m;
  s/^[ \t]*<\/head>\n//m;
  s/^[ \t]*<body>\n//m;
  s/^[ \t]*<\/body>\n?//m;
  s/^[ \t]*<meta charset[^>]*>\n//m;
  s/^[ \t]*<meta name="viewport"[^>]*>\n//m;
  s{\A(.*?)[ \t]*(<title>[^<]*</title>\n)}{$2$1}s;
  s{(<title>[^<]*</title>\n)}{$1<style>:root { --app-safe-top: 0px; --app-safe-bottom: 0px; }</style>\n};
' index.html > artifact.html
