// Windows code-signing callback for electron-builder.
// Rulează pe VM Windows în timpul `electron-builder --win`.
// Semnează fiecare binary cerut (app exe + NSIS uninstaller + NSIS installer)
// folosind Azure Trusted Signing prin signtool /dlib.
//
// Calea către dlib + metadata JSON sunt configurate pe mașina de build,
// shared între toate proiectele care folosesc același cont Azure.

const { execSync } = require("child_process");

const SIGNTOOL  = process.env.WIN_SIGNTOOL  || '"C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe"';
const DLIB      = process.env.WIN_TS_DLIB   || '"C:\\BlureonPhone-Git\\tsclient\\bin\\x64\\Azure.CodeSigning.Dlib.dll"';
const META      = process.env.WIN_TS_META   || '"C:\\BlureonPhone-Git\\ts-metadata.json"';
const TIMESTAMP = process.env.WIN_TS_TIMESTAMP || "http://timestamp.acs.microsoft.com";

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
