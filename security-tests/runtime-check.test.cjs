const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../runtime-check.cjs'), 'utf8');
for (const [version, accepted] of [['24.22.0',false],['24.22.1',true],['24.22.2',true],['24.23.0',true],['20.20.2',false]]) {
  test(`runner Node ${version} is ${accepted ? 'accepted' : 'rejected'}`, () => {
    let rejected = false;
    try { vm.runInNewContext(source, {process:{versions:{node:version},exit(){throw new Error('rejected')}}, console:{error(){}}}); }
    catch (error) { assert.equal(error.message, 'rejected'); rejected = true; }
    assert.equal(!rejected, accepted);
  });
}
