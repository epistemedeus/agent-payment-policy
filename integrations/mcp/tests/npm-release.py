#!/usr/bin/env python3
"""Actual command-path tests; publish is intercepted locally, never sent to npm."""
import hashlib
import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[1]


class Release(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='mcp-release-tests-')
        cls.work = Path(cls.tmp.name)
        cls.repo = cls.work/'repo'
        shutil.copytree(SOURCE, cls.repo/'integrations/mcp', ignore=shutil.ignore_patterns('node_modules', '__pycache__', 'artifacts'))
        cls.root = cls.repo/'integrations/mcp'
        cls.env = {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=256', 'PYTHONDONTWRITEBYTECODE': '1'}
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=cls.repo, env=cls.env, text=True).strip()
        git('init', '-q'); git('add', '.')
        git('-c', 'user.name=Release Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
        cls.sha = git('rev-parse', 'HEAD')
        cls.helper = cls.root/'scripts/npm-release.py'
        cls.output = cls.work/'prepared'
        p = cls.command('prepare', cls.output)
        assert p.returncode == 0, p.stderr
        cls.receipt = json.loads((cls.output/'release.json').read_text())
        cls.digest = cls.receipt['archive']['sha256']
        cls.npm = shutil.which('npm')
        cls.shim = cls.work/'shim'; cls.shim.mkdir()
        cls.log = cls.work/'calls.jsonl'
        # Only this process boundary is substituted. Real npm pack/check-pack already ran above.
        (cls.shim/'npm').write_text('#!/usr/bin/env python3\n'+
            'import json,os,sys\n'+
            f'log={str(cls.log)!r}\n'+
            "with open(log,'a') as f: f.write(json.dumps({'args':sys.argv[1:],'env':dict(os.environ),'cwd':os.getcwd()})+'\\n')\n"+
            f"if sys.argv[1:] == ['--version']: print('10.9.9' if os.path.exists({str(cls.work/'old-npm')!r}) else '11.5.1'); sys.exit(0)\n"+
            "if sys.argv[1] == 'publish':\n"+
            f" sys.exit(1 if os.path.exists({str(cls.work/'deny')!r}) else 0)\n"+
            "print('unexpected npm call',file=sys.stderr);sys.exit(98)\n")
        (cls.shim/'npm').chmod(0o755)
        cls.hosted = {**cls.env, 'PATH': str(cls.shim)+':'+cls.env['PATH'],
                      'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'GITHUB_SHA': cls.sha,
                      'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': 'epistemedeus/agent-payment-policy',
                      'GITHUB_WORKFLOW_REF': 'epistemedeus/agent-payment-policy/.github/workflows/optional-mcp-release.yml@refs/heads/main',
                      'ACTIONS_ID_TOKEN_REQUEST_URL': 'https://oidc.invalid', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN': 'synthetic-test',
                      'NODE_AUTH_TOKEN': 'synthetic-never-forward', 'NPM_TOKEN': 'synthetic-never-forward',
                      'npm_config_registry': 'https://wrong.invalid'}

    @classmethod
    def command(cls, action, output=None, source=None, version='0.1.0', digest=None, env=None, cwd=None):
        args = ['python3', str(cls.helper), action, '--source', source or cls.sha, '--version', version,
                '--output', str(output or cls.output)]
        if digest is not None: args += ['--sha256', digest]
        return subprocess.run(args, cwd=cwd or cls.root, env=env or cls.env, capture_output=True, text=True, timeout=90)

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def test_real_pack(self):
        self.assertEqual(self.receipt['package'], '@epistemedeus/agent-payment-policy-mcp')
        self.assertEqual(len(json.loads((self.output/'pack-inspection.json').read_text())['packedFiles']), 15)
        self.assertEqual(self.receipt['source'], self.sha)

    def test_wrong_source(self): self.assertNotEqual(self.command('prepare', source='0'*40).returncode, 0)
    def test_shell_source(self): self.assertNotEqual(self.command('prepare', source='$(touch /tmp/mcp-release-injection)').returncode, 0)
    def test_wrong_version(self): self.assertNotEqual(self.command('prepare', version='0.1.1').returncode, 0)
    def test_wrong_cwd(self): self.assertNotEqual(self.command('prepare', cwd=self.repo).returncode, 0)
    def test_stale_output(self): self.assertNotEqual(self.command('prepare').returncode, 0)
    def test_inside_output(self): self.assertNotEqual(self.command('prepare', self.root/'new-output').returncode, 0)
    def test_missing_digest(self): self.assertNotEqual(self.command('publish').returncode, 0)
    def test_wrong_digest(self): self.assertNotEqual(self.command('publish', digest='0'*64).returncode, 0)
    def test_missing_oidc(self): self.assertNotEqual(self.command('publish', digest=self.digest).returncode, 0)
    def test_missing_oidc_token(self):
        env = {**self.hosted}; del env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
        self.assertNotEqual(self.command('publish', digest=self.digest, env=env).returncode, 0)
    def test_wrong_hosted_source(self):
        self.assertNotEqual(self.command('publish', digest=self.digest, env={**self.hosted, 'GITHUB_SHA': '0'*40}).returncode, 0)
    def test_self_hosted_refuses(self):
        self.assertNotEqual(self.command('publish', digest=self.digest, env={**self.hosted, 'RUNNER_ENVIRONMENT': 'self-hosted'}).returncode, 0)
    def test_old_npm_refuses_before_publish(self):
        marker = self.work/'old-npm'; marker.touch()
        self.log.unlink(missing_ok=True)
        try:
            self.assertNotEqual(self.command('publish', digest=self.digest, env=self.hosted).returncode, 0)
        finally: marker.unlink()
        self.assertEqual([json.loads(s)['args'] for s in self.log.read_text().splitlines()], [['--version']])
    def test_wrong_workflow(self):
        self.assertNotEqual(self.command('publish', digest=self.digest, env={**self.hosted, 'GITHUB_WORKFLOW_REF': 'wrong'}).returncode, 0)
    def test_wrong_package_clean_source(self):
        repo = self.work/'wrong-package-repo'
        shutil.copytree(self.repo, repo, ignore=shutil.ignore_patterns('.git'))
        root = repo/'integrations/mcp'
        pkg = root/'package.json'; p = json.loads(pkg.read_text()); p['name'] += '-wrong'; pkg.write_text(json.dumps(p))
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=repo, env=self.env, text=True).strip()
        git('init', '-q'); git('add', '.')
        git('-c', 'user.name=Release Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'wrong package')
        result = subprocess.run(['python3', str(root/'scripts/npm-release.py'), 'prepare',
            '--source', git('rev-parse', 'HEAD'), '--version', '0.1.0', '--output', str(self.work/'wrong-pack')],
            cwd=root, env=self.env, capture_output=True, text=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('package name differs from release identity', result.stderr)
        self.assertFalse((self.work/'wrong-pack').exists())
    def test_dirty_package(self):
        pkg = self.root/'package.json'; original = pkg.read_bytes()
        try:
            p = json.loads(original); p['name'] += '-wrong'; pkg.write_text(json.dumps(p))
            self.assertNotEqual(self.command('publish', digest=self.digest, env=self.hosted).returncode, 0)
        finally: pkg.write_bytes(original)
    def test_tamper_receipt(self):
        p = self.output/'release.json'; original = p.read_bytes()
        try:
            r = json.loads(original); r['source'] = '0'*40; p.write_text(json.dumps(r))
            self.assertNotEqual(self.command('publish', digest=self.digest, env=self.hosted).returncode, 0)
        finally: p.write_bytes(original)
    def test_tamper_archive(self):
        p = self.output/self.receipt['archive']['filename']; original = p.read_bytes()
        try:
            p.write_bytes(original+b'tamper')
            self.assertNotEqual(self.command('publish', digest=self.digest, env=self.hosted).returncode, 0)
        finally: p.write_bytes(original)
    def test_unconfigured_authority_then_recovery(self):
        self.log.unlink(missing_ok=True)
        deny = self.work/'deny'; deny.touch()
        try:
            self.assertNotEqual(self.command('publish', digest=self.digest, env=self.hosted).returncode, 0)
        finally: deny.unlink()
        self.assertEqual(self.command('publish', digest=self.digest, env=self.hosted).returncode, 0)
        calls = [json.loads(s) for s in self.log.read_text().splitlines()]
        publishes = [c for c in calls if c['args'][0] == 'publish']
        self.assertEqual(len(publishes), 2)  # One failure, one explicit recovery invocation; no internal retry.
        for c in publishes:
            self.assertEqual(c['args'][1], str(self.output/self.receipt['archive']['filename']))
            self.assertIn('--provenance', c['args']); self.assertIn('--ignore-scripts', c['args'])
            self.assertNotIn('NODE_AUTH_TOKEN', c['env']); self.assertNotIn('NPM_TOKEN', c['env'])
            self.assertEqual(c['env']['npm_config_registry'], 'https://registry.npmjs.org')
            self.assertNotEqual(c['cwd'], str(self.root))


class Receiver(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mcp-receiver-test-')
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name)
        self.archive = self.work/'reviewed.tgz'
        self.archive.write_bytes(b'boundary fixture; actual pack tested separately')
        spec = importlib.util.spec_from_file_location('receiver', SOURCE/'scripts/npm-receive.py')
        self.receiver = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.receiver)
        data = self.archive.read_bytes()
        self.meta = {'name': '@epistemedeus/agent-payment-policy-mcp', 'version': '0.1.0',
                     'dist': {'integrity': 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode(),
                              'attestations': {'url': 'https://registry.npmjs.org/fixture'}}}
        self.calls = []; self.mode = 'ok'

    def boundary(self, argv, **kw):
        self.calls.append((argv, kw))
        self.assertEqual(kw['env']['npm_config_registry'], 'https://registry.npmjs.org')
        self.assertNotIn('NODE_AUTH_TOKEN', kw['env'])
        self.assertEqual(kw['env']['npm_config_ignore_scripts'], 'true')
        if argv[0] == 'npm' and argv[1] == 'view':
            if self.mode == '404': return subprocess.CompletedProcess(argv, 1, '', 'npm error code E404')
            return subprocess.CompletedProcess(argv, 0, json.dumps(self.meta), '')
        if argv[0] == 'npm' and argv[1] == 'pack':
            filename = 'epistemedeus-agent-payment-policy-mcp-0.1.0.tgz'
            (Path(kw['cwd'])/filename).write_bytes(self.archive.read_bytes() if self.mode != 'bytes' else b'wrong bytes')
            return subprocess.CompletedProcess(argv, 0, json.dumps([{'filename': filename}]), '')
        self.assertEqual(Path(argv[1]).name, 'cold-receive.py')
        self.assertIn('--public-version', argv); self.assertIn('--focused', argv)
        return subprocess.CompletedProcess(argv, 1 if self.mode == 'sdk-failure' else 0, '', '')

    def receive(self, label='out'):
        with patch.object(self.receiver.subprocess, 'run', self.boundary):
            return self.receiver.receive(self.archive, self.work/label)

    def test_404_stops_without_pack_or_sdk(self):
        self.mode = '404'
        with self.assertRaises(RuntimeError): self.receive()
        r = json.loads((self.work/'out/npm-receipt.json').read_text())
        self.assertTrue(r['failure']['npm404']); self.assertFalse(r['fallback'])
        self.assertEqual(len(self.calls), 1)

    def test_metadata_identity_refuses(self):
        self.meta['name'] = 'wrong'
        with self.assertRaises(AssertionError): self.receive()
        self.assertEqual(len(self.calls), 1)

    def test_integrity_refuses_before_sdk(self):
        self.meta['dist']['integrity'] = 'sha512-wrong'
        with self.assertRaises(AssertionError): self.receive()
        self.assertEqual(len(self.calls), 2)

    def test_changed_archive_refuses_before_sdk(self):
        self.mode = 'bytes'
        data = b'wrong bytes'
        self.meta['dist']['integrity'] = 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()
        with self.assertRaises(AssertionError): self.receive()
        self.assertEqual(len(self.calls), 2)

    def test_downstream_verification_failure_is_not_success(self):
        self.mode = 'sdk-failure'
        with self.assertRaises(AssertionError): self.receive()
        self.assertFalse(json.loads((self.work/'out/npm-receipt.json').read_text())['ok'])

    def test_explicit_recovery_uses_fresh_home(self):
        self.mode = '404'
        with self.assertRaises(RuntimeError): self.receive('failure')
        old_home = self.calls[0][1]['env']['HOME']
        self.calls = []; self.mode = 'ok'
        r = self.receive('recovery')
        self.assertTrue(r['ok']); self.assertEqual(len(self.calls), 3)
        self.assertNotEqual(old_home, self.calls[0][1]['env']['HOME'])
        self.assertEqual(r['attestations'], self.meta['dist']['attestations'])


if __name__ == '__main__': unittest.main(verbosity=2)
