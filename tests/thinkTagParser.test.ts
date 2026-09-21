import { describe, it, expect } from 'vitest';
import { ThinkTagParser } from '../server/thinkTagParser';

// IMPORTANT: the tag strings below are assembled from fragments at runtime on
// purpose. Emitting the full literal close-tag sequence into this source file
// gets rewritten by the agent tooling pipeline (harness protocol tag
// normalization), which silently corrupted an earlier version of these tests
// in a way that was invisible in displayed output. Do not "simplify" these
// into inline literals.
const OPEN = '<' + 'think' + '>';
const CLOSE = '</' + 'think' + '>';

/** Feed chunks in order, then flush; return the reassembled segments. */
function run(chunks: string[]) {
  const parser = new ThinkTagParser();
  let content = '';
  let thinking = '';
  for (const chunk of chunks) {
    const seg = parser.feed(chunk);
    content += seg.content;
    thinking += seg.thinking;
  }
  const finalSeg = parser.flush();
  content += finalSeg.content;
  thinking += finalSeg.thinking;
  return { content, thinking };
}

describe('ThinkTagParser', () => {
  it('passes plain text through as content', () => {
    const { content, thinking } = run(['hello ', 'world']);
    expect(content).toBe('hello world');
    expect(thinking).toBe('');
  });

  it('handles complete tags within a single chunk', () => {
    const { content, thinking } = run([`before${OPEN}reasoning${CLOSE}after`]);
    expect(content).toBe('beforeafter');
    expect(thinking).toBe('reasoning');
  });

  it('reassembles a tag split across chunk boundaries', () => {
    const { content, thinking } = run(['answer<thi', 'nk>deep thou', `ght${CLOSE}final`]);
    expect(content).toBe('answerfinal');
    expect(thinking).toBe('deep thought');
  });

  it('survives worst-case single-character chunking', () => {
    const text = `a${OPEN}t1\n${CLOSE}b${OPEN}t2${CLOSE}c`;
    const { content, thinking } = run(text.split(''));
    expect(content).toBe('abc');
    expect(thinking).toBe('t1\nt2');
  });

  it('handles multiple think/answer alternations', () => {
    const { content, thinking } = run([
      OPEN,
      'step 1',
      CLOSE,
      'reply 1',
      `${OPEN}step 2${CLOSE}`,
      'reply 2'
    ]);
    expect(content).toBe('reply 1reply 2');
    expect(thinking).toBe('step 1step 2');
  });

  it('treats a stray leading close tag as a no-op, not as a mode flip', () => {
    // Strict semantics: `</think>` sets insideThink = false. When we are
    // already outside thinking mode, an unmatched close tag must NOT flip
    // the parser INTO thinking mode — the following text stays as content.
    const { content, thinking } = run([`${CLOSE}never closed`]);
    expect(content).toBe('never closed');
    expect(thinking).toBe('');
  });

  // Regression: the previous implementation used `insideThink = !insideThink`
  // on any tag, so a stray close tag before the real answer would route all
  // subsequent visible content into the thinking pane.
  it('does not misroute real content into thinking after a stray close tag', () => {
    const { content, thinking } = run([
      `${CLOSE}Here is the actual answer.`,
      ` Run \`systemctl status nginx\` to verify.`
    ]);
    expect(thinking).toBe('');
    expect(content).toBe('Here is the actual answer. Run `systemctl status nginx` to verify.');
  });

  it('ignores duplicate open tags while already inside thinking mode', () => {
    // Nested or repeated <think> must not toggle us out of thinking mode.
    const { content, thinking } = run([`${OPEN}first${OPEN}second${CLOSE}answer`]);
    expect(thinking).toBe('firstsecond');
    expect(content).toBe('answer');
  });

  it('ignores duplicate close tags while already in content mode', () => {
    const { content, thinking } = run([`${OPEN}thought${CLOSE}answer${CLOSE}more`]);
    expect(thinking).toBe('thought');
    expect(content).toBe('answermore');
  });

  it('does not swallow angle brackets that are not tags', () => {
    const { content, thinking } = run(['run: kill -15 <PID>, then a < b', ' and 5<6']);
    expect(content).toBe('run: kill -15 <PID>, then a < b and 5<6');
    expect(thinking).toBe('');
  });

  it('emits a trailing partial-tag fragment on flush (content mode)', () => {
    // Stream ends with "<th" — it never became a tag, so it is plain text
    const { content, thinking } = run(['value: <th']);
    expect(content).toBe('value: <th');
    expect(thinking).toBe('');
  });

  it('holds back a possible tag prefix until disambiguated', () => {
    const parser = new ThinkTagParser();
    // "<thi" could still become the opening tag — nothing may be emitted yet
    const seg1 = parser.feed('text<thi');
    expect(seg1.content).toBe('text');
    expect(seg1.thinking).toBe('');
    // Disambiguated: it was NOT a tag after all
    const seg2 = parser.feed('ck>');
    expect(seg2.content).toBe('<thick>');
    const seg3 = parser.flush();
    expect(seg3.content).toBe('');
  });

  it('handles empty feeds without emitting anything', () => {
    const parser = new ThinkTagParser();
    expect(parser.feed('')).toEqual({ content: '', thinking: '' });
    expect(parser.flush()).toEqual({ content: '', thinking: '' });
  });
});
