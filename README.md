# bikefit

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
| Knee angle | between hip–knee and knee–ankle; 180° is a straight leg | at the bottom of the stroke; most extended; most bent |
| Ankle angle | between knee–ankle and ankle–toe | value at the bottom; range of motion over the stroke |
| Hip angle | between shoulder–hip and hip–knee | most closed |
| Trunk angle | hip–shoulder line above the horizontal | median |
| Shoulder angle | between shoulder–hip and shoulder–elbow | median |
| Elbow angle | between shoulder–elbow and elbow–wrist | median |

The page reports the median over clean strokes, the middle half (first to third quartile), and a bootstrap 95 % interval of the median.

### 7. Published ranges

⟦table: measure, range, static or dynamic, source; only ranges we could check⟧

### 8. From degrees to millimetres

With the thigh length T and shank length S measured on the video, the knee angle at the bottom of the stroke follows from the hip–ankle distance d by the law of cosines: cos θ = (T² + S² − d²) / (2TS). The saddle change that brings θ to a target is the change in d, divided by how much d grows when the saddle slides 1 mm up the seat post (sin of the seat-post angle plus the tilt of the hip–ankle line; close to 1 on a normal bike), converted to millimetres with the crank scale.

Assumptions: the ankle keeps the same position at the bottom of the stroke when the saddle moves (riders usually point the foot a little more when the saddle goes up, so the real change in knee angle is smaller); a seat-post angle of 73°; landmarks of the near leg and the crank lie in about the same plane.

## Does it measure anything?

⟦the three checks: sensitivity (saddle raised by one mark on a Zwift Ride), repeatability (same position filmed again), reference (still pose against an inclinometer); all numbers, misses included⟧

## Privacy

- The page loads only its own files: no fonts, scripts, analytics or images from other sites. The Content-Security-Policy of the page forbids them.
- Once the model is in memory, the page adds a second policy, `connect-src 'none'`: from then on the browser refuses every request the page could make (fetch, XHR, WebSocket, beacon), to any address including this site. The page checks that the lock holds and says so in the header.
- The video is read through a local object URL and released at the end. Frames go into the model and are not drawn on screen unless you tick the option to see them.
- The report and the numbers you download contain angles and the summary of the measurement, no picture.

## Limits

- Side view only: nothing about how the knee tracks seen from the front, or about feet and cleats.
- A 2D pose model on a phone video is accurate to a few degrees, not to one degree. ⟦published accuracy of 2D pose models in cycling⟧
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
npx playwright install chromium
node tools/run-headless.mjs --video private/videos/V1.mov --out private/runs/V1 --crank 170 --keypoints
node tools/experiment.mjs private/experiment.json --out docs/results.md
```

Videos, landmarks and measurements of real riders live in `private/`, which git ignores.

## Licenses

⟦code Apache 2.0; @mediapipe/tasks-vision version and license; Pose Landmarker model files and their license; Playwright (development only)⟧
