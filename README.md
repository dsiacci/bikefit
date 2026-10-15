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

1. Phone on a tripod, landscape, main lens (1×), 1080p at 60 frames per second if you can (on an iPhone: Camera, Formats, Most Compatible).
2. Side view from the drive side, 2 to 3 m away, lens at hip height, square to the bike, phone level.
3. The whole bike and you in the frame, head included: the pose detector finds people by their face.
4. Close-fitting clothes, light in front of you, not behind.
5. About a minute of steady pedalling, seated, easy effort, hands where they usually are.

## How it works

Everything below runs in the page. The experiment scripts call the very same modules ([`web/core/`](web/core)): there is one implementation of the measurement.

### 1. Landmarks, frame by frame

The page seeks through the video one frame at a time (every 1/60 s; repeated frames of slower videos are skipped), hands each frame to Pose Landmarker in video mode, and keeps only the 33 landmarks it returns (x, y, depth, visibility). The frame itself is drawn into the model and dropped. Nothing else about the video is kept.

### 2. The leg nearest to the camera

Seen from the side, the model sometimes swaps the labels of the left and right legs for a few frames. The page follows one leg by continuity (the near foot moves a few pixels per frame; the far foot is a whole crank diameter away), starts again after a gap, and keeps, for each stretch, the leg the model sees better and places nearer the camera.

### 3. Cleaning

Landmarks with visibility below 0.5 are dropped, isolated spikes removed, gaps up to 0.12 s filled, and every coordinate goes through a zero-lag low-pass filter (second-order Butterworth, forward and backward, 6 Hz).

### 4. The crank, found from the feet

The pedal axle is the only point of the foot that moves on a perfect circle around the bottom bracket, and the radius of that circle is the crank length. So the page searches, in the frame of the foot (heel and toe landmarks), for the point whose path is the most circular. Its circle gives the bottom bracket, the crank angle at every frame, and the scale: crank length in millimetres over radius in pixels. The same circle checks the camera: seen from an angle, it turns into an ellipse, and the page warns when it is squeezed by more than 6 % (about 20°).

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

⟦the three checks: sensitivity (saddle raised by one mark on a Zwift Ride), repeatability (same position filmed again), reference (still pose against an inclinometer); all numbers, misses included⟧

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

## Licenses

- **This code:** Apache License 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)).
- **MediaPipe Tasks Vision** 0.10.35 (`@mediapipe/tasks-vision` on npm), the WebAssembly runtime that runs the model: Apache License 2.0, source at [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe). It is pinned before 1.0 on purpose: the npm builds from 1.0.0 on send usage metrics to `odml.pa.googleapis.com` every minute, as Google's [privacy notice](https://goo.gle/mediapipe-privacy) says; 0.10.35 has no such code. The page's Content-Security-Policy would block that host in any case.
- **Pose Landmarker models** (BlazePose GHUM 3D, lite, full and heavy, float16 version 1): Apache License 2.0 according to their [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf). They are downloaded at build time and checked against the SHA-256 in [`tools/assets.json`](tools/assets.json), not stored here. References: Bazarevsky et al., *BlazePose: On-device Real-time Body Pose tracking*, CVPR Workshop on Computer Vision for Augmented and Virtual Reality, 2020 ([arXiv:2006.10204](https://arxiv.org/abs/2006.10204)); *GHUM & GHUML: Generative 3D Human Shape and Articulated Pose Models*, CVPR 2020, pp. 6184–6193.
- **Playwright** 1.63.0 (Apache License 2.0) runs the experiments in headless Chromium. It is not part of the page.
