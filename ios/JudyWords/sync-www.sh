#!/bin/bash
# 将 h5/ 最新构建同步进 iOS 壳的资源目录
set -e
cd "$(dirname "$0")/../.."
rm -rf ios/JudyWords/JudyWords/www
mkdir -p ios/JudyWords/JudyWords/www
cp h5/index.html ios/JudyWords/JudyWords/www/
cp -R h5/css h5/js h5/data ios/JudyWords/JudyWords/www/
echo "✓ www 同步完成：$(find ios/JudyWords/JudyWords/www -type f | wc -l | tr -d ' ') 个文件"
