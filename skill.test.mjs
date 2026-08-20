import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  inspectOutputSchema,
  prepareOutputValidator,
  validateOutput,
} from "./core.mjs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const skill = readFileSync(
  new URL("./skills/agent-payment-policy/SKILL.md", import.meta.url),
  "utf8",
);
const interfaceMetadata = readFileSync(
  new URL("./skills/agent-payment-policy/agents/openai.yaml", import.meta.url),
  "utf8",
);

function fencedBlock(language) {
  const match = skill.match(new RegExp("```" + language + "\\n([\\s\\S]*?)```"));
  assert.ok(match, `skill is missing a ${language} example`);
  return match[1];
}

test("ships a valid neutral agent-payment-policy skill with the package", () => {
  assert.match(skill, /^---\nname: agent-payment-policy\ndescription: .+\n---\n/);
  assert.doesNotMatch(skill, /\bTODO\b/);
  assert.match(skill, /buyer-owned response contract/);
  assert.match(skill, /does\s+not create a wallet, sign a payment/);
  assert.ok(skill.includes(`agent-payment-policy@${packageJson.version}`));
  assert.ok(packageJson.files.includes("skills"));

  assert.match(interfaceMetadata, /display_name: "Agent Payment Policy"/);
  assert.match(interfaceMetadata, /\$agent-payment-policy/);
});

test("skill library example uses real output-contract field names", () => {
  const example = fencedBlock("js");
  assert.doesNotMatch(example, /\bmaxBytes\b/);
  assert.match(example, /\bmaxResponseBytes\b/);
  assert.doesNotMatch(example, /inspected\.requiredFields/);
  assert.doesNotMatch(example, /validateOutput\(\s*responseBytes/);
  assert.match(example, /JSON\.parse/);
  assert.match(example, /validateOutput\(\s*parsedBody/);
  assert.match(skill, /does not return `requiredFields`/);
});

test("skill JSON schema example compiles and validates with the documented contract", () => {
  const schema = JSON.parse(fencedBlock("json"));
  const requiredFields = ["data.source", "data.value", "data.observedAt"];
  const inspected = inspectOutputSchema({ schema, requiredFields });
  assert.equal(inspected.requiredFields, undefined);
  assert.deepEqual([...inspected.requiredPaths], ["data", "data.observedAt", "data.source", "data.value"]);

  const contract = {
    mediaType: "application/json",
    maxResponseBytes: 65536,
    requiredFields,
    schemaDigest: inspected.schemaDigest,
  };
  const schemaValidator = prepareOutputValidator({ schema, contract });
  const parsedBody = {
    data: {
      source: "https://example.com",
      value: 1,
      observedAt: "2026-08-20T00:00:00Z",
    },
  };
  const result = validateOutput(parsedBody, contract, { schemaValidator });
  assert.equal(result.valid, true);
  assert.equal(result.schemaValidated, true);
});
