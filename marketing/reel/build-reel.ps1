# Builds marketing/reel/dale-reel.mp4 (1080×1920, 30 fps, silent) from the phone clips in marketing/footage
# and the cards rendered from cards.html into marketing/reel/build. Add music in Instagram when posting.
$ErrorActionPreference = "Stop"
$ff = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName
$foot = Join-Path $PSScriptRoot "..\footage"; $b = Join-Path $PSScriptRoot "build"; $seg = Join-Path $b "seg"
New-Item -ItemType Directory -Force $seg | Out-Null
$enc = @("-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30")

# phone clip → 9:16: trim, speed up, crop a 1920-tall window starting at $y (110 drops the status bar), overlay text
function Clip($name, $src, $start, $dur, $speed, $y, $ov) {
  $vf = "setpts=(PTS-STARTPTS)/$speed,crop=1080:1920:0:$y,fps=30"
  if ($ov) { & $ff -y -loglevel error -ss $start -t $dur -i "$foot\$src" -i "$b\$ov" -filter_complex "[0:v]$vf[v];[v][1:v]overlay=0:0" @enc "$seg\$name.mp4" }
  else { & $ff -y -loglevel error -ss $start -t $dur -i "$foot\$src" -vf $vf @enc "$seg\$name.mp4" }
}

& $ff -y -loglevel error -framerate 30 -i "$b\title\f%03d.png" @enc "$seg\01.mp4"                      # 2.5 s title
Clip "02"  "02-setup.mp4"          1.5  9.5  3.2 110 "ov02.png"                                          # setup, ~3 s
Clip "03"  "03-demo-squat.mp4"     1.2 11.8  3.0 110 "ov03.png"                                          # squat demo turn, ~3.9 s
Clip "04"  "04-styles.mp4"         1.5 10.0  3.3 110 "ov04.png"                                          # gym → home → calisthenics
Clip "05"  "05-log-sets.mp4"       1.5  5.5  1.8 110 "ov05.png"                                          # weight hint + sets
Clip "06a" "06-add-video.mp4"     26.0  1.5  1.0 480 "ov06.png"                                          # clip loaded (picker cut out)
Clip "06b" "06-add-video.mp4"     33.0 39.0 30.0 480 "ov06.png"                                          # "Analysing… %", 30× speed
Clip "06c" "06-add-video.mp4"     75.0  1.5  1.0 480 "ov06.png"                                          # "Movement: Squat"
Clip "06d" "06b-video-demo.mp4"    1.5 11.0  4.0 110 "ov06.png"                                          # the stick-figure demo
Clip "07"  "07-nutrition.mp4"      1.0  8.9  3.0 110 "ov07.png"                                          # macros and meals
Clip "08"  "08-reminder-banner.mp4" 3.5 7.0  2.0 110 "ov08.png"                                          # reminder banner
& $ff -y -loglevel error -loop 1 -framerate 30 -t 3 -i "$b\end.png" -vf "fade=in:st=0:d=0.4,fade=out:st=2.4:d=0.6" @enc "$seg\09.mp4"

$list = Join-Path $seg "list.txt"
"01","02","03","04","05","06a","06b","06c","06d","07","08","09" | ForEach-Object { "file '$seg\$_.mp4'".Replace("\", "/") } | Set-Content -Encoding ascii $list
& $ff -y -loglevel error -f concat -safe 0 -i $list -c copy -movflags +faststart (Join-Path $PSScriptRoot "dale-reel.mp4")
Get-Item (Join-Path $PSScriptRoot "dale-reel.mp4")
