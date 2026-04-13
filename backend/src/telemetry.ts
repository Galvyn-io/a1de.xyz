import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { AnthropicInstrumentation } from '@arizeai/openinference-instrumentation-anthropic';
import Anthropic from '@anthropic-ai/sdk';

const instrumentation = new AnthropicInstrumentation();
instrumentation.manuallyInstrument(Anthropic);

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [instrumentation],
});

sdk.start();

export { sdk };
export { propagateAttributes } from '@langfuse/tracing';
