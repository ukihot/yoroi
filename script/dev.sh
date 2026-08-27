#!/usr/bin/env bash
# `npm run dev` の中身。consoleのUIを見るには apps/control・apps/merger・
# console(vite dev)の3つが揃っている必要があるが、毎回3つのターミナルで
# 手打ちするのは面倒なので1本にまとめたもの。Ctrl+Cで3つとも一緒に落ちる。
#
# 各アプリの `.env` は個別に用意しておくこと(それぞれの.env.exampleを参照)。
# 存在しなければそのアプリの起動時にそのアプリ自身がエラーで教えてくれる。
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pids=()

cleanup() {
	echo ""
	echo "[dev] stopping apps/control, apps/merger, console..."
	for pid in "${pids[@]:-}"; do
		kill "$pid" >/dev/null 2>&1 || true
	done
}
trap cleanup EXIT INT TERM

echo "[dev] apps/control starting on :8787"
(cd "$root_dir/apps/control" && deno task dev) &
pids+=("$!")

echo "[dev] apps/merger starting on :8788"
(cd "$root_dir/apps/merger" && deno task dev) &
pids+=("$!")

# apps/control・apps/mergerのDeno起動(モジュール読み込み)が終わってから
# consoleを上げた方が、開いた直後の最初のfetchで空振りしにくい。
sleep 1

echo "[dev] console starting on :5173"
(cd "$root_dir" && npx vite dev) &
pids+=("$!")

wait
