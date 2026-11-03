import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/node";

/**
 * Sentry Error Tracking Initialization
 * 
 * Organization: upnexa-yb
 * Set SENTRY_DSN in .env file with your project's DSN from Sentry UI
 * Get DSN from: https://sentry.io/settings/<org>/<project>/general/keys/
 */
export function initSentry() {
  const sentryDsn = process.env.SENTRY_DSN;
  
  if (!sentryDsn) {
    console.warn(
      "⚠️  SENTRY_DSN not configured. Sentry disabled. " +
      "Add SENTRY_DSN to .env file from your Sentry project settings."
    );
    return;
  }

  Sentry.init({
    dsn: sentryDsn,
    enabled: process.env.NODE_ENV !== "test",

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: 1,

    // Set sampling rate for profiling
    profilesSampleRate: 1.0,

    // Capture console logs
    integrations: [
      Sentry.captureConsoleIntegration({
        levels: ["error", "warn"],
      }),
      nodeProfilingIntegration(),
    ],

    // Optimize bandwidth by adjusting sample rates based on release
    release: "sam-harness@1.0.0",

    // Capture exceptions
    environment: process.env.NODE_ENV || "development",
  });

  console.log("Sentry initialized successfully");
}