// One frame policy for HTML/visual blocks and parts.
// Frames have an opaque origin: sandbox="allow-scripts" without allow-same-origin.
// Dependency-free so the worker and editor chunks can inline the same policy.

export const SANDBOX_ATTR = "allow-scripts";
export const FRAME_BASE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";
