import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export function fakeSpawn({ stdout = '', stderr = '', code = 0, hang = false } = {}) {
  const calls = [];
  const fn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    const call = { bin, args, opts, stdin: '', child };
    calls.push(call);
    const respond = () => {
      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', code));
    };
    child.stdin = {
      on() {},
      end(data) { call.stdin = data ?? ''; if (!hang) setImmediate(respond); },
    };
    return child;
  };
  fn.calls = calls;
  return fn;
}
