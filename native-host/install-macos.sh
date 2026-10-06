#!/bin/zsh
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
manifest_dir="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
manifest_name="com.timecyber.immersivetranslate.manga_backend.json"

if ! command -v cc >/dev/null 2>&1; then
  echo "未找到 macOS C 编译器 cc，无法构建 Zen Native Messaging 启动器。" >&2
  exit 1
fi

cc -O2 -Wall -Wextra -o "$script_dir/manga_backend_host" \
  "$script_dir/manga_backend_host.c"
chmod +x "$script_dir/manga_backend_host"

mkdir -p "$manifest_dir"
cp "$script_dir/$manifest_name" "$manifest_dir/$manifest_name"
echo "已安装 Firefox/Zen Native Messaging 启动器："
echo "$manifest_dir/$manifest_name"
echo "请重新加载扩展后使用‘启动 App 核心桥接’按钮。"
