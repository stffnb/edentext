// Runs a function as a task of its own through a message channel, in the order asked: unlike
// a timer's, it is not held back while the tab is hidden.
const queue: (() => void)[] = [];
let port: MessagePort | null = null;

export function task(fn: () => void): void {
  if (typeof MessageChannel !== 'function') { setTimeout(fn); return; }
  if (!port) {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => queue.shift()?.();
    port = channel.port2;
  }
  queue.push(fn);
  port.postMessage(0);
}
