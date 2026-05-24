import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import manifest from "./manifest.config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stub = resolve(__dirname, "src/lib/empty-module.js");

export default defineConfig({
  plugins: [
    nodePolyfills({
      // Required for graphene-based libs that use Buffer, process, etc.
      // 'safe-buffer' is intentionally polyfilled as well — the Graphene SDK
      // requires it directly and it does not get resolved by the buffer alias.
      include: ["buffer", "process", "crypto", "stream", "events", "util", "safe-buffer"],
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true,
    }),
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: [
      // safe-buffer's API is identical to the standard 'buffer' polyfill.
      // Aliasing avoids shipping two copies of the same code.
      { find: "safe-buffer", replacement: "buffer" },
      // The R-Squared SDK eagerly imports aws-sdk/clients/s3 for its
      // S3Adapter and ipfs-http-client for its IPFSAdapter (both used by
      // the PersonalData storage layer). The wallet never touches that
      // layer, so we stub them out. This keeps aws-sdk (~3MB) AND the
      // ipfs-http-client transitive tree (which drags in protobufjs,
      // node-forge, parse-duration, libp2p-crypto, peer-id, ws — all of
      // which carry public npm audit advisories that don't apply to code
      // paths the wallet ever executes) out of the shipped bundle.
      { find: "aws-sdk/clients/s3", replacement: stub },
      { find: "aws-sdk", replacement: stub },
      { find: "ipfs-http-client", replacement: stub },
      // Stub the storage adapter modules themselves. The SDK's es/index.js
      // eagerly imports IPFSAdapter and S3Adapter, which in turn import
      // @babel/runtime/helpers/* — a peer dep we don't pull in. Aliasing the
      // adapter modules to the stub short-circuits the whole chain, so the
      // build is reproducible from a fresh clone with no babel-runtime.
      {
        find: /^.*\/storage\/src\/(IPFSAdapter|S3Adapter)$/,
        replacement: stub,
      },
      // Last-ditch safety net: if any code path inside node_modules still
      // imports a @babel/runtime helper, stub it to a benign no-op. The
      // adapters that need these helpers are themselves stubbed out, so
      // the helpers should never be referenced at runtime.
      { find: /^@babel\/runtime\/.*/, replacement: stub },
    ],
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        popup: "index.html",
        sidepanel: "sidepanel.html",
      },
    },
    // MV3 service workers must be ES modules
    target: "es2022",
    sourcemap: false,
    // Inline small assets so popup loads even if subresources fail
    assetsInlineLimit: 4096,
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
    },
  },
  // Required for WSS connections in extension context
  optimizeDeps: {
    include: [
      "@r-squared/rsquared-js",
      "@r-squared/rsquared-js-ws",
      "buffer",
      "process",
      "safe-buffer",
    ],
    esbuildOptions: {
      // Treat all source as ESM for safer interop with CJS packages.
      define: { global: "globalThis" },
    },
  },
  // Force Rollup's CommonJS plugin to handle mixed module formats so
  // the Graphene SDK's transitive require("safe-buffer") calls get rewritten.
  // Vite exposes this through build.commonjsOptions in v5.
  // See: https://github.com/rollup/plugins/tree/master/packages/commonjs#options
  // (transformMixedEsModules + include hint).

  // Vite needs to expose `global` for libraries that reference it directly.
  define: {
    global: "globalThis",
  },
});
