// The hosted service the local app connects to for web publish and cloud backup (docs/local-first.md 5장).
// ACARD_CLOUD_URL points it elsewhere; an empty value turns the cloud features off.
export const CLOUD_URL = (process.env.ACARD_CLOUD_URL ?? "https://notes.example.com").replace(/\/+$/, "");
