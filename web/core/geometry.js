// Plane geometry in image pixels (x to the right, y down) and the leg-triangle
// model that turns knee angles into saddle millimetres.

const DEG = 180 / Math.PI;

export function deg(rad) {
  return rad * DEG;
}

export function rad(degrees) {
  return degrees / DEG;
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Included angle at vertex B of the triangle A-B-C, in degrees (0 to 180).
 * A straight knee (hip, knee, ankle aligned) is 180.
 */
export function includedAngle(ax, ay, bx, by, cx, cy) {
  const ux = ax - bx, uy = ay - by, vx = cx - bx, vy = cy - by;
  if (!(Math.hypot(ux, uy) > 0 && Math.hypot(vx, vy) > 0)) return NaN;
  // atan2 of cross and dot products stays accurate near 0 and 180 degrees.
  return deg(Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy));
}

/**
 * Angle between two direction vectors, in degrees (0 to 180).
 */
export function angleBetween(ux, uy, vx, vy) {
  return includedAngle(ux, uy, 0, 0, vx, vy);
}

/**
 * Inclination of the segment from (ax, ay) to (bx, by) above the horizontal,
 * in degrees, measured towards the rider's front. `facing` is +1 when the
 * rider faces the right of the image, -1 when facing left. 90 is vertical.
 */
export function inclination(ax, ay, bx, by, facing) {
  return deg(Math.atan2(ay - by, facing * (bx - ax)));
}

/**
 * Knee angle (degrees) of a leg with thigh T and shank S whose hip and ankle are
 * d apart: the law of cosines. Lengths in any common unit.
 */
export function kneeAngleFromDistance(T, S, d) {
  const c = (T * T + S * S - d * d) / (2 * T * S);
  if (c > 1 || c < -1) return NaN;
  return deg(Math.acos(c));
}

/** Hip-to-ankle distance that gives a knee angle of `angleDeg` (law of cosines). */
export function distanceFromKneeAngle(T, S, angleDeg) {
  return Math.sqrt(T * T + S * S - 2 * T * S * Math.cos(rad(angleDeg)));
}

/**
 * How far the hip moves away from the ankle at the bottom of the stroke when the
 * saddle slides by 1 along the seat post. The seat post is tilted `seatAngleDeg`
 * above the horizontal (pointing up and back); `hipToAnkleDeg` is the angle of
 * the ankle-to-hip line from the vertical, positive when the hip is behind the
 * ankle. The factor is sin(seat + line); it stays close to 1 on a normal bike.
 */
export function saddleProjection(seatAngleDeg, hipToAnkleDeg) {
  return Math.sin(rad(seatAngleDeg + hipToAnkleDeg));
}

/**
 * Knee angle change expected from moving the saddle by `deltaSaddle` along the
 * seat post, if the ankle keeps the same position at the bottom of the stroke.
 * Everything in the same length unit as T, S and d.
 */
export function predictKneeChange({ T, S, d, deltaSaddle, projection = 1 }) {
  const before = kneeAngleFromDistance(T, S, d);
  const after = kneeAngleFromDistance(T, S, d + deltaSaddle * projection);
  return after - before;
}

/**
 * Saddle movement along the seat post that brings the knee angle at the bottom
 * of the stroke from `currentDeg` to `targetDeg`, with the same leg triangle.
 * Positive means raise the saddle.
 */
export function saddleChangeForKneeAngle({ T, S, currentDeg, targetDeg, projection = 1 }) {
  const dNow = distanceFromKneeAngle(T, S, currentDeg);
  const dTarget = distanceFromKneeAngle(T, S, targetDeg);
  return (dTarget - dNow) / projection;
}
