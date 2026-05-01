// Windows code-signing callback for electron-builder.
// Runs on the Windows build VM during `electron-builder --win`.
// Signs every binary that electron-builder asks us to sign (app exe, NSIS uninstaller, NSIS installer)
// using Azure Trusted Signing (cert: ***SIGNING_ORG***) via signtool /dlib.
//
// Setup on the Windows VM is shared with BlureonPhone — see
// ~/Documents/github projects/AZURE-TRUSTED-SIGNING.md for the full procedure.

const { execSync } = require("child_process");

const SIGNTOOL  = '"C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe"';
const DLIB      = '"C:\\BlureonPhone-Git\\tsclient\\bin\\x64\\Azure.CodeSigning.Dlib.dll"';
const META      = '"C:\\BlureonPhone-Git\\ts-metadata.json"';
const TIMESTAMP = "http://timestamp.acs.microsoft.com";

exports.default = async function (configuration) {
    const file = configuration.path;
    if (!file) {
        throw new Error("sign-windows: configuration.path missing");
    }

    const cmd = `${SIGNTOOL} sign /v /fd SHA256 /tr ${TIMESTAMP} /td SHA256 /dlib ${DLIB} /dmdf ${META} "${file}"`;
    console.log(`[sign-windows] Signing: ${file}`);

    try {
        execSync(cmd, { stdio: "inherit", windowsHide: true });
        console.log(`[sign-windows] ✓ Signed: ${file}`);
    } catch (err) {
        throw new Error(`signtool failed for ${file}: ${err.message}`);
    }
};
