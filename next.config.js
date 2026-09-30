/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  images: {
    // Service photos are uploaded to Cloudinary.
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
  // Fonts the PDF service and the Open Graph cards read from disk, for hosts
  // that deploy traced output.
  outputFileTracingIncludes: {
    "/api/**/*": ["./assets/fonts/**/*"],
    "/**/opengraph-image*": ["./assets/fonts/**/*"],
  },
  // Sign-in moved from /sign-in; keep old links and bookmarks working.
  async redirects() {
    return [{ source: "/sign-in", destination: "/signin", permanent: true }];
  },
};

export default config;
