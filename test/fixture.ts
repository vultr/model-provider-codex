import type { ModelDocument } from "@vultr/model-catalog";

export function document(overrides: Partial<ModelDocument> = {}): ModelDocument {
  return {
    schema_version: "2.4",
    id: "glm-5.3",
    name: "GLM 5.3",
    input_modalities: [
      { type: "text", supported_inputs: { max_context_length: { value: 1_048_576, unit: "token" } } },
      { type: "image" },
    ],
    output_modalities: [
      {
        type: "text",
        max_length: { value: 131_072, unit: "token" },
        supported_parameters: { tools: { type: "boolean" } },
      },
    ],
    reasoning: {
      mandatory: false,
      supported_efforts: ["ultra", "max", "high", "medium", "low", "turbo"],
      supports_max_tokens: true,
    },
    ...overrides,
  };
}
