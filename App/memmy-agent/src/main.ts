#!/usr/bin/env node
// Must load first: resolve CUBY_CLOUD_SERVICE from external env, packaged manifest, or development .env.
import "./load-env.js";
import { main } from "./entrypoints/cli/commands.js";
import { ConfigError } from "./config/loader.js";

try {
  await main();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  // Config validation failures are expected user-facing errors.
  // Report them concisely and exit non-zero so scripts can detect the failure.
  console.error(`cuby: ${error.message}`);
  process.exitCode = 1;
}
