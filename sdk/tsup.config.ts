import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  outDir: 'lib',
  splitting: true,
  sourcemap: true,
  minify: false,
  clean: true,
  skipNodeModulesBundle: true,
  dts: true,
  external: ["node_modules"],
}));
