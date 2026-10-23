// The hosted service the local app can publish to and back up to. Empty (the default) turns the cloud features off.
// Set ACARD_CLOUD_URL to a hosted Acard to publish and back up there.
export const CLOUD_URL = (process.env.ACARD_CLOUD_URL ?? "").replace(/\/+$/, "");
