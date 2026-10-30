/**
 * OpenTelemetry tracing for runs / tool calls / LLM calls.
 * Exporter is optional — enabled when OTEL_EXPORTER_OTLP_ENDPOINT (or OTEL_ENABLED=1) is set.
 */
import { trace, context, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { createLogger } from "./logger.js";

const log = createLogger("otel");

let tracer: Tracer = trace.getTracer("sam-harness", "1.0.0");
let sdkStarted = false;

export function otelEnabled(): boolean {
  const flag = String(process.env.OTEL_ENABLED || "").trim();
  if (flag === "0" || flag.toLowerCase() === "false") return false;
  if (flag === "1" || flag.toLowerCase() === "true") return true;
  return Boolean(String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim());
}

/** Lazily start NodeSDK when an OTLP endpoint is configured. */
export async function initTracing(): Promise<void> {
  if (sdkStarted || !otelEnabled()) return;
  sdkStarted = true;
  try {
    const [{ NodeTracerProvider }, { BatchSpanProcessor }, { OTLPTraceExporter }, { resourceFromAttributes }, semconv] =
      await Promise.all([
        import("@opentelemetry/sdk-trace-node"),
        import("@opentelemetry/sdk-trace-base"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/semantic-conventions"),
      ]);
    const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [semconv.ATTR_SERVICE_NAME]:
          process.env.OTEL_SERVICE_NAME || "sam-harness",
      }),
      spanProcessors: endpoint
        ? [
            new BatchSpanProcessor(
              new OTLPTraceExporter({
                url: endpoint.endsWith("/v1/traces")
                  ? endpoint
                  : `${endpoint.replace(/\/$/, "")}/v1/traces`,
              })
            ),
          ]
        : [],
    });
    provider.register();
    tracer = trace.getTracer("sam-harness", "1.0.0");
    log.info({ endpoint: endpoint || "(noop)" }, "OpenTelemetry tracing enabled");
  } catch (e) {
    log.warn({ err: String(e) }, "OpenTelemetry init failed — continuing without exporter");
  }
}

export function getTracer(): Tracer {
  return tracer;
}

export function startSpan(
  name: string,
  attrs?: Record<string, string | number | boolean>
): Span {
  const span = tracer.startSpan(name);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
  }
  return span;
}

export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = startSpan(name, attrs);
  try {
    const result = await context.with(trace.setSpan(context.active(), span), () =>
      fn(span)
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (e) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: String((e as Error)?.message || e),
    });
    span.recordException(e as Error);
    throw e;
  } finally {
    span.end();
  }
}

export function withSpanSync<T>(
  name: string,
  attrs: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => T
): T {
  const span = startSpan(name, attrs);
  try {
    const result = fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (e) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: String((e as Error)?.message || e),
    });
    span.recordException(e as Error);
    throw e;
  } finally {
    span.end();
  }
}
