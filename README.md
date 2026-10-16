# Saddle Check

Bike fit angles from a side-view phone video, measured in the browser. You drop a video of yourself pedalling; an open-weight pose model ([MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)) runs inside the page and finds your joints in every frame; the page measures your knee, hip, ankle, trunk, shoulder and elbow angles at every pedal stroke, compares the medians with published ranges, and turns the knee angle into a saddle change in millimetres.

The video never leaves your device. The page and the model are static files; once the model is loaded, the page locks its own network access (see [Privacy](#privacy)).

⟦live page URL⟧

## Use it

Online: ⟦URL⟧. Locally:

```sh
npm ci
npm run build   # copies the MediaPipe runtime, downloads the models, checks their SHA-256
npm run serve   # http://127.0.0.1:8080
```

### How to film

The page shows this checklist too (How to film).

1. Phone on a tripod, landscape, main lens (1×), 1080p at 60 frames per second if you can (on an iPhone: Settings › Camera › Formats › Most Compatible).
2. Square to the bike, from the drive side, 2 to 3 m away, lens at hip height, phone level.
3. The whole bike and you in the frame, head included: the pose detector finds people by their face.
4. Shoes clipped in: the pedal axle gives the scale in millimetres. With flat pedals you still get the angles.
5. Light in front of you, not behind, and close-fitting clothes.
6. About a minute of steady pedalling, seated, easy effort, hands where they usually are.
7. Your crank length: it is printed on the inside of the crank arm.

## How it works

Everything below runs in the page. The experiment scripts call the very same modules ([`web/core/`](web/core)): there is one implementation of the measurement.

### 1. Landmarks, frame by frame

The page seeks through the video one frame at a time (every 1/60 s; repeated frames of slower videos are skipped), hands each frame to Pose Landmarker in video mode, and keeps only the 33 landmarks it returns (x, y, depth, visibility). The frame itself is drawn into the model and dropped. Nothing else about the video is kept.

### 2. The leg nearest to the camera

Seen from the side, the model sometimes swaps the labels of the left and right legs for a few frames. The page follows one leg by continuity (the near foot moves a few pixels per frame; the far foot is a whole crank diameter away), starts again after a gap, and keeps, for each stretch, the leg the model sees better and places nearer the camera.

### 3. Cleaning

Landmarks with visibility below 0.5 are dropped, isolated spikes removed, gaps up to 0.12 s filled, and every coordinate goes through a zero-lag low-pass filter (second-order Butterworth, forward and backward, 6 Hz).

### 4. The crank, found from the feet

The pedal axle is the only point of the foot that moves on a perfect circle around the bottom bracket, and the radius of that circle is the crank length. So the page searches, in the frame of the foot (heel and toe landmarks), for the point whose path is the most circular. Its circle gives the bottom bracket, the crank angle at every frame, and the scale: crank length in millimetres over radius in pixels. On real videos the foot landmarks scatter around that circle by about a tenth of its radius, so the page judges the path in two steps: fitted on every frame, it must stay within 15 % of the radius; averaged per crank angle (36 bins of 10°, over dozens of strokes), it must fit a circle within 12 %. Averaging removes random scatter but keeps the shape of a path that really is not a circle: a synthetic foot sliding 70 mm on the pedal gives 14 % and is refused, our real videos with cleats gave 6 to 11 %. The radius and the bottom bracket come from the averaged loop; on synthetic riders its radius stays within 4 % of the truth even with that sliding foot. When the scatter is large, the page warns that the millimetres are approximate, to within about 10 %. When the path fails either test (a sneaker sliding on a spin bike gave 21 % on every frame), the strokes are cut on the loop of the ankle and no millimetres are given. The camera angle is checked with the thigh instead: it keeps its length whatever its angle, and a camera turned away from square shortens it more when it is near horizontal than when it is steep. The page warns above a turn of about 20°.

### 5. Pedal strokes

The longest stretch of steady pedalling is found from the periodicity of the ankle. Strokes run from one top dead centre (crank straight up) to the next; the bottom of the stroke is the crank straight down. Strokes whose duration is more than 20 % away from the median, with missing landmarks, or whose feet leave the circle are set aside.

### 6. The angles

| Measure | Definition (near side, in the image plane) | Per stroke |
|---|---|---|
| Knee bend | 180° minus the angle between hip–knee and knee–ankle; 0° is a straight leg | at the bottom of the stroke (crank straight down); leg most extended; leg most bent |
| Ankle | angle between knee–ankle and ankle–toe | range of motion over the stroke; value at the bottom |
| Hip | angle between shoulder–hip and hip–knee | most closed |
| Trunk | hip–shoulder line above the horizontal | median |
| Shoulder | angle between shoulder–hip and shoulder–elbow | median |
| Elbow bend | 180° minus the angle between shoulder–elbow and elbow–wrist | median |

The page reports the median over clean strokes, the middle half (first to third quartile), and a bootstrap 95 % interval of the median.

### 7. Published ranges

| Measure | Range | Measured | Evidence | Source |
|---|---|---|---|---|
| Knee bend at the bottom of the stroke | 33–43° | pedalling, low intensity, 2D video with skin markers | peer-reviewed | [Millour et al. 2019](https://doi.org/10.37190/ABB-01428-2019-02); [Swart & Holliday 2019](https://doi.org/10.1249/JSR.0000000000000665) |
| Knee bend, leg most extended | 30–40° | pedalling, 2D video | peer-reviewed | [Ferrer-Roca et al. 2012](https://doi.org/10.1519/JSC.0b013e318245c09d) |
| Knee bend, leg most bent | 107–113° | pedalling, 3D system | manufacturer | Retül ranges printed in [Scoz et al. 2021](https://doi.org/10.1136/bmjsem-2021-001096) |
| Hip, most closed | 66–76° | pedalling, 3D system | manufacturer | Retül, in Scoz et al. 2021 |
| Ankle range of motion | 20–30° | pedalling, 3D system | manufacturer | Retül, in Scoz et al. 2021 |
| Trunk above horizontal | 45–55° | static, recreational riders, hands on the hoods | book | Phil Burt, *Bike Fit* (2014), reported in [Holliday & Swart 2021](https://doi.org/10.1016/j.smhs.2021.02.007) |
| Shoulder | 60–70° | pedalling, 3D system | manufacturer | Retül, in Scoz et al. 2021 |
| Elbow bend | 20–30° | static, hands on the hoods | book | Burt 2014, in Holliday & Swart 2021 |

The best-known number, 25–35° of knee bend (Holmes, Pruitt & Whalen 1994), is a static measure: the rider stops with the crank at the bottom and a fitter uses a goniometer. Pedalling bends the knee about 8° more at the same crank position ([Millour et al. 2019](https://doi.org/10.37190/ABB-01428-2019-02); [Bini & Hume 2016](https://doi.org/10.1515/humo-2016-0005)), and 33–43° is the static range plus those 8°. The page measures while you pedal, so it uses 33–43°, and that is the range the saddle change aims for.

Only the two knee ranges come from peer-reviewed measurements. For the other joints, Swart & Holliday write that they "have not been investigated to any meaningful extent", and Scoz et al. that "there is little scientific information on joint angular reference values". The page shows the book and manufacturer figures for context, labelled as guidelines, and gives a verdict only against the knee ranges.

### 8. From degrees to millimetres

With the thigh length T and shank length S measured on the video, the knee angle at the bottom of the stroke follows from the hip–ankle distance d by the law of cosines: cos θ = (T² + S² − d²) / (2TS). The saddle change that brings θ to a target is the change in d, divided by how much d grows when the saddle slides 1 mm up the seat post (sin of the seat-post angle plus the tilt of the hip–ankle line; close to 1 on a normal bike), converted to millimetres with the crank scale.

Assumptions: the ankle keeps the same position at the bottom of the stroke when the saddle moves (riders usually point the foot a little more when the saddle goes up, so the real change in knee angle is smaller); a seat-post angle of 73°; landmarks of the near leg and the crank lie in about the same plane.

## Does it measure anything?

One rider (the author), a Zwift Ride V1 home trainer with its 170 mm cranks and cleat pedals, an iPhone 13 Pro Max on a tripod two to three metres away on the drive side, 1080p at 60 frames per second, tripod and bike taped to the floor, a window behind the bike. Five videos: V1, V2 (after getting off and back on) and V4 (saddle set back to its starting letter) at the same height; V3 one saddle letter higher, 10 mm measured with a tape; S, a still pose with the crank down, checked with an inclinometer (the level of the iPhone Measure app held along the thigh, then the shank, read by the rider alone on the bike). Every number comes from the page itself in headless Chromium (`tools/run-headless.mjs`, measuring code of commit d2e0a21) and from `tools/experiment.mjs` on what it saved. The full output is in [docs/results.md](docs/results.md). One rider and one bike: this checks the page, not the published ranges.

| Video | Saddle | Knee bend at the bottom (median, 95 % interval) | Clean strokes |
|---|---|---|---|
| V1 | start | 42.3° (41.8 to 42.5) | 114 of 133 |
| V2 | start | 43.0° (42.6 to 43.5) | 76 of 92 |
| V4 | start | 42.8° (42.2 to 43.1) | 96 of 115 |
| V3 | +10 mm | 37.9° (37.3 to 38.2) | 122 of 134 |

**Repeatability.** 0.7° between the lowest and the highest of the three videos at the same saddle height. The other angles moved more between takes, because the rider did: trunk 39.5 to 43.5°, cadence 76 to 99 rpm.

**Sensitivity.** One saddle letter higher, the knee bend at the bottom drops by 4.8° (95 % interval 4.3 to 5.4). The leg triangle predicted 3.4°. The ankle angle at the bottom did not change clearly (−0.9°, interval −2.1 to +0.6), and the hip moved 12.4 mm in the picture for a 10 mm saddle change: the rider may have sat a little differently, or the scale is a few percent off; these videos cannot tell.

**The suggestion.** On the three starting videos, the page suggested raising the saddle by about 11 mm (1.1 letters) to reach 38°, the middle of the range. V3, one letter higher, measured 37.9°.

**Reference.** Still, crank down: a knee bend of 33.2° from the model, 34.0° from the inclinometer. Taken one by one, the thigh and the shank differ by 11.3° and 12.1°, turned the same way, which cancels out in the knee angle: one of the two references was tilted by about 12°, the inclinometer readings or the camera's horizon. Pedalling bends the knee 9.4° more than the still pose, close to the 8° of [Millour et al. 2019](https://doi.org/10.37190/ABB-01428-2019-02).

**Misses.** On the first runs, the pedal axle threshold, set on synthetic riders (residual under 2 %), refused these real videos (11 to 14 % against 8 %), and the page fell back on the ankle loop, which placed the bottom of the stroke badly: knee at 39° instead of 42°. The crank circle now comes from the pedal path averaged per crank angle ([section 4](#4-the-crank-found-from-the-feet)). The crank radius found still varies by 5 % between the four pedalling videos (112.9 to 118.5 px), hence millimetres given to within 10 %; the angles do not depend on the scale.

## Privacy

- The page loads only its own files: no fonts, scripts, analytics or images from other sites. The Content-Security-Policy of the page forbids them. The pose runtime is pinned to a version without usage metrics (see [Licenses](#licenses)).
- Once the model is in memory, the page adds a second policy, `connect-src 'none'`: from then on the browser refuses every request the page could make (fetch, XHR, WebSocket, beacon), to any address including this site. The page checks that the lock holds and says so in the header.
- The video is read through a local object URL and released at the end. Frames go into the model and are not drawn on screen unless you tick the option to see them.
- The report and the numbers you download contain angles and the summary of the measurement, no picture.

## Limits

- Side view only: nothing about how the knee tracks seen from the front, or about feet and cleats.
- A 2D pose model on a phone video is accurate to a few degrees, not to one degree. The only study of MediaPipe in cycling we found ([Bini, Nascimento & Nibali 2024](https://doi.org/10.1007/s11332-023-01075-7): 26 riders on a stationary bike, a camera at saddle height 4 m away, 30 frames per second at 640×480, the Heavy model) reports typical errors of 3 to 6° at the knee and the hip against skin markers, with the knee read as more bent around the bottom of the stroke, and a poor match at the ankle (r = 0.25). Treat the ankle numbers with care. [Fonda et al. 2014](https://doi.org/10.1080/02640414.2013.868919) found that 2D video underestimates the knee angle at the bottom of the stroke compared with 3D motion capture, and suggest adding 2.2° to 2D values.
- Riders often point the foot more when the saddle goes up, which hides part of the change at the knee; several saddle-height studies report it (for example [Ferrer-Roca et al. 2014](https://doi.org/10.1519/JSC.0b013e3182a1f1a9)).
- Published ranges describe groups of riders. They are a starting point, not a target for one person.
- The result is valid for the bike in the video, set up as it was.
- This is not medical advice. If something hurts, see a professional.

## Tests and experiments

```sh
npm test
```

The tests run the whole measurement on a synthetic rider (a planar leg on a crank, a foot that tilts through the stroke) with known angles: noise, label swaps, missing frames, getting on and off the bike, a rider facing left, a saddle raised by 10 mm, a still pose.

The checks of [Does it measure anything?](#does-it-measure-anything) come from the page itself, run in headless Chromium:

```sh
npm install --no-save playwright@1.63.0
npx playwright install --with-deps --only-shell chromium
node tools/run-headless.mjs --video private/videos/V1.mov --out private/runs/V1 --crank 170 --keypoints
node tools/experiment.mjs private/experiment.json --out docs/results.md
```

Videos, landmarks and measurements of real riders live in `private/`, which git ignores.

The demo video is recorded from the page the same way, with the synthetic rider, so no real person appears: titles, highlights and a cursor are drawn over the page ([`tools/demo/`](tools/demo/)), and each scene is paced on its voice-over clip, one MP3 per scene of [`tools/demo/scenes.json`](tools/demo/scenes.json). It needs ffmpeg:

```sh
node tools/demo.mjs --out private/demo --voice private/demo/voice
```

## Licenses

- **This code:** Apache License 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)).
- **MediaPipe Tasks Vision** 0.10.35 (`@mediapipe/tasks-vision` on npm), the WebAssembly runtime that runs the model: Apache License 2.0, source at [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe). It is pinned before 1.0 on purpose: the npm builds from 1.0.0 on send usage metrics to `odml.pa.googleapis.com` every minute, as Google's [privacy notice](https://goo.gle/mediapipe-privacy) says; 0.10.35 has no such code. The page's Content-Security-Policy would block that host in any case.
- **Pose Landmarker models** (BlazePose GHUM 3D, lite, full and heavy, float16 version 1): Apache License 2.0 according to their [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf). They are downloaded at build time and checked against the SHA-256 in [`tools/assets.json`](tools/assets.json), not stored here. References: Bazarevsky et al., *BlazePose: On-device Real-time Body Pose tracking*, CVPR Workshop on Computer Vision for Augmented and Virtual Reality, 2020 ([arXiv:2006.10204](https://arxiv.org/abs/2006.10204)); *GHUM & GHUML: Generative 3D Human Shape and Articulated Pose Models*, CVPR 2020, pp. 6184–6193.
- **Barlow** and **Barlow Condensed**, the fonts of the page (The Barlow Project Authors): SIL Open Font License 1.1 ([`web/fonts/OFL.txt`](web/fonts/OFL.txt)), served by the page itself.
- **Playwright** 1.63.0 (Apache License 2.0) runs the experiments and records the demo in headless Chromium. It is not part of the page.
