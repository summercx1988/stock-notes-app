#!/bin/bash

# 自动构建并更新应用脚本
# 用法: ./build-and-update.sh

echo "🚀 开始构建股票投资笔记..."

# 清理旧的构建缓存
echo "🧹 清理缓存..."
rm -rf dist/
rm -rf release/mac*

# 执行构建
echo "📦 正在构建..."
npm run electron:build

if [ $? -eq 0 ]; then
    echo "✅ 构建成功！"
    echo ""
    echo "📍 应用位置:"
    ls -lh release/*.dmg
    echo ""
    echo "💡 提示: Dock中的替身会自动指向新版本"
else
    echo "❌ 构建失败，请检查错误信息"
    exit 1
fi
