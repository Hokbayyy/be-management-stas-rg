const DEFAULT_GPS_MAX_ACCURACY_METERS = 150;
const DEFAULT_GPS_MAX_ACCURACY_ALLOWANCE_METERS = 80;
const DEFAULT_GPS_RADIUS_METERS = 80;
const DEFAULT_GPS_SAMPLE_COUNT = 2;
const DEFAULT_GPS_TIMEOUT_MS = 10000;

const MIN_GPS_RADIUS_METERS = 5;
const MAX_GPS_RADIUS_METERS = 500;
const MIN_GPS_MAX_ACCURACY_METERS = 30;
const MAX_GPS_MAX_ACCURACY_METERS = 500;
const MIN_GPS_SAMPLE_COUNT = 1;
const MAX_GPS_SAMPLE_COUNT = 5;
const MIN_GPS_TIMEOUT_MS = 3000;
const MAX_GPS_TIMEOUT_MS = 30000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const partA =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const partC = 2 * Math.atan2(Math.sqrt(partA), Math.sqrt(1 - partA));

  return earthRadius * partC;
}

function parseGpsNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && !value.trim()) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function isNonZeroCoordinatePair(latitude, longitude) {
  return isValidLatitude(latitude) && isValidLongitude(longitude) && !(latitude === 0 && longitude === 0);
}

function clampFiniteNumber(value, fallback, min, max) {
  const parsed = parseGpsNumber(value);
  if (parsed == null) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function buildGpsPolicy(settings = {}) {
  const gps = settings.gps || {};

  const targetLatitude = parseGpsNumber(gps.latitude);
  const targetLongitude = parseGpsNumber(gps.longitude);
  const radiusMeters = clampFiniteNumber(
    gps.radius,
    DEFAULT_GPS_RADIUS_METERS,
    MIN_GPS_RADIUS_METERS,
    MAX_GPS_RADIUS_METERS
  );
  const maxAccuracyMeters = clampFiniteNumber(
    gps.maxAccuracyMeters,
    DEFAULT_GPS_MAX_ACCURACY_METERS,
    MIN_GPS_MAX_ACCURACY_METERS,
    MAX_GPS_MAX_ACCURACY_METERS
  );
  const maxAccuracyAllowanceMeters = clampFiniteNumber(
    gps.maxAccuracyAllowanceMeters,
    DEFAULT_GPS_MAX_ACCURACY_ALLOWANCE_METERS,
    0,
    Math.min(maxAccuracyMeters, DEFAULT_GPS_MAX_ACCURACY_ALLOWANCE_METERS)
  );
  const sampleCount = Math.round(
    clampFiniteNumber(
      gps.sampleCount,
      DEFAULT_GPS_SAMPLE_COUNT,
      MIN_GPS_SAMPLE_COUNT,
      MAX_GPS_SAMPLE_COUNT
    )
  );
  const timeoutMs = Math.round(
    clampFiniteNumber(
      gps.timeoutMs,
      DEFAULT_GPS_TIMEOUT_MS,
      MIN_GPS_TIMEOUT_MS,
      MAX_GPS_TIMEOUT_MS
    )
  );

  return {
    targetLatitude: targetLatitude == null ? NaN : targetLatitude,
    targetLongitude: targetLongitude == null ? NaN : targetLongitude,
    radiusMeters,
    maxAccuracyMeters,
    maxAccuracyAllowanceMeters,
    sampleCount,
    timeoutMs
  };
}

function buildGpsValidationError({
  message,
  reason,
  accuracyMeters = null,
  maxAccuracyMeters = null,
  distanceMeters = null,
  allowedRadiusMeters = null,
  accuracyAllowanceMeters = null,
  effectiveAllowedRadiusMeters = null
}) {
  return {
    message,
    reason,
    accuracyMeters,
    maxAccuracyMeters,
    distanceMeters,
    allowedRadiusMeters,
    accuracyAllowanceMeters,
    effectiveAllowedRadiusMeters
  };
}

/**
 * Evaluate reported GPS position against lab reference coordinate, max accuracy,
 * and radius plus bounded device accuracy uncertainty.
 */
function evaluateAttendanceGps({
  userLatitude,
  userLongitude,
  accuracyMeters,
  gpsPolicy,
  actionLabel = "absensi"
}) {
  const refLat = gpsPolicy?.targetLatitude;
  const refLng = gpsPolicy?.targetLongitude;
  const refRadius = gpsPolicy?.radiusMeters;
  const maxAccuracyMeters = gpsPolicy?.maxAccuracyMeters;
  const maxAllowance = Number.isFinite(gpsPolicy?.maxAccuracyAllowanceMeters)
    ? gpsPolicy.maxAccuracyAllowanceMeters
    : DEFAULT_GPS_MAX_ACCURACY_ALLOWANCE_METERS;

  if (
    !isValidLatitude(refLat) ||
    !isValidLongitude(refLng) ||
    !Number.isFinite(refRadius) ||
    refRadius <= 0
  ) {
    return {
      ok: false,
      statusCode: 500,
      errorBody: buildGpsValidationError({
        message: "Koordinat titik absensi belum dikonfigurasi. Hubungi operator.",
        reason: "GPS_NOT_CONFIGURED",
        accuracyMeters: accuracyMeters == null ? null : Math.round(accuracyMeters),
        maxAccuracyMeters: Number.isFinite(maxAccuracyMeters) ? maxAccuracyMeters : null,
        allowedRadiusMeters: Number.isFinite(refRadius) ? refRadius : null
      })
    };
  }

  const distanceMeters = haversineDistanceMeters(userLatitude, userLongitude, refLat, refLng);
  const roundedAccuracy = accuracyMeters == null ? null : Math.round(accuracyMeters);
  const roundedDistance = Math.round(distanceMeters);

  if (accuracyMeters != null && Number.isFinite(maxAccuracyMeters) && accuracyMeters > maxAccuracyMeters) {
    const accuracyMessage =
      actionLabel === "checkout"
        ? `Akurasi GPS terlalu rendah untuk checkout (${roundedAccuracy}m > batas ${Math.round(maxAccuracyMeters)}m). Coba pindah ke area lebih terbuka atau aktifkan mode akurasi tinggi.`
        : `Akurasi GPS terlalu rendah (${roundedAccuracy}m > batas ${Math.round(maxAccuracyMeters)}m). Coba pindah ke area lebih terbuka atau aktifkan mode akurasi tinggi.`;

    return {
      ok: false,
      statusCode: 400,
      errorBody: buildGpsValidationError({
        message: accuracyMessage,
        reason: "GPS_ACCURACY_TOO_LOW",
        accuracyMeters: roundedAccuracy,
        maxAccuracyMeters,
        distanceMeters: roundedDistance,
        allowedRadiusMeters: refRadius
      })
    };
  }

  // Indoor Wi-Fi/A-GPS uncertainty causes reported coordinates to drift within reported accuracy.
  // Allow bounded uncertainty on top of configured radius so valid indoor devices are not rejected.
  const accuracyAllowanceMeters =
    accuracyMeters != null && Number.isFinite(accuracyMeters) && accuracyMeters > 0
      ? Math.min(accuracyMeters, maxAllowance)
      : 0;
  const effectiveAllowedRadiusMeters = refRadius + accuracyAllowanceMeters;
  const roundedAllowance = Math.round(accuracyAllowanceMeters);
  const roundedEffectiveRadius = Math.round(effectiveAllowedRadiusMeters);

  if (distanceMeters > effectiveAllowedRadiusMeters) {
    const radiusPrefix =
      actionLabel === "checkout"
        ? "Lokasi checkout di luar radius absensi"
        : "Lokasi di luar radius absensi";
    const radiusDetail =
      roundedAllowance > 0
        ? ` (${roundedDistance}m dari titik lab; batas ${Math.round(refRadius)}m + toleransi GPS ${roundedAllowance}m).`
        : ` (${roundedDistance}m dari titik lab; batas ${Math.round(refRadius)}m).`;

    return {
      ok: false,
      statusCode: 400,
      errorBody: buildGpsValidationError({
        message: `${radiusPrefix}${radiusDetail}`,
        reason: "OUTSIDE_RADIUS",
        accuracyMeters: roundedAccuracy,
        maxAccuracyMeters,
        distanceMeters: roundedDistance,
        allowedRadiusMeters: refRadius,
        accuracyAllowanceMeters: roundedAllowance,
        effectiveAllowedRadiusMeters: roundedEffectiveRadius
      })
    };
  }

  return {
    ok: true,
    distanceMeters,
    roundedDistanceMeters: roundedDistance,
    accuracyMeters: roundedAccuracy,
    maxAccuracyMeters,
    allowedRadiusMeters: refRadius,
    accuracyAllowanceMeters: roundedAllowance,
    effectiveAllowedRadiusMeters: roundedEffectiveRadius
  };
}

/**
 * Validate and sanitize partial GPS settings update without dropping unspecified keys.
 */
function sanitizeGpsSettingsPatch(rawPatch, fallbackGps = {}) {
  if (!rawPatch || typeof rawPatch !== "object" || Array.isArray(rawPatch)) {
    return { valid: false, message: "Format pengaturan GPS tidak valid." };
  }

  const nextGps = { ...fallbackGps };
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  if (hasOwn(rawPatch, "latitude") || hasOwn(rawPatch, "longitude")) {
    const nextLat = hasOwn(rawPatch, "latitude")
      ? parseGpsNumber(rawPatch.latitude)
      : parseGpsNumber(nextGps.latitude);
    const nextLng = hasOwn(rawPatch, "longitude")
      ? parseGpsNumber(rawPatch.longitude)
      : parseGpsNumber(nextGps.longitude);

    if (!isNonZeroCoordinatePair(nextLat, nextLng)) {
      return {
        valid: false,
        message: "Koordinat GPS tidak valid. Latitude (-90..90) dan Longitude (-180..180) wajib diisi dengan benar."
      };
    }

    nextGps.latitude = nextLat;
    nextGps.longitude = nextLng;
  }

  if (hasOwn(rawPatch, "radius")) {
    const radius = parseGpsNumber(rawPatch.radius);
    if (radius == null || radius < MIN_GPS_RADIUS_METERS || radius > MAX_GPS_RADIUS_METERS) {
      return {
        valid: false,
        message: `Radius absensi harus antara ${MIN_GPS_RADIUS_METERS} hingga ${MAX_GPS_RADIUS_METERS} meter.`
      };
    }
    nextGps.radius = Math.round(radius);
  }

  if (hasOwn(rawPatch, "maxAccuracyMeters")) {
    const maxAccuracy = parseGpsNumber(rawPatch.maxAccuracyMeters);
    if (
      maxAccuracy == null ||
      maxAccuracy < MIN_GPS_MAX_ACCURACY_METERS ||
      maxAccuracy > MAX_GPS_MAX_ACCURACY_METERS
    ) {
      return {
        valid: false,
        message: `Batas akurasi GPS harus antara ${MIN_GPS_MAX_ACCURACY_METERS} hingga ${MAX_GPS_MAX_ACCURACY_METERS} meter.`
      };
    }
    nextGps.maxAccuracyMeters = Math.round(maxAccuracy);
  }

  if (hasOwn(rawPatch, "maxAccuracyAllowanceMeters")) {
    const allowance = parseGpsNumber(rawPatch.maxAccuracyAllowanceMeters);
    if (allowance == null || allowance < 0 || allowance > MAX_GPS_MAX_ACCURACY_METERS) {
      return {
        valid: false,
        message: `Toleransi drift akurasi GPS harus antara 0 hingga ${MAX_GPS_MAX_ACCURACY_METERS} meter.`
      };
    }
    nextGps.maxAccuracyAllowanceMeters = Math.round(allowance);
  }

  if (hasOwn(rawPatch, "sampleCount")) {
    const sampleCount = parseGpsNumber(rawPatch.sampleCount);
    if (sampleCount == null || sampleCount < MIN_GPS_SAMPLE_COUNT || sampleCount > MAX_GPS_SAMPLE_COUNT) {
      return {
        valid: false,
        message: `Jumlah sample GPS harus antara ${MIN_GPS_SAMPLE_COUNT} hingga ${MAX_GPS_SAMPLE_COUNT}.`
      };
    }
    nextGps.sampleCount = Math.round(sampleCount);
  }

  if (hasOwn(rawPatch, "timeoutMs")) {
    const timeoutMs = parseGpsNumber(rawPatch.timeoutMs);
    if (timeoutMs == null || timeoutMs < MIN_GPS_TIMEOUT_MS || timeoutMs > MAX_GPS_TIMEOUT_MS) {
      return {
        valid: false,
        message: `Timeout GPS harus antara ${MIN_GPS_TIMEOUT_MS} hingga ${MAX_GPS_TIMEOUT_MS} ms.`
      };
    }
    nextGps.timeoutMs = Math.round(timeoutMs);
  }

  return { valid: true, gps: nextGps };
}

module.exports = {
  DEFAULT_GPS_MAX_ACCURACY_METERS,
  DEFAULT_GPS_MAX_ACCURACY_ALLOWANCE_METERS,
  DEFAULT_GPS_RADIUS_METERS,
  DEFAULT_GPS_SAMPLE_COUNT,
  DEFAULT_GPS_TIMEOUT_MS,
  haversineDistanceMeters,
  parseGpsNumber,
  isValidLatitude,
  isValidLongitude,
  isNonZeroCoordinatePair,
  buildGpsPolicy,
  buildGpsValidationError,
  evaluateAttendanceGps,
  sanitizeGpsSettingsPatch
};
