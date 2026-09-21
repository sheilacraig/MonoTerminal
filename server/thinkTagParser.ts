/**
 * Streaming parser that splits model output into visible content and
 * "thinking" (reasoning) segments delimited by <think> / </think> tags.
 *
 * Why a state machine: SSE deltas arrive in arbitrary chunks, so a tag may
 * be split across boundaries (e.g. "<thi" in one delta, "nk>" in the next).
 * A naive `text.includes('<think>')` check per chunk loses or misroutes such
 * fragments. This parser buffers any trailing partial-tag suffix and resolves
 * it once more text arrives (or at flush time).
 *
 * Delimiter semantics are STRICT and asymmetric:
 *   • `<think>` sets insideThink = true
 *   • `</think>` sets insideThink = false
 *
 * Rationale: the previous implementation toggled the flag on either tag, so a
 * stray `</think>` emitted by the model (a common artefact when the reasoning
 * trace is post-processed or truncated) would flip the parser INTO thinking
 * mode and route all subsequent real answer content into the reasoning pane.
 * With strict semantics, an unmatched close tag is a no-op (it cannot enter
 * thinking mode on its own) and the following text stays as content.
 */

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

export interface ThinkParseSegment {
  content: string;
  thinking: string;
}

/**
 * Length of the longest suffix of `text` that is a proper (incomplete)
 * prefix of `tag`. Returns 0 when no suffix could grow into the tag.
 */
function partialTagSuffixLength(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

export class ThinkTagParser {
  private insideThink = false;
  private pending = '';

  /**
   * Feed one streamed delta. Returns the content/thinking text resolved so
   * far; either field may be an empty string. Text that could still become
   * a tag is retained internally until the next feed/flush.
   */
  public feed(text: string): ThinkParseSegment {
    this.pending += text;

    let content = '';
    let thinking = '';

    for (;;) {
      // Either delimiter may appear in either state — find the earliest one
      const openIdx = this.pending.indexOf(OPEN_TAG);
      const closeIdx = this.pending.indexOf(CLOSE_TAG);

      let idx = -1;
      let tagLength = 0;
      if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
        idx = openIdx;
        tagLength = OPEN_TAG.length;
      } else if (closeIdx !== -1) {
        idx = closeIdx;
        tagLength = CLOSE_TAG.length;
      }

      if (idx !== -1) {
        // Complete tag found: emit everything before it under the CURRENT
        // mode, then transition based on WHICH tag matched (strict, not a
        // toggle). Unmatched close tags in content mode are effectively
        // no-ops; unmatched open tags in thinking mode are also no-ops.
        const before = this.pending.slice(0, idx);
        if (this.insideThink) {
          thinking += before;
        } else {
          content += before;
        }
        this.pending = this.pending.slice(idx + tagLength);
        // `idx` was resolved from openIdx/closeIdx above; recompute which tag
        // won to set the state deterministically instead of toggling.
        this.insideThink = idx === openIdx;
        continue;
      }

      // No complete tag: emit everything except a trailing fragment that
      // could still grow into EITHER tag
      const hold = Math.max(
        partialTagSuffixLength(this.pending, OPEN_TAG),
        partialTagSuffixLength(this.pending, CLOSE_TAG)
      );
      const emitLength = this.pending.length - hold;
      if (emitLength > 0) {
        const emit = this.pending.slice(0, emitLength);
        if (this.insideThink) {
          thinking += emit;
        } else {
          content += emit;
        }
        this.pending = this.pending.slice(emitLength);
      }
      break;
    }

    return { content, thinking };
  }

  /**
   * Signal end-of-stream. Any retained fragment is now known to be ordinary
   * text (the tag never completed), so it is emitted in the current mode.
   */
  public flush(): ThinkParseSegment {
    const rest = this.pending;
    this.pending = '';
    return this.insideThink ? { content: '', thinking: rest } : { content: rest, thinking: '' };
  }
}
