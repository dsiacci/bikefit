// Published reference ranges, in the conventions of their sources. Every entry
// names its source and the kind of evidence behind it. Only the peer-reviewed
// ranges get a verdict on the page; book and manufacturer figures are shown as
// context, labelled as such. These are ranges for groups of riders, not targets
// for one person.

const MILLOUR_2019 = {
  short: 'Millour et al. 2019',
  cite: 'Millour G, Duc S, Puel F, Bertucci W (2019). Comparison of static and dynamic methods based on knee kinematics to determine optimal saddle height in cycling. Acta of Bioengineering and Biomechanics 21(4):93–99.',
  url: 'https://doi.org/10.37190/ABB-01428-2019-02',
};
const SWART_HOLLIDAY_2019 = {
  short: 'Swart & Holliday 2019',
  cite: 'Swart J, Holliday W (2019). Cycling Biomechanics Optimization—the (R) Evolution of Bicycle Fitting. Current Sports Medicine Reports 18(12):490–496.',
  url: 'https://doi.org/10.1249/JSR.0000000000000665',
};
const FERRER_ROCA_2012 = {
  short: 'Ferrer-Roca et al. 2012',
  cite: 'Ferrer-Roca V, Roig A, Galilea P, García-López J (2012). Influence of saddle height on lower limb kinematics in well-trained cyclists: static vs. dynamic evaluation in bike fitting. Journal of Strength and Conditioning Research 26(11):3025–3029.',
  url: 'https://doi.org/10.1519/JSC.0b013e318245c09d',
};
const RETUL_VIA_SCOZ_2021 = {
  short: 'Retül ranges, in Scoz et al. 2021',
  cite: 'Manufacturer ranges of the Retül 3D system, as printed in: Scoz RD, Amorim CF, Espindola T, et al. (2021). Discomfort, pain and fatigue levels of 160 cyclists after a kinematic bike-fitting method: an experimental study. BMJ Open Sport & Exercise Medicine 7(3):e001096.',
  url: 'https://doi.org/10.1136/bmjsem-2021-001096',
};
const BURT_VIA_HOLLIDAY_SWART_2021 = {
  short: 'Burt 2014, in Holliday & Swart 2021',
  cite: 'Phil Burt, Bike Fit (Bloomsbury, 2014), as reported in: Holliday W, Swart J (2021). Anthropometrics, flexibility and training history as determinants for bicycle configuration. Sports Medicine and Health Science 3(2):93–100.',
  url: 'https://doi.org/10.1016/j.smhs.2021.02.007',
};

export const RANGES = [
  {
    metric: 'kneeFlexBdc', low: 33, high: 43, kind: 'dynamic', evidence: 'peer-reviewed', useForSaddle: true,
    source: { ...MILLOUR_2019, short: 'Millour et al. 2019; Swart & Holliday 2019', also: SWART_HOLLIDAY_2019 },
    note: 'Pedalling at low intensity, crank straight down, 2D video with skin markers.',
  },
  {
    metric: 'kneeFlexMin', low: 30, high: 40, kind: 'dynamic', evidence: 'peer-reviewed',
    source: FERRER_ROCA_2012,
    note: 'Pedalling, leg at its most extended (crank about in line with the seat tube), 2D video.',
  },
  { metric: 'kneeFlexMax', low: 107, high: 113, kind: 'dynamic', evidence: 'manufacturer', source: RETUL_VIA_SCOZ_2021 },
  { metric: 'hipClosed', low: 66, high: 76, kind: 'dynamic', evidence: 'manufacturer', source: RETUL_VIA_SCOZ_2021 },
  {
    metric: 'ankleRom', low: 20, high: 30, kind: 'dynamic', evidence: 'manufacturer', source: RETUL_VIA_SCOZ_2021,
    note: 'The pose model is least reliable at the ankle (Bini et al. 2024).',
  },
  {
    metric: 'trunk', low: 45, high: 55, kind: 'static', evidence: 'book', source: BURT_VIA_HOLLIDAY_SWART_2021,
    note: 'Recreational riders, hands on the hoods.',
  },
  { metric: 'shoulder', low: 60, high: 70, kind: 'dynamic', evidence: 'manufacturer', source: RETUL_VIA_SCOZ_2021 },
  {
    metric: 'elbowFlex', low: 20, high: 30, kind: 'static', evidence: 'book', source: BURT_VIA_HOLLIDAY_SWART_2021,
    note: 'Hands on the hoods.',
  },
];

/** Static range used by the reference experiment (still pose, crank down). */
export const HOLMES_STATIC = {
  metric: 'kneeFlexStill', low: 25, high: 35, kind: 'static', evidence: 'peer-reviewed',
  source: {
    short: 'Holmes et al. 1994, in Bini et al. 2011',
    cite: 'Holmes JC, Pruitt AL, Whalen NJ (1994). Lower extremity overuse in bicycling. Clinics in Sports Medicine 13(1):187–205; method as described in Bini R, Hume PA, Croft JL (2011). Effects of bicycle saddle height on knee injury risk and cycling performance. Sports Medicine 41(6):463–476.',
    url: 'https://doi.org/10.2165/11588740-000000000-00000',
  },
};

/**
 * Compare a summary ({median, q1, q3, n}) with a range {metric, low, high}.
 * The verdict uses the median: below, within or above.
 */
export function compareToRange(range, summary) {
  if (!summary || !Number.isFinite(summary.median)) return null;
  const m = summary.median;
  const verdict = m < range.low ? 'below' : m > range.high ? 'above' : 'within';
  return {
    metric: range.metric, low: range.low, high: range.high, median: m, verdict,
    kind: range.kind, evidence: range.evidence ?? 'peer-reviewed', source: range.source, note: range.note ?? null,
  };
}
