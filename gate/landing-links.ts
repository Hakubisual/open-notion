// The landing's two calls to action, changed here only (acard-impl-contract.md): the app download page from the desktop
// lane and the web publishing subscription. Until the billing lane names its checkout path the subscribe button opens
// sign-up, which the closed beta turns into the waitlist (beta.ts rewriteLanding runs after this).
export const LANDING_LINKS = { download: "/download", subscribe: "/signup" } as const;

export function rewriteLandingLinks(res: Response, links: Record<string, string> = LANDING_LINKS): Response {
  return new HTMLRewriter()
    .on("a[data-cta]", {
      element(el) {
        const href = links[el.getAttribute("data-cta") ?? ""];
        if (href) el.setAttribute("href", href);
      },
    })
    .transform(res);
}
