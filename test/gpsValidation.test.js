const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_GPS_MAX_ACCURACY_ALLOWANCE_METERS,
  DEFAULT_GPS_MAX_ACCURACY_METERS,
  DEFAULT_GPS_TIMEOUT_MS,
  buildGpsPolicy,
  evaluateAttendanceGps,
  haversineDistanceMeters,
  sanitizeGpsSettingsPatch
} = require("../utils/gpsValidation");

test("buildGpsPolicy applies safe defaults and preserves valid operator config", () => {
  const defaultPolicy = buildGpsPolicy({ gps: { latitude: -6.973185, longitude: 107.632543 } });
  assert.equal(defaultPolicy.targetLatitude, -6.973185);
  assert.equal(defaultPolicy.targetLongitude, 107.632543);
  assert.equal(defaultPolicy.maxAccuracyMeters, DEFAULT_GPS_MAX_ACCURACY_METERS);
  assert.equal(defaultPolicy.maxAccuracyAllowanceMeters, DEFAULT_GPS_MAX_ACCURACY_ALLOWANCE_METERS);
  assert.equal(defaultPolicy.timeoutMs, DEFAULT_GPS_TIMEOUT_MS);

  const customPolicy = buildGpsPolicy({
    gps: {
      latitude: -6.9731,
      longitude: 107.6301,
      radius: 15,
      maxAccuracyMeters: 120,
      sampleCount: 3,
      timeoutMs: 8000
    }
  });
  assert.equal(customPolicy.radiusMeters, 15);
  assert.equal(customPolicy.maxAccuracyMeters, 120);
  assert.equal(customPolicy.sampleCount, 3);
  assert.equal(customPolicy.timeoutMs, 8000);
});

test("evaluateAttendanceGps allows indoor GPS drift bounded by reported accuracy", () => {
  const refLat = -6.973185;
  const refLng = 107.632543;
  // ~55m north of reference coordinate
  const driftedLat = refLat + 0.0005;
  const actualDistance = haversineDistanceMeters(driftedLat, refLng, refLat, refLng);
  assert.ok(actualDistance > 45 && actualDistance < 65, `unexpected distance ${actualDistance}`);

  const policy = buildGpsPolicy({
    gps: {
      latitude: refLat,
      longitude: refLng,
      radius: 15,
      maxAccuracyMeters: 150,
      maxAccuracyAllowanceMeters: 80
    }
  });

  const acceptedWithIndoorAccuracy = evaluateAttendanceGps({
    userLatitude: driftedLat,
    userLongitude: refLng,
    accuracyMeters: 65,
    gpsPolicy: policy,
    actionLabel: "checkin"
  });
  assert.equal(acceptedWithIndoorAccuracy.ok, true);
  assert.equal(acceptedWithIndoorAccuracy.allowedRadiusMeters, 15);
  assert.equal(acceptedWithIndoorAccuracy.accuracyAllowanceMeters, 65);
  assert.equal(acceptedWithIndoorAccuracy.effectiveAllowedRadiusMeters, 80);

  // With crisp GPS accuracy (10m), effective radius is only 15 + 10 = 25m, so 55m drift is rejected
  const rejectedWithCrispAccuracy = evaluateAttendanceGps({
    userLatitude: driftedLat,
    userLongitude: refLng,
    accuracyMeters: 10,
    gpsPolicy: policy,
    actionLabel: "checkin"
  });
  assert.equal(rejectedWithCrispAccuracy.ok, false);
  assert.equal(rejectedWithCrispAccuracy.statusCode, 400);
  assert.equal(rejectedWithCrispAccuracy.errorBody.reason, "OUTSIDE_RADIUS");
  assert.equal(rejectedWithCrispAccuracy.errorBody.effectiveAllowedRadiusMeters, 25);
});

test("evaluateAttendanceGps caps accuracy buffer at maxAccuracyAllowanceMeters even if accuracy is near max", () => {
  const refLat = -6.973185;
  const refLng = 107.632543;
  // ~130m away
  const farLat = refLat + 0.00117;
  const policy = buildGpsPolicy({
    gps: {
      latitude: refLat,
      longitude: refLng,
      radius: 15,
      maxAccuracyMeters: 150,
      maxAccuracyAllowanceMeters: 80
    }
  });

  // Even at accuracy=140m (allowed by maxAccuracyMeters=150), buffer caps at 80m -> max allowed 95m
  const result = evaluateAttendanceGps({
    userLatitude: farLat,
    userLongitude: refLng,
    accuracyMeters: 140,
    gpsPolicy: policy,
    actionLabel: "checkout"
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.errorBody.reason, "OUTSIDE_RADIUS");
  assert.equal(result.errorBody.accuracyAllowanceMeters, 80);
  assert.equal(result.errorBody.effectiveAllowedRadiusMeters, 95);
  assert.match(result.errorBody.message, /checkout di luar radius/i);
});

test("evaluateAttendanceGps rejects accuracy above maxAccuracyMeters with distanceMeters populated", () => {
  const refLat = -6.973185;
  const refLng = 107.632543;
  const policy = buildGpsPolicy({
    gps: {
      latitude: refLat,
      longitude: refLng,
      radius: 80,
      maxAccuracyMeters: 100
    }
  });

  const result = evaluateAttendanceGps({
    userLatitude: refLat,
    userLongitude: refLng,
    accuracyMeters: 185,
    gpsPolicy: policy,
    actionLabel: "checkout"
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.errorBody.reason, "GPS_ACCURACY_TOO_LOW");
  assert.equal(result.errorBody.accuracyMeters, 185);
  assert.equal(result.errorBody.distanceMeters, 0);
});

test("sanitizeGpsSettingsPatch rejects corrupted coordinates and preserves unspecified keys", () => {
  const fallback = {
    latitude: -6.973185,
    longitude: 107.632543,
    radius: 80,
    maxAccuracyMeters: 150
  };

  const badZero = sanitizeGpsSettingsPatch({ latitude: 0, longitude: 0 }, fallback);
  assert.equal(badZero.valid, false);

  const badNull = sanitizeGpsSettingsPatch({ latitude: null, longitude: 107.63 }, fallback);
  assert.equal(badNull.valid, false);

  const badRadius = sanitizeGpsSettingsPatch({ radius: 2 }, fallback);
  assert.equal(badRadius.valid, false);

  const validPartial = sanitizeGpsSettingsPatch({ radius: 45, maxAccuracyMeters: 120 }, fallback);
  assert.equal(validPartial.valid, true);
  assert.equal(validPartial.gps.latitude, -6.973185);
  assert.equal(validPartial.gps.longitude, 107.632543);
  assert.equal(validPartial.gps.radius, 45);
  assert.equal(validPartial.gps.maxAccuracyMeters, 120);
});
