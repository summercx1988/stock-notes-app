#!/bin/bash

# Sherpa-ONNX 中文语音识别模型下载脚本

MODELS_DIR="$(dirname "$0")/../models"
mkdir -p "$MODELS_DIR"

echo "正在下载 Sherpa-ONNX 中文流式识别模型..."

# 中文流式识别模型 (约 70MB)
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-ctc-multi-zh-hans-2023-12-13.tar.bz2"
MODEL_NAME="sherpa-onnx-streaming-zipformer-ctc-multi-zh-hans-2023-12-13"

cd "$MODELS_DIR"

# 尝试使用 curl
if command -v curl &> /dev/null; then
    echo "使用 curl 下载..."
    curl -L -o model.tar.bz2 "$MODEL_URL" && tar xf model.tar.bz2 && rm model.tar.bz2
# 尝试使用 wget
elif command -v wget &> /dev/null; then
    echo "使用 wget 下载..."
    wget -O model.tar.bz2 "$MODEL_URL" && tar xf model.tar.bz2 && rm model.tar.bz2
else
    echo "错误: 需要 curl 或 wget"
    echo "请手动下载模型:"
    echo "  URL: $MODEL_URL"
    echo "  解压到: $MODELS_DIR/"
    exit 1
fi

if [ -d "$MODEL_NAME" ]; then
    echo "✅ 模型下载成功: $MODELS_DIR/$MODEL_NAME"
    ls -la "$MODEL_NAME"
else
    echo "❌ 模型下载失败"
    exit 1
fi
