# Results

Computed by tools/experiment.mjs from runs of the page in headless Chromium.

## Same code, same numbers

- V1: 114 clean strokes of 133, 60.0 frames/s; page result and Node re-run on the saved landmarks the same, to 0.001° at most.
- V2: 76 clean strokes of 92, 60.0 frames/s; page result and Node re-run on the saved landmarks the same, to 0.004° at most.
- V3: 122 clean strokes of 134, 60.0 frames/s; page result and Node re-run on the saved landmarks the same, to 0.001° at most.
- V4: 96 clean strokes of 115, 60.0 frames/s; page result and Node re-run on the saved landmarks the same, to 0.018° at most.

## Repeatability (same position)

| Measure | V1 | V2 | V4 | spread |
|---|---|---|---|---|
| kneeFlexBdc | 42.3 [41.8, 42.5] | 43.0 [42.6, 43.5] | 42.8 [42.2, 43.1] | 0.7 |
| kneeFlexMin | 37.3 [37.0, 37.7] | 35.1 [34.9, 35.6] | 35.8 [35.5, 36.1] | 2.2 |
| kneeFlexMax | 111.1 [110.9, 111.4] | 110.9 [110.6, 111.1] | 112.4 [111.9, 112.8] | 1.5 |
| hipClosed | 51.9 [51.3, 52.7] | 57.0 [56.3, 57.5] | 54.1 [53.6, 54.2] | 5.1 |
| ankleRom | 27.9 [27.1, 28.6] | 27.8 [27.0, 28.7] | 27.9 [26.3, 29.0] | 0.1 |
| ankleBdc | 131.7 [130.9, 132.5] | 127.6 [126.3, 128.7] | 131.9 [130.7, 133.1] | 4.4 |
| trunk | 39.5 [39.3, 40.0] | 43.5 [43.3, 43.7] | 41.5 [40.8, 41.8] | 3.9 |
| shoulder | 81.1 [80.6, 81.4] | 74.3 [73.5, 75.0] | 78.9 [78.4, 79.4] | 6.8 |
| elbowFlex | 24.0 [23.9, 24.3] | 22.2 [21.8, 22.6] | 23.6 [23.1, 23.9] | 1.8 |
| cadence | 98.8 [98.2, 99.6] | 76.3 [74.2, 79.9] | 95.2 [93.5, 96.4] | 22.5 |

Knee bend at the bottom, V2 − V1: 0.7° (95% interval 0.2 to 1.4).

Knee bend at the bottom, V4 − V1: 0.5° (95% interval -0.1 to 1.1).

## Sensitivity (saddle raised)

| Video | Saddle change (tape) | Knee bend change, measured | Knee bend change, predicted | Ankle change at the bottom | Hip moved (video) |
|---|---|---|---|---|---|
| V3 | 10.0 mm | -4.8° [-5.4, -4.3] | -3.4° | -0.9° [-2.1, 0.6] | 12.4 mm |

## Reference (still pose, crank down)

| | Model | Inclinometer | Difference |
|---|---|---|---|
| Thigh below horizontal | 57.7° | 69.0° | -11.3° |
| Shank (from the front) | 89.1° | 77.0° | 12.1° |
| Knee bend | 33.2° | 34.0° | -0.8° |

Knee bend at the bottom, pedalling (median of the baseline strokes) minus still pose: 9.4°.
