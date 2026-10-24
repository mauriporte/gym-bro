# Dale: Gym Coach

A personal-trainer app in English and Spanish. Black and white, no clutter.

- **First-run setup:** goal, build, experience, training style, days and body stats lead to your plan. Redo it any time from My plan.
- **Exercises:** 30 movements with 3D demos. Each demo is a 10-second loop that turns from side view to 45° to front view.
- **Three training styles:** gym with full equipment, home with dumbbells, or calisthenics (bodyweight, pull-up bar and dip bars). Every plan and exercise list follows the style you pick.
- **Your own exercises:** describe one or record a video of it. Dale compares it with the known exercises (keyword matching, or MediaPipe pose tracking on the video) to place it in a movement group. You can use it in your plan.
- **Plan builder:** five trainer profiles plus build, goal, experience and days per week. Each exercise reads "4 sets of 8–12 reps", with − / + buttons for sets and reps that the app remembers.
- **Coach:** log weights and rate sessions. Next session's load goes up after you complete every set. The coach suggests a lighter week, fewer days, a level-up or a new block, based on your last two weeks.
- **Nutrition:** calorie and macro targets (Mifflin-St Jeor equation), adjusted for training and rest days. Includes daily meals with full recipes, top-ups that close the macro gap, and a 7-day grocery list.
- **Tracking:** log sets, check in, see your streak and a 16-week attendance calendar.
- **Reminders:** on Android, a notification is scheduled for each training day and cancelled once you check in. The app also checks you in automatically if you open it within 150 m of your saved gym.

## Install the APK

Every push to `main` builds a signed release APK in GitHub Actions and publishes it to the **latest** release.
Download `Dale.apk` from that release on your phone, then allow your browser to install unknown apps.
Every build is signed with the same key, so a new build installs over the old one and keeps your data.

Signing needs two repository secrets: `DALE_KEYSTORE_B64` (the base64-encoded PKCS12 keystore, alias `dale`) and `DALE_KEYSTORE_PASSWORD`.
The keystore lives outside git. Back it up: if it's lost, future builds can't update an installed copy.

## Develop

The app is plain HTML, CSS and JS in `www/`, with no bundler.

```bash
python -m http.server 8080 --directory www
```

Android shell (needs JDK 21 and the Android SDK):

```bash
npm ci
npx cap sync android
cd android && ./gradlew assembleDebug
```

Data is stored on the device (`localStorage`) and isn't synced anywhere.
