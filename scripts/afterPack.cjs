// afterPack hook for electron-builder
// On macOS: properly ad-hoc sign the entire .app bundle.
// On arm64, the linker creates minimal signatures on Mach-O binaries
// that do NOT seal bundle resources. We need a full ad-hoc signature
// so the .app is self-consistent (sealed resources, etc.).
//
// Note: we no longer rely on Squirrel/ShipIt for installation on macOS
// (we use manual zip extraction + app replacement), but a proper ad-hoc
// signature is still good practice for Gatekeeper and general consistency.
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== "darwin") {
        console.log(`  • afterPack: ${context.electronPlatformName} — no custom signing needed`);
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);
    console.log(`  • afterPack: macOS — ad-hoc signing ${appName}.app`);

    // Sign nested frameworks and helpers first (inside-out)
    const fwDir = path.join(appPath, "Contents", "Frameworks");
    if (fs.existsSync(fwDir)) {
        const items = fs.readdirSync(fwDir).sort();
        for (const item of items) {
            const full = path.join(fwDir, item);
            if (item.endsWith(".framework") || item.endsWith(".app")) {
                console.log(`    → signing: ${item}`);
                execSync(`codesign --force --sign - "${full}"`, { stdio: "pipe" });
            }
        }
    }

    // Sign the main app bundle (seals all resources)
    console.log(`    → signing: ${appName}.app`);
    execSync(`codesign --force --sign - "${appPath}"`, { stdio: "pipe" });

    // Verify
    try {
        execSync(`codesign --verify --deep --strict "${appPath}" 2>&1`, { encoding: "utf8" });
        console.log(`  • afterPack: macOS — ad-hoc signature verified ✓`);
    } catch (err) {
        console.warn(`  • afterPack: macOS — signature verification warning:`, err.message);
        // Don't fail the build — manual update bypasses signature checks anyway
    }
};
