export function GET() {
  return new Response("", {
    status: 204,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

