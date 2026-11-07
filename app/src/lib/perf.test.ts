// Run: node src/lib/perf.test.ts
import assert from 'node:assert/strict';
import { isSoftware, perf, setPerf, keyCap, gpuFor } from './perf.ts';

assert.ok(isSoftware('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'));
assert.ok(isSoftware('llvmpipe (LLVM 15.0.7, 256 bits)'));
assert.ok(isSoftware('Microsoft Basic Render Driver'));
assert.ok(!isSoftware('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'));
assert.ok(!isSoftware('Apple M2'));

assert.equal(perf.accel, 'auto');
setPerf({ accel: 'cpu' });
assert.equal(gpuFor.key(), false);
assert.equal(gpuFor.whisper(), false);
assert.equal(keyCap(), 1280); // CPU key keeps the cap
setPerf({ keyRes: 720 });
assert.equal(keyCap(), 720);

console.log('perf ok');
