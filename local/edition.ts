export async function licenseRoute(_request: Request, _dataDir: string): Promise<Response> {
  return new Response(JSON.stringify({ state: "none", edition: "self-host" }), { headers: { "content-type": "application/json; charset=utf-8" } });
}
