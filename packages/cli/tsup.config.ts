import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  external: ["@promptqueue/core", "@promptqueue/server"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
