const { execFileSync } = require('node:child_process');

function runNodeScript(scriptPath) {
  console.log(`\n> node ${scriptPath}`);
  execFileSync(process.execPath, [scriptPath], { stdio: 'inherit' });
}

function main() {
  runNodeScript('tests/run-tests.js');
  runNodeScript('scripts/smoke-check.js');
  console.log('\nRelease check passed. You can now commit, version, and push.');
}

try {
  main();
} catch (error) {
  console.error(`\nRelease check failed: ${error.message}`);
  process.exit(1);
}
