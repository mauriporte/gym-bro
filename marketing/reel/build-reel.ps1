# Builds the Dale reel (1080×1920, 30 fps, silent) from the phone clips in marketing/footage[/es]
# and cards rendered from cards.html. Usage:  .\build-reel.ps1 [-Lang en|es]   → dale-reel[-es].mp4
# Needs Chrome, Python (serves the fonts while rendering) and ffmpeg (winget install Gyan.FFmpeg).
param([ValidateSet("en", "es")][string]$Lang = "en")
$ErrorActionPreference = "Continue"   # Chrome writes harmless warnings to stderr
$ff = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$foot = if ($Lang -eq "es") { Join-Path $repo "marketing\footage\es" } else { Join-Path $repo "marketing\footage" }
$b = Join-Path $PSScriptRoot "build\$Lang"; $seg = Join-Path $b "seg"
New-Item -ItemType Directory -Force "$b\title", $seg | Out-Null
$out = Join-Path $PSScriptRoot $(if ($Lang -eq "es") { "dale-reel-es.mp4" } else { "dale-reel.mp4" })

$text = @{
  en = @{ line = "Your trainer.|In your pocket."; big = "No ads. No paywall.|No excuses."; sub = "Coming soon to Google Play"
          "02" = "Answer 5 questions."; "03" = "Every move. Every angle."; "04" = "Gym. Home. Calisthenics."
          "05" = "Log your sets. It tells you what to change."; "06" = "Film any exercise. It becomes a demo."
          "07" = "Calories. Macros. Recipes."; "08" = "Skip the gym? It notices." }
  es = @{ line = "Tu entrenador.|En tu bolsillo."; big = "Sin anuncios. Sin suscripción.|Sin excusas."; sub = "Muy pronto en Google Play"
          "02" = "Responde 5 preguntas."; "03" = "Cada ejercicio. Cada ángulo."; "04" = "Gimnasio. Casa. Calistenia."
          "05" = "Anota tus series. La app te dice qué cambiar."; "06" = "Graba cualquier ejercicio. Se convierte en demo."
          "07" = "Calorías. Macros. Recetas."; "08" = "¿Te saltas el gym? Se da cuenta." }
}[$Lang]
# where shot 6 happens in each language's long add-exercise recording: [loaded, analysis start, analysis length, result]
$six = @{ en = @(26.0, 33.0, 39.0, 75.0); es = @(9.0, 14.0, 40.0, 57.0) }[$Lang]

# render cards through a throwaway local server so the web fonts load
$port = 8790; $srv = Start-Process python -ArgumentList "-m", "http.server", $port, "--directory", $repo -PassThru -WindowStyle Hidden
Start-Sleep 1.5
try {
  $base = "http://localhost:$port/marketing/reel/cards.html"; $q = { param($s) [uri]::EscapeDataString($s) }
  function Shot($url, $file) { & $chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1080,1920 --default-background-color=00000000 --virtual-time-budget=3000 --screenshot="$file" $url 2>$null | Out-Null }
  foreach ($i in 0..74) { Shot "$base`?card=title&t=$([math]::Round($i/30,4))&line=$(& $q $text.line)" ("$b\title\f{0:D3}.png" -f $i) }
  Shot "$base`?card=end&big=$(& $q $text.big)&sub=$(& $q $text.sub)" "$b\end.png"
  foreach ($k in "02", "03", "04", "05", "06", "07", "08") { Shot "$base`?card=overlay&text=$(& $q $text[$k])" "$b\ov$k.png" }
} finally { Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue }

$enc = @("-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30")
# phone clip → 9:16: trim, speed up, crop a 1920-tall window starting at $y (110 drops the status bar), overlay text
function Clip($name, $src, $start, $dur, $speed, $y, $ov) {
  & $ff -y -loglevel error -ss $start -t $dur -i "$foot\$src" -i "$b\$ov" -filter_complex "[0:v]setpts=(PTS-STARTPTS)/$speed,crop=1080:1920:0:$y,fps=30[v];[v][1:v]overlay=0:0" @enc "$seg\$name.mp4"
}
& $ff -y -loglevel error -framerate 30 -i "$b\title\f%03d.png" @enc "$seg\01.mp4"                      # 2.5 s title
Clip "02"  "02-setup.mp4"           1.5  9.5  3.2 110 "ov02.png"                                         # setup, ~3 s
Clip "03"  "03-demo-squat.mp4"      1.2 11.8  3.0 110 "ov03.png"                                         # squat demo turn
Clip "04"  "04-styles.mp4"          1.5 10.0  3.3 110 "ov04.png"                                         # gym → home → calisthenics
Clip "05"  "05-log-sets.mp4"        1.5  5.5  1.8 110 "ov05.png"                                         # weight hint + sets
Clip "06a" "06-add-video.mp4"   $six[0]  1.5  1.0 480 "ov06.png"                                         # clip loaded (picker cut out)
Clip "06b" "06-add-video.mp4"   $six[1] $six[2] 30.0 480 "ov06.png"                                      # "Analysing… %", 30× speed
Clip "06c" "06-add-video.mp4"   $six[3]  1.5  1.0 480 "ov06.png"                                         # movement result
Clip "06d" "06b-video-demo.mp4"     1.5 11.0  4.0 110 "ov06.png"                                         # the stick-figure demo
Clip "07"  "07-nutrition.mp4"       1.0  8.9  3.0 110 "ov07.png"                                         # macros and meals
Clip "08"  "08-reminder-banner.mp4" 3.5  7.0  2.0 110 "ov08.png"                                         # reminder banner
& $ff -y -loglevel error -loop 1 -framerate 30 -t 3 -i "$b\end.png" -vf "fade=in:st=0:d=0.4,fade=out:st=2.4:d=0.6" @enc "$seg\09.mp4"

$list = Join-Path $seg "list.txt"
"01", "02", "03", "04", "05", "06a", "06b", "06c", "06d", "07", "08", "09" | ForEach-Object { "file '$seg\$_.mp4'".Replace("\", "/") } | Set-Content -Encoding ascii $list
& $ff -y -loglevel error -f concat -safe 0 -i $list -c copy -movflags +faststart $out
Get-Item $out
