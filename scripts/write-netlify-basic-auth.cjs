/**
 * Optional HTTP Basic Auth for Netlify (Free plan).
 * Set BASIC_AUTH_USER + BASIC_AUTH_PASSWORD in Netlify env (build + production).
 * Site must be Public in Netlify visitor access, or external users never reach _headers.
 */
const fs = require("fs");
const path = require("path");

const user = process.env.BASIC_AUTH_USER?.trim();
const pass = process.env.BASIC_AUTH_PASSWORD?.trim();
const outPath = path.join(__dirname, "..", "public", "_headers");

if (user && pass) {
  const body = `/*\n  Basic-Auth: ${user}:${pass}\n`;
  fs.writeFileSync(outPath, body, "utf8");
  console.info("[Costa] Wrote public/_headers for Netlify Basic Auth.");
} else if (fs.existsSync(outPath)) {
  fs.unlinkSync(outPath);
  console.info("[Costa] No BASIC_AUTH_* env; removed public/_headers.");
}
