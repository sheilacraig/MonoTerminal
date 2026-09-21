import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { ActionableCodeblock } from './ActionableCodeblock';

/**
 * Lazy-loaded Markdown renderer for agent messages.
 *
 * react-markdown + remark-gfm + rehype-highlight (which pulls in lowlight /
 * highlight.js) are heavy, so this component lives in its own chunk and is
 * loaded on demand via React.lazy in AgentView — keeping them out of the
 * initial bundle. The highlight.js theme CSS is imported here so it ships
 * with this chunk rather than the main stylesheet.
 */

interface MessageMarkdownProps {
  content: string;
  commandExplanations: Record<string, string>;
  onRun: (code: string) => void;
  onFill: (code: string) => void;
  onExplain: (code: string) => void;
}

/** Languages treated as runnable shell commands (rendered as action cards). */
const SHELL_LANGS = new Set(['bash', 'shell', 'sh', 'zsh', 'console', 'shell-session']);

/** Recursively pull raw text out of a (possibly syntax-highlighted) React node. */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

const MessageMarkdown: React.FC<MessageMarkdownProps> = ({
  content,
  commandExplanations,
  onRun,
  onFill,
  onExplain
}) => {
  // Full Markdown rendering (headings, lists, tables, emphasis, code) via
  // react-markdown. Fenced shell blocks become actionable command cards; any
  // other language renders as a read-only syntax-highlighted block.
  const components: Components = {
    pre: ({ children }) => {
      const codeEl = React.Children.toArray(children).find(React.isValidElement);
      if (!codeEl) return <pre className="my-2 whitespace-pre-wrap">{children}</pre>;

      const codeProps = codeEl.props as { className?: string; children?: React.ReactNode };
      const className = codeProps.className ?? '';
      const langMatch = /language-([\w-]+)/.exec(className);
      const lang = langMatch ? langMatch[1] : 'bash';
      const rawCode = extractText(codeProps.children).replace(/\n$/, '');

      // No info string, or a shell dialect → runnable command card
      if (!langMatch || SHELL_LANGS.has(lang.toLowerCase())) {
        return (
          <ActionableCodeblock
            code={rawCode}
            lang={lang}
            explanation={commandExplanations[rawCode]}
            onRun={onRun}
            onFill={onFill}
            onExplain={onExplain}
          >
            {codeProps.children}
          </ActionableCodeblock>
        );
      }

      // Any other language → read-only highlighted block
      return (
        <pre className="my-3 rounded-lg border border-orca-border bg-[#0a0d12] p-3 overflow-x-auto">
          <code className={`hljs text-xs font-mono leading-5 ${className}`}>{codeProps.children}</code>
        </pre>
      );
    },
    p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-1">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    h1: ({ children }) => <h1 className="text-sm font-bold mt-3 mb-1.5 text-white">{children}</h1>,
    h2: ({ children }) => <h2 className="text-xs font-bold mt-3 mb-1.5 text-white">{children}</h2>,
    h3: ({ children }) => <h3 className="text-xs font-semibold mt-2 mb-1 text-orca-text">{children}</h3>,
    h4: ({ children }) => <h4 className="text-xs font-semibold mt-2 mb-1 text-orca-text">{children}</h4>,
    strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
    a: ({ children, href }) => (
      <a className="text-orca-accent underline hover:text-blue-400" href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 pl-3 border-l-2 border-orca-border text-orca-muted italic">{children}</blockquote>
    ),
    hr: () => <hr className="my-3 border-orca-border" />,
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="min-w-full border-collapse text-[11px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-orca-border bg-orca-card px-2 py-1 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => <td className="border border-orca-border px-2 py-1">{children}</td>
  };

  return (
    <div className="agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MessageMarkdown;
