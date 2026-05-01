// afterPack hook for electron-builder.
// macOS signing is now handled by electron-builder itself (Developer ID Application
// + hardened runtime + entitlements + notarization), so we no longer need to ad-hoc
// sign here. Kept as a no-op for compatibility with the config reference; can be
// extended later for non-signing post-pack steps.

exports.default = async function afterPack(context) {
    if (context.electronPlatformName === "darwin") {
        console.log(`  • afterPack: macOS — Developer ID signing handled by electron-builder`);
    }
};
