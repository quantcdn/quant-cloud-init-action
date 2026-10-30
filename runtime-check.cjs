// CVE-2026-111497: JavaScript actions use the runner's embedded Node binary.
const version = process.versions.node.split('.').map(Number);
if (version[0] !== 24 || version[1] < 22 || (version[1] === 22 && version[2] < 1)) {
  console.error('::error::This Quant action requires patched runner Node 24.22.1 or later in Node 24. Update your GitHub Actions runner; setup-node does not update the action runtime.');
  process.exit(1);
}
