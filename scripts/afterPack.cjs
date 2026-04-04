// afterPack hook for electron-builder
// Re-signs the macOS app bundle with an ad-hoc signature
// so the app can launch without a valid Developer ID certificate.
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== "darwin") return;

    const appPath = path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`
    );

    console.log(`  • ad-hoc signing ${appPath}`);
    execSync(
        `codesign --force --deep -s - "${appPath}"`,
        { stdio: "inherit" }
    );
    console.log("  • ad-hoc signing complete");
};
