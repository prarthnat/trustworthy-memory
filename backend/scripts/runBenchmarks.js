const { runAll } = require('../src/services/benchmarkRunner');

console.log('Running deterministic benchmarks...');
const report = runAll();

console.log(`Passed: ${report.passed}`);
console.log(`Failed: ${report.failed}`);
console.log(`Total: ${report.total}`);

if (report.failed > 0) {
  report.results.filter(r => r.status !== 'pass').forEach(r => {
    console.error(`❌ ${r.name}`);
    console.error(r.failures);
  });
  process.exit(1);
} else {
  console.log('✅ All benchmarks passed!');
  process.exit(0);
}
