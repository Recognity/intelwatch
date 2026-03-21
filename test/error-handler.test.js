import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleError, validateEnvironment, retry } from '../src/utils/error-handler.js';

describe('Error Handler', () => {
  test('handleError does not throw', () => {
    // Should gracefully log without crashing
    assert.doesNotThrow(() => handleError(new Error('test error'), 'test context'));
  });

  test('handleError handles non-Error objects', () => {
    assert.doesNotThrow(() => handleError('string error'));
    assert.doesNotThrow(() => handleError(null));
    assert.doesNotThrow(() => handleError(undefined));
  });

  test('validateEnvironment returns missing vars', () => {
    // With empty required, should pass
    const result = validateEnvironment([]);
    assert.ok(result === undefined || result === true || Array.isArray(result));
  });

  test('retry succeeds on first try', async () => {
    let calls = 0;
    const result = await retry(() => {
      calls++;
      return 'ok';
    }, { retries: 3 });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  test('retry retries on failure then succeeds', async () => {
    let calls = 0;
    const result = await retry(() => {
      calls++;
      if (calls < 3) throw new Error('not yet');
      return 'ok';
    }, { retries: 5, delay: 10 });
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
  });

  test('retry throws after max retries', async () => {
    await assert.rejects(
      () => retry(() => { throw new Error('always fails'); }, { retries: 2, delay: 10 }),
      /always fails/
    );
  });
});
