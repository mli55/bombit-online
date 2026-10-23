// Preserve the WebSocket upgrade and same-origin checks through the service binding.
export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/ws/') || path === '/health') return env.GAME.fetch(request);
    return env.ASSETS.fetch(request);
  }
};
