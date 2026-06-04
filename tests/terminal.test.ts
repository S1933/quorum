import { describe, expect, test } from 'bun:test';
import { InMemoryEventBus } from '../src/runtime/bus.ts';
import { TerminalRenderer, sanitizeTerminalText } from '../src/ui/terminal.ts';

describe('terminal output hardening', () => {
  test('strips ansi and control characters from untrusted text', () => {
    expect(sanitizeTerminalText('\x1b[31mred\x1b[0m\x07\x1b]0;title\x07plain')).toBe('redplain');
  });

  test('sanitizes streamed token previews before rendering', () => {
    let output = '';
    const bus = new InMemoryEventBus();
    const renderer = new TerminalRenderer({
      color: false,
      showTokens: true,
      stream: { write(chunk) { output += chunk; } },
    });
    const detach = renderer.attach(bus);

    bus.emit({
      type: 'reviewer.event',
      reviewerId: 'sec\x1b[31m',
      event: { type: 'token', text: '\x1b[2J{"findings":[]}\x07' },
    });
    detach();

    expect(output).toContain('[sec]');
    expect(output).toContain('{"findings":[]}');
    expect(output).not.toContain('\x1b');
    expect(output).not.toContain('\x07');
  });
});
