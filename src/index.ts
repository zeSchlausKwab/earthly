import { join } from "node:path";
import { hexToBytes } from "@noble/hashes/utils.js";
import { file, serve } from "bun";
import { getPublicKey } from "nostr-tools/pure";
import { serverConfig } from "./config/env.server";
import {
  isCrawler,
  generateHomeOGHtml,
  generateGeoEventOGHtml,
  generateContextOGHtml,
  fetchCachedGeoEventOGData,
  fetchCachedContextEventOGData,
  getOGImageHeaders,
  getOGRouteHeaders,
  generateOGImagePNG,
  warmOGCache,
} from "./lib/og";

const isProduction = process.env.NODE_ENV === "production";

console.log(
  `Starting server in ${isProduction ? "production" : "development"} mode`,
);
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

// Get the expected pubkey for migration auth
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY;
const EXPECTED_PUBKEY = APP_PRIVATE_KEY
  ? getPublicKey(hexToBytes(APP_PRIVATE_KEY))
  : undefined;

type BunRouteRequest = Request & { params: Record<string, string> };
type BunRouteResponse = Response | Promise<Response>;
type BunRoute =
  | ((req: BunRouteRequest) => BunRouteResponse)
  | Partial<
      Record<
        "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS",
        (req: BunRouteRequest) => BunRouteResponse
      >
    >;

/**
 * Get base URL from request for OG tags
 */
function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Serve a built file with an explicit `Content-Type` for extensions that browsers
 * are strict about. WebAssembly streaming compilation
 * (`WebAssembly.instantiateStreaming`) REQUIRES `application/wasm` — without it the
 * QuickJS code-interpreter sandbox (Phase 4) fails to instantiate in the browser.
 */
function serveBuiltFile(builtFile: ReturnType<typeof file>, pathname: string): Response {
  const headers: Record<string, string> = {};
  if (pathname.endsWith(".wasm")) {
    headers["Content-Type"] = "application/wasm";
  }
  return new Response(builtFile, { headers });
}

/**
 * Handle OG routes for crawlers, serve SPA for regular users
 */
async function handleGeoEventRoute(req: BunRouteRequest): Promise<Response> {
  const naddr = req.params.naddr ?? "";
  const commentId = req.params.commentId ?? "";
  const baseUrl = getBaseUrl(req);

  if (!naddr) {
    return Response.redirect(baseUrl, 302);
  }

  if (isCrawler(req)) {
    const { data, cacheStatus } = await fetchCachedGeoEventOGData(
      naddr,
      serverConfig.relayUrl,
    );
    const html = generateGeoEventOGHtml(
      baseUrl,
      naddr,
      data?.title ?? "Geographic Dataset",
      data?.description ?? "View this geographic dataset on Earthly",
    );
    return new Response(html, {
      headers: getOGRouteHeaders(cacheStatus),
    });
  }

  warmOGCache("geoevent", naddr, serverConfig.relayUrl);

  // For regular users, redirect to hash-based route
  if (commentId) {
    return Response.redirect(
      `${baseUrl}/#/datasets/geoevent/${naddr}/comment/${commentId}`,
      302,
    );
  }
  return Response.redirect(`${baseUrl}/#/datasets/geoevent/${naddr}`, 302);
}

/**
 * Handle /context/:naddr — OG HTML for crawlers, redirect for users
 */
async function handleContextRoute(req: BunRouteRequest): Promise<Response> {
  const naddr = req.params.naddr ?? "";
  const commentId = req.params.commentId ?? "";
  const baseUrl = getBaseUrl(req);

  if (!naddr) {
    return Response.redirect(baseUrl, 302);
  }

  if (isCrawler(req)) {
    const { data, cacheStatus } = await fetchCachedContextEventOGData(
      naddr,
      serverConfig.relayUrl,
    );
    const html = generateContextOGHtml(
      baseUrl,
      naddr,
      data?.title ?? "Map Context",
      data?.description ?? "Explore this geographic context on Earthly",
      data?.image,
    );
    return new Response(html, {
      headers: getOGRouteHeaders(cacheStatus),
    });
  }

  warmOGCache("context", naddr, serverConfig.relayUrl);

  if (commentId) {
    return Response.redirect(
      `${baseUrl}/#/contexts/mapcontext/${naddr}/comment/${commentId}`,
      302,
    );
  }

  return Response.redirect(`${baseUrl}/#/contexts/mapcontext/${naddr}`, 302);
}

/**
 * Handle /og/image/:type/:naddr — generate and serve a PNG OG image
 */
async function handleOGImageRoute(req: BunRouteRequest): Promise<Response> {
  const { type, naddr } = req.params;
  if (!naddr || !type) {
    return new Response("Not found", { status: 404 });
  }

  try {
    if (type === "context") {
      const { data, cacheStatus } = await fetchCachedContextEventOGData(
        naddr,
        serverConfig.relayUrl,
        { waitForFreshMs: 1500 },
      );

      const png = await generateOGImagePNG({
        title: data?.title ?? "Map Context",
        description:
          data?.description ?? "Explore this geographic context on Earthly",
        backgroundImageUrl: data?.image,
      });

      if (!png) return new Response("Image generation failed", { status: 500 });
      const body = new Uint8Array(png).buffer;
      return new Response(body, { headers: getOGImageHeaders(cacheStatus) });
    }

    if (type === "geoevent") {
      const { data, cacheStatus } = await fetchCachedGeoEventOGData(
        naddr,
        serverConfig.relayUrl,
        {
          waitForFreshMs: 1500,
        },
      );

      const png = await generateOGImagePNG({
        title: data?.title ?? "Geographic Dataset",
        description:
          data?.description ?? "View this geographic dataset on Earthly",
      });

      if (!png) return new Response("Image generation failed", { status: 500 });
      const body = new Uint8Array(png).buffer;
      return new Response(body, { headers: getOGImageHeaders(cacheStatus) });
    }

    return new Response("Not found", { status: 404 });
  } catch (err) {
    console.error("[OG image route] Error:", err);
    return new Response("Internal server error", { status: 500 });
  }
}

// Define route handlers that work in both modes
const apiRoutes: Record<string, BunRoute> = {
  "/api/hello": {
    async GET(_req: BunRouteRequest) {
      return Response.json({
        message: "Hello, world!",
        method: "GET",
      });
    },
    async PUT(_req: BunRouteRequest) {
      return Response.json({
        message: "Hello, world!",
        method: "PUT",
      });
    },
  },

  "/api/app-pubkey": {
    async GET() {
      return Response.json({
        pubkey: EXPECTED_PUBKEY || null,
      });
    },
  },
};

// Add debug endpoints in development only
if (!isProduction) {
  apiRoutes["/api/debug/pubkey"] = {
    async GET(_req: BunRouteRequest) {
      return Response.json({
        hasPrivateKey: !!APP_PRIVATE_KEY,
        expectedPubkey: EXPECTED_PUBKEY || "NOT SET",
        nodeEnv: process.env.NODE_ENV,
      });
    },
  };
}
// Start server
(async () => {
  // Serve static files from public/static/ (stable URLs, no hashing)
  const serveStaticFile = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const staticFile = file(join(process.cwd(), "public", url.pathname));
    if (await staticFile.exists()) {
      return new Response(staticFile);
    }
    return new Response("Not found", { status: 404 });
  };

  if (isProduction) {
    // OG routes for social media crawlers (production only)
    const ogRoutes: Record<string, BunRoute> = {
      "/geoevent/:naddr": handleGeoEventRoute,
      "/geoevent/:naddr/comment/:commentId": handleGeoEventRoute,
      "/context/:naddr": handleContextRoute,
      "/context/:naddr/comment/:commentId": handleContextRoute,
      "/og/image/:type/:naddr": handleOGImageRoute,
    };

    // Production: Serve static files from dist/ and public/
    const port = Number.parseInt(process.env.PORT ?? "3000", 10);
    const server = serve({
      port: Number.isFinite(port) ? port : 3000,
      routes: {
        ...apiRoutes,
        ...ogRoutes,
        // Explicit static file route for stable URLs
        "/static/*": serveStaticFile,
        "/*": async (req) => {
          const url = new URL(req.url);

          // Check for crawler on home page
          if (url.pathname === "/" && isCrawler(req)) {
            const baseUrl = getBaseUrl(req);
            const html = generateHomeOGHtml(baseUrl);
            return new Response(html, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

          // Try to serve from public/ first (for static assets like images)
          const publicPath = join(process.cwd(), "public", pathname);
          const publicFile = file(publicPath);

          if (await publicFile.exists()) {
            return serveBuiltFile(publicFile, pathname);
          }

          // Try to serve from dist/ (built assets)
          const filePath = join(process.cwd(), "dist", pathname);
          const staticFile = file(filePath);

          if (await staticFile.exists()) {
            return serveBuiltFile(staticFile, pathname);
          }

          // Assets that must NEVER fall through to the SPA index.html. A `.wasm`
          // served as text/html would break WebAssembly instantiation, so a
          // genuine 404 is the correct (debuggable) outcome here.
          if (pathname.endsWith(".wasm")) {
            return new Response("Not found", { status: 404 });
          }

          // If file not found, serve index.html for client-side routing
          return new Response(file(join(process.cwd(), "dist", "index.html")));
        },
      },
    });

    console.log(`🚀 Server running at ${server.url} (production)`);
  } else {
    // Development: Use Bun's bundler with HMR
    // Assets in src/assets/ are bundled automatically by Bun
    const index = (await import("./index.html")).default;

    // The QuickJS code-interpreter sandbox (Phase 4) loads its `.wasm` from a
    // stable root URL. In production `build.ts` emits it to `dist/`; in dev there
    // is no build, so serve it straight from node_modules with the correct MIME.
    const serveQuickjsWasm = (): Response => {
      const wasmFile = file(
        join(
          process.cwd(),
          "node_modules",
          "@jitl",
          "quickjs-wasmfile-release-sync",
          "dist",
          "emscripten-module.wasm",
        ),
      );
      return new Response(wasmFile, {
        headers: { "Content-Type": "application/wasm" },
      });
    };

    const port = Number.parseInt(process.env.PORT ?? "3000", 10);
    const server = serve({
      port: Number.isFinite(port) ? port : 3000,
      routes: {
        ...apiRoutes,
        // Serve static files from public/static/ (stable URLs for OG images, etc.)
        "/static/*": serveStaticFile,
        // QuickJS sandbox WASM (served from node_modules in dev).
        "/emscripten-module.wasm": serveQuickjsWasm,
        // Catch-all for SPA routing (Bun handles assets from src/assets/)
        "/*": index,
      },

      development: {
        hmr: true,
        console: true,
      },
    });

    console.log(`🚀 Server running at ${server.url} (development)`);
  }
})();
