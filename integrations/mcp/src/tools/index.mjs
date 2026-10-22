// Transport bindings only. All decisions remain in the unchanged policy core.
import {
  normalizeRequest,
  inspectOutputSchema,
  prepareOutputValidator,
  validateOutput,
  evaluateReceiptCompleteness,
  receiptCompletenessInputSchema,
  receiptCompletenessOutputSchema,
} from "../../policy/core.mjs";

const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const strings = { type: "array", items: { type: "string" } };
const falseValue = { const: false };

const normalizedRequestOutput = {
  type: "object",
  additionalProperties: false,
  required: ["method", "origin", "pathname", "queryKeys", "publicRoute", "bodyBinding", "bindingDigest"],
  properties: {
    method: { type: "string" },
    origin: { type: "string" },
    pathname: { type: "string" },
    queryKeys: strings,
    publicRoute: { type: "string" },
    bodyBinding: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["mediaType", "bytes", "digest"],
          properties: {
            mediaType: { const: "application/json" },
            bytes: { type: "integer", minimum: 1 },
            digest,
          },
        },
      ],
    },
    bindingDigest: digest,
  },
};

const inspectedSchemaOutput = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaDigest", "canonicalBytes", "requiredPaths", "decision", "schemaRetained",
    "credentialsUsed", "walletAccessed", "paymentSigned", "paymentSent",
  ],
  properties: {
    schemaDigest: digest,
    canonicalBytes: { type: "integer", minimum: 1 },
    requiredPaths: strings,
    decision: { const: "admissible" },
    schemaRetained: falseValue,
    credentialsUsed: falseValue,
    walletAccessed: falseValue,
    paymentSigned: falseValue,
    paymentSent: falseValue,
  },
};

// Both outcomes are useful CLI results. A rejected body never gets echoed.
const acceptedOutput = {
  type: "object",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["valid", "responseDigest", "schemaDigest"],
      properties: {
        valid: { const: true },
        responseDigest: digest,
        schemaDigest: digest,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["valid"],
      properties: { valid: falseValue },
    },
  ],
};

export const tools = [
  {
    name: "normalize_request",
    description: "Normalize and bind a supplied HTTPS request and JSON POST body offline. Never fetches the target; no DNS safety or payment authorization is established.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["method", "target"],
      properties: {
        method: { type: "string" },
        target: { type: "string" },
        options: {
          type: "object",
          additionalProperties: false,
          properties: {
            body: {},
            mediaType: { type: "string" },
          },
        },
      },
    },
    outputSchema: normalizedRequestOutput,
    run({ method, target, options }) {
      return normalizeRequest(method, target, options);
    },
  },
  {
    name: "inspect_output_schema",
    description: "Inspect a supplied self-contained JSON acceptance schema and required paths using the policy core. Returns its exact digest and guaranteed paths, without retaining the schema.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["schema"],
      properties: {
        schema: { type: "object" },
        requiredFields: strings,
      },
    },
    outputSchema: inspectedSchemaOutput,
    run(args) {
      return inspectOutputSchema(args);
    },
  },
  {
    name: "accept_output",
    description: "Accept supplied JSON against its exact schema digest using the unchanged CLI sequence. Returns valid:false for rejection; returns only validity and digests, never the supplied body. No settlement is proved.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["schema", "schemaDigest", "output"],
      properties: {
        schema: { type: "object" },
        schemaDigest: { type: "string" },
        output: {},
      },
    },
    outputSchema: acceptedOutput,
    run({ schema, schemaDigest, output }) {
      // Keep this order and projection identical to cli.mjs output-accept.
      try {
        const inspected = inspectOutputSchema({ schema });
        if (inspected.schemaDigest !== schemaDigest) {
          throw new Error("output schema does not match schemaDigest");
        }
        const contract = {
          mediaType: "application/json",
          requiredFields: inspected.requiredPaths,
          schemaDigest: inspected.schemaDigest,
        };
        const schemaValidator = prepareOutputValidator({ schema, contract });
        const result = validateOutput(output, contract, { schemaValidator });
        return {
          valid: true,
          responseDigest: result.responseDigest,
          schemaDigest: result.schemaDigest,
        };
      } catch {
        return { valid: false };
      }
    },
  },
  {
    name: "classify_receipt",
    description: "Classify caller-supplied controlled receipt, transaction, balance and output observations. Completeness and delivery validity stay independent. Does not verify transactions, signatures, payment authority or factual truth.",
    inputSchema: receiptCompletenessInputSchema(),
    outputSchema: receiptCompletenessOutputSchema(),
    run(args) {
      return evaluateReceiptCompleteness(args);
    },
  },
];
