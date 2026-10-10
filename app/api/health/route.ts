// Keep the container health probe independent of MongoDB, external services,
// and store settings. A deployment is ready once Next.js can serve requests.
export function GET() {
  return new Response("OK", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
