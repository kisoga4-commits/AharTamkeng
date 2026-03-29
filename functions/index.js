const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

exports.verifyLicense = onCall(
  {
    region: "asia-southeast1",
  },
  async (request) => {
    const { shopId, licenseCode, deviceBindingId } = request.data || {};

    if (
      typeof shopId !== "string" ||
      !shopId.trim() ||
      typeof licenseCode !== "string" ||
      !licenseCode.trim() ||
      typeof deviceBindingId !== "string" ||
      !deviceBindingId.trim()
    ) {
      throw new HttpsError(
        "invalid-argument",
        "shopId, licenseCode, and deviceBindingId are required"
      );
    }

    const normalizedShopId = shopId.trim();
    const normalizedLicenseCode = licenseCode.trim();
    const normalizedDeviceBindingId = deviceBindingId.trim();

    const licenseRef = db.ref(`licenses/${normalizedShopId}`);
    const snapshot = await licenseRef.get();

    if (!snapshot.exists()) {
      throw new HttpsError("not-found", "shop_not_found");
    }

    const license = snapshot.val() || {};

    if (license.active !== true) {
      throw new HttpsError("failed-precondition", "license_inactive");
    }

    if (license.licenseCode !== normalizedLicenseCode) {
      throw new HttpsError("permission-denied", "invalid_license_code");
    }

    const boundDeviceId =
      typeof license.boundDeviceId === "string"
        ? license.boundDeviceId.trim()
        : "";

    if (!boundDeviceId) {
      await licenseRef.child("boundDeviceId").set(normalizedDeviceBindingId);
      return {
        status: "success",
        bound: true,
      };
    }

    if (boundDeviceId === normalizedDeviceBindingId) {
      return {
        status: "success",
        bound: true,
      };
    }

    throw new HttpsError("permission-denied", "device_mismatch");
  }
);
