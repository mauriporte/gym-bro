# Dale: Instagram reel storyboard

**Format:** 9:16 vertical, 1080×1920, about 27 s. No person on camera: only the app, full screen, on black.
**Look:** the app's own palette (black, warm white, Bodoni headings). Hard cuts on the beat, one slow move in the middle.
**Music:** minimal and low. A deep kick with a muted synth pad, about 100 BPM. No vocals.
**On-screen text:** English in the video, Spanish in the caption (or a second cut with Spanish text).

| # | Time | On screen | Text overlay | Motion |
|---|------|-----------|--------------|--------|
| 1 | 0–2 s | Black. The dumbbell icon draws itself, then "Dale" fades in below it. | *Your trainer. In your pocket.* | Slow fade, first kick on 1.5 s |
| 2 | 2–5 s | Setup: tap "Get stronger", then "Athletic", then 4 days, ending on "Your plan is ready". | *Answer 5 questions.* | Quick cuts, one per beat |
| 3 | 5–9 s | Back squat demo full screen. The camera turns side → 45° → front. | *Every move. Every angle.* | The hero shot. Let it breathe; no cuts |
| 4 | 9–12 s | The three style icons: gym, then home, then calisthenics. The exercise list changes each time. | *Gym. Home. Calisthenics.* | Cut on each tap |
| 5 | 12–15 s | Log sets 1-2-3-4, then the hint "Last 100 kg → today 105 kg". | *Log your sets. It tells you what to change.* | Zoom in on the hint |
| 6 | 15–18 s | Add exercise: pick a video, "Analysing… 64%", then the stick figure appears doing the move. | *Film any exercise. It becomes a demo.* | Match-cut from progress bar to figure |
| 7 | 18–21 s | Nutrition: the calorie and macro tiles, then a recipe opens. | *Calories. Macros. Recipes.* | Numbers count up |
| 8 | 21–24 s | A notification slides down: "No check-in yet. Today's Push session is waiting." | *Skip the gym? It notices.* | Drop on the beat |
| 9 | 24–27 s | End card: the icon and "Dale". | *No ads. No paywall. No excuses.* / *Google Play* | Hold, fade out |

## How to make it

1. **App footage:** record straight from the phone with `adb shell screenrecord` (or the phone's own screen recorder) while tapping through each shot. That gives clean 1080×2400 clips with no person in frame. Crop to 9:16 in the editor.
2. **Hero shot (3):** the exercise sheet's Auto view already turns side → 45° → front over 10 s. Record a full loop and speed it to 4 s.
3. **Text:** Bodoni Moda for headlines and Manrope for small text, the same fonts as the app. White on black, bottom third, no boxes.
4. **Edit:** CapCut or DaVinci Resolve. Cut to the kick, and keep each shot under 3 s except shot 3.

## Caption draft

> Built for people who'd rather lift than scroll. Your trainer, nutritionist and gym buddy in one free app. 3D demos of every exercise, a plan that adapts to you, recipes and a gym reminder. No ads, no account.
>
> Hecha para entrenar, no para scrollear. Tu entrenador, nutricionista y compañero de gimnasio en una app gratis. Demos 3D de cada ejercicio, un plan que se adapta a ti, recetas y recordatorios. Sin anuncios ni cuentas.
>
> #gym #fitness #calisthenics #homeworkout #nutrition #indiedev #android
