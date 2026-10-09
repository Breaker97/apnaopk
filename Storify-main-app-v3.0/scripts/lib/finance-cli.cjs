/** Finance CLI runs server modules without a Next request/cache. */
require("./next-cache-passthrough.cjs");
const modulePath = require.resolve("server-only");
require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: {} };
