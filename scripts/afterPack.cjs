// afterPack hook for electron-builder
// On macOS: we skip code signing entirely (identity: null in config).
// The previous ad-hoc signing (codesign --force --deep -s -) broke
// electron-updater's auto-update because macOS ShipIt/Squirrel
// validates the code signature on the extracted .app and ad-hoc
// signatures fail that validation.
//
// Without any signature, macOS treats the app as "unsigned" which
// is fine — users already approve it via Gatekeeper on first run.
const path = require("path");

exports.default = async function afterPack(context) {
    // Nothing to do — signing is handled by electron-builder config
    // (identity: null on macOS = no signing, which is correct for
    // free/open-source apps without an Apple Developer certificate)
    console.log(`  • afterPack: ${context.electronPlatformName} — no custom signing needed`);
};
