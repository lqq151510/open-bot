const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return url.protocol === "http:" && url.hostname === "127.0.0.1"
    ? real(input, init)
    : new Response("offline fixture", { status: 503 });
};
