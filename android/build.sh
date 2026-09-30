#!/usr/bin/env bash
# douyin-dl Android APK 构建脚本（无需 Gradle，直接用 build-tools 工具链）
# 前置：JDK 17（winget 装 EclipseAdoptium.Temurin.17.JDK）、
#       Android cmdline-tools + platforms;android-34 + build-tools;34.0.0
# 产物：android/douyin-dl-1.1.0.apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK:-$LOCALAPPDATA/android-sdk}"
BT="$SDK/build-tools/34.0.0"
PLAT="$SDK/platforms/android-34/android.jar"
OUT="$ROOT/build"

JDK="$(ls -d /c/Program\ Files/Eclipse\ Adoptium/jdk-17* 2>/dev/null | head -1 || true)"
[ -z "$JDK" ] && JDK="$(ls -d "$LOCALAPPDATA/Programs/Eclipse Adoptium/jdk-17"* 2>/dev/null | head -1)"
[ -z "$JDK" ] && { echo "未找到 JDK 17"; exit 1; }
export PATH="$(cygpath -u "$JDK")/bin:$PATH"
echo "JDK: $JDK"

mkdir -p "$OUT/classes"

echo "[1/6] aapt2 compile 资源"
cygpath -w "$BT/aapt2.exe" >/dev/null # noop, 确保 BT 路径存在
"$BT/aapt2.exe" compile --dir "$ROOT/app/src/main/res" -o "$OUT/res.zip"

echo "[2/6] aapt2 link 清单+资源"
"$BT/aapt2.exe" link -o "$OUT/app-unsigned.apk" -I "$PLAT" \
  --manifest "$ROOT/app/src/main/AndroidManifest.xml" \
  -A "$ROOT/app/src/main/assets" \
  -R "$OUT/res.zip" --java "$OUT/gen" \
  --min-sdk-version 29 --target-sdk-version 34 --auto-add-overlay

echo "[3/6] javac 编译"
javac -source 1.8 -target 1.8 -nowarn -encoding UTF-8 \
  -classpath "$PLAT" -d "$OUT/classes" \
  $(find "$ROOT/app/src/main/java" -name '*.java')

echo "[4/6] d8 转 dex 并并入 APK"
"$BT/d8.bat" --release --lib "$PLAT" --output "$OUT" \
  $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && jar -uf app-unsigned.apk classes.dex)

echo "[5/6] zipalign + 签名"
"$BT/zipalign.exe" -f 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"
if [ ! -f "$ROOT/debug.keystore" ]; then
  keytool -genkeypair -keystore "$ROOT/debug.keystore" -alias androiddebugkey \
    -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=douyin-dl,O=yuanyuandada,C=CN" >/dev/null 2>&1
fi
"$BT/apksigner.bat" sign --ks "$ROOT/debug.keystore" \
  --ks-pass pass:android --key-pass pass:android \
  --out "$ROOT/douyin-dl-1.1.0.apk" "$OUT/app-aligned.apk"

echo "[6/6] 校验"
"$BT/apksigner.bat" verify "$ROOT/douyin-dl-1.1.0.apk"
echo "✓ APK: $ROOT/douyin-dl-1.1.0.apk ($(stat -c %s "$ROOT/douyin-dl-1.1.0.apk") bytes)"
