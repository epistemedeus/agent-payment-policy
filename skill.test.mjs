import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const skill = readFileSync(
  new URL("./skills/agent-payment-policy/SKILL.md", import.meta.url),
  "utf8",
);
const interfaceMetadata = readFileSync(
  new URL("./skills/agent-payment-policy/agents/openai.yaml", import.meta.url),
  "utf8",
);

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
