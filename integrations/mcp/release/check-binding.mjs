#!/usr/bin/env node
// Adapter-profile checks. This is deliberately not a JSON Schema validator or
// evidence of registry namespace/package ownership. No network or child process.
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const identity = Object.freeze({
  package: '@epistemedeus/agent-payment-policy-mcp',
  version: '0.1.0',
  bin: 'agent-payment-policy-mcp',
  mcpName: 'io.github.epistemedeus/agent-payment-policy-mcp',
  schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json'
});

export function checkBinding(pkg, manifest, source) {
  const errors = [];
  const fail = message => errors.push(message);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, allowed, label) => {
    if (!object(value)) { fail(`${label} must be an object`); return false; }
    if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} has unqualified fields`);
    return true;
  };
  if (!object(pkg) || !object(manifest)) return ['package and manifest must be objects'];
  if (pkg.name !== identity.package) fail('package name differs from release identity');
  if (pkg.version !== identity.version) fail('package version differs from release identity');
  if (pkg.mcpName !== identity.mcpName) fail('package mcpName differs from release identity');
  if (pkg.type !== 'module') fail('package type must be module');
  if (pkg.license !== 'MIT') fail('adapter license must remain MIT');
  if (pkg.engines?.node !== '>=22') fail('package must require Node >=22');
  if (!object(pkg.bin) || Object.keys(pkg.bin).length !== 1 || typeof pkg.bin[identity.bin] !== 'string') {
    fail('package must expose exactly the admitted binary');
  } else if (!/^(?:\.\/)?[a-zA-Z0-9_./-]+\.mjs$/.test(pkg.bin[identity.bin]) || pkg.bin[identity.bin].split('/').includes('..') || pkg.bin[identity.bin].startsWith('/')) {
    fail('binary must be a clean relative .mjs path');
  }
  keys(manifest, ['$schema', 'name', 'description', 'version', 'packages', 'repository', 'websiteUrl', 'title'], 'manifest');
  if (manifest.$schema !== identity.schema) fail('manifest must use the exact dated official schema');
  if (manifest.name !== pkg.mcpName || manifest.name !== identity.mcpName) fail('manifest name and package mcpName disagree');
  if (manifest.version !== pkg.version) fail('manifest and package versions disagree');
  if (typeof manifest.description !== 'string' || [...manifest.description].length < 1 || [...manifest.description].length > 100) fail('manifest description must have 1–100 characters');
  if (!Array.isArray(manifest.packages) || manifest.packages.length !== 1) {
    fail('manifest must declare exactly one npm package');
  } else {
    const entry = manifest.packages[0];
    if (keys(entry, ['registryType', 'registryBaseUrl', 'identifier', 'version', 'transport', 'runtimeHint', 'runtimeArguments'], 'package entry')) {
      if (entry.registryType !== 'npm' || entry.registryBaseUrl !== 'https://registry.npmjs.org') fail('package must use the official public npm registry');
      if (entry.identifier !== pkg.name || entry.version !== pkg.version) fail('manifest package identity/version binding differs');
      if (!keys(entry.transport, ['type'], 'transport') || entry.transport.type !== 'stdio') fail('transport must be stdio');
      if (entry.runtimeHint !== undefined && entry.runtimeHint !== 'npx') fail('only the qualified npx runtime hint is allowed');
      if (entry.runtimeArguments !== undefined) {
        if (entry.runtimeHint !== 'npx' || !Array.isArray(entry.runtimeArguments) || entry.runtimeArguments.length !== 1 ||
            !object(entry.runtimeArguments[0]) || Object.keys(entry.runtimeArguments[0]).sort().join(',') !== 'type,value' ||
            entry.runtimeArguments[0].type !== 'positional' || entry.runtimeArguments[0].value !== '--yes') fail('runtime arguments may only supply the qualified noninteractive --yes');
      }
    }
  }
  if (pkg.repository?.type !== 'git' || pkg.repository?.url !== 'git+https://github.com/epistemedeus/agent-payment-policy.git' || pkg.repository?.directory !== 'integrations/mcp') fail('package must bind the owning repository and directory');
  if (manifest.repository?.url !== 'https://github.com/epistemedeus/agent-payment-policy' || manifest.repository?.source !== 'github' || manifest.repository?.subfolder !== 'integrations/mcp') fail('manifest must bind the owning GitHub source and subfolder');
  if (source?.adapterPublicSource?.repository !== 'https://github.com/epistemedeus/agent-payment-policy' || source?.adapterPublicSource?.directory !== 'integrations/mcp' || source?.adapterPublicSource?.role !== 'owning source projection') fail('source manifest must identify the owning projection role');
  if (manifest.repository !== undefined) {
    if (keys(manifest.repository, ['url', 'source', 'subfolder', 'id'], 'repository')) {
      if (manifest.repository.source !== 'github' || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repository.url ?? '')) fail('repository must identify an actual public GitHub source');
      const packageUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
      if (packageUrl?.replace(/^git\+/, '').replace(/\.git$/, '') !== manifest.repository.url) fail('package and manifest repository URLs disagree');
      if (manifest.repository.subfolder !== undefined && (!/^[a-zA-Z0-9_./-]+$/.test(manifest.repository.subfolder) || manifest.repository.subfolder.startsWith('/') || manifest.repository.subfolder.split('/').includes('..'))) fail('repository subfolder must be a clean relative path');
      if (manifest.repository.subfolder !== (typeof pkg.repository === 'object' ? pkg.repository.directory : undefined)) fail('package and manifest source directories disagree');
    }
  } else if (pkg.repository !== undefined) fail('package repository requires the same source binding in manifest');
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('usage');
    const pkg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const manifest = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    const errors = checkBinding(pkg, manifest, JSON.parse(readFileSync(process.argv[4], 'utf8')));
    if (!errors.length) {
      const bin = resolve(dirname(process.argv[2]), pkg.bin[identity.bin]);
      if (!statSync(bin).isFile()) errors.push('declared binary is absent');
    }
    if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; }
    else process.stdout.write('adapter package/manifest binding valid; ownership and public source remain separate receiving gates\n');
  } catch {
    process.stderr.write('binding check failed: supply readable package.json, server.json and SOURCE-MANIFEST.json with an existing declared binary\n');
    process.exitCode = 1;
  }
}
