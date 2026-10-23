# Drive GymBro on a connected phone for store screenshots and reel footage.
# Usage: . .\phone.ps1  then  Tap 540 1200; Shot "01-today"
# (The WebView exposes no accessibility tree to uiautomator, so taps are by position.)
$Dev = "192.168.0.168:5555"
$Out = Join-Path $PSScriptRoot "screens"
New-Item -ItemType Directory -Force $Out | Out-Null

function Tap([int]$x, [int]$y) { adb -s $Dev shell input tap $x $y; Start-Sleep -Milliseconds 800 }
function Scroll([int]$px) { adb -s $Dev shell input swipe 540 1800 540 (1800 - $px) 500; Start-Sleep -Milliseconds 700 }
function Peek { cmd /c "adb -s $Dev exec-out screencap -p > `"$env:TEMP\gb-peek.png`""; "$env:TEMP\gb-peek.png" }
# Play allows at most 2:1, so 1080×2400 is cropped to 1080×2160 (status bar and gesture bar removed)
function Shot([string]$name) {
  $raw = "$env:TEMP\gb-shot.png"
  cmd /c "adb -s $Dev exec-out screencap -p > `"$raw`""
  python -c "from PIL import Image; Image.open(r'$raw').convert('RGB').crop((0,120,1080,2280)).save(r'$Out\$name.png')"
  "$Out\$name.png"
}
