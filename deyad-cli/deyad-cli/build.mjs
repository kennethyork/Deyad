import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = 'dist';

const isDevBuild =
  process.argv.includes("--dev") ||
  process.env.CODEX_DEV === "1" ||
  process.env.NODE_ENV === "development";

const plugins = [];

// Build Hygiene, ensure we drop previous dist dir and any leftover files
const outPath = path.resolve(OUT_DIR);
if (fs.existsSync(outPath)) {
  fs.rmSync(outPath, { recursive: true, force: true });
}

// Add a shebang that enables source‑map support for dev builds so that stack
// traces point to the original TypeScript lines without requiring callers to
// remember to set NODE_OPTIONS manually.
if (isDevBuild) {
  const devShebangLine =
    "#!/usr/bin/env -S NODE_OPTIONS=--enable-source-maps node\n";
  const devShebangPlugin = {
    name: "dev-shebang",
    setup(build) {
      build.onEnd(async () => {
        const outFile = path.resolve(isDevBuild ? `${OUT_DIR}/cli-dev.js` : `${OUT_DIR}/cli.js`);
        let code = await fs.promises.readFile(outFile, "utf8");
        if (code.startsWith("#!")) {
          code = code.replace(/^#!.*\n/, devShebangLine);
          await fs.promises.writeFile(outFile, code, "utf8");
        }
      });
    },
  };
  plugins.push(devShebangPlugin);
}

esbuild
  .build({
    entryPoints: ["src/cli.tsx"],
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: "tsconfig.json",
    outfile: isDevBuild ? `${OUT_DIR}/cli-dev.js` : `${OUT_DIR}/cli.js`,
    minify: !isDevBuild,
    sourcemap: isDevBuild ? "inline" : true,
    plugins,
    inject: ["./require-shim.js"],
  })
  .catch(() => process.exit(1));
