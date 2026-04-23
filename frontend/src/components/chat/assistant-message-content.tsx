import type { ReactNode } from 'react';

type InlineToken = {
  index: number;
  length: number;
  content: string;
  type: 'bold' | 'boldItalic' | 'code' | 'italic';
};

function findNextInlineToken(text: string): InlineToken | null {
  const patterns: Array<{
    type: InlineToken['type'];
    regex: RegExp;
  }> = [
    { type: 'code', regex: /`([^`]+)`/ },
    { type: 'boldItalic', regex: /\*\*\*([\s\S]+?)\*\*\*/ },
    { type: 'bold', regex: /\*\*([\s\S]+?)\*\*/ },
    { type: 'italic', regex: /\*([^*\n]+?)\*/ },
  ];

  return patterns.reduce<InlineToken | null>((nextToken, pattern) => {
    const match = pattern.regex.exec(text);
    if (!match || match.index < 0) {
      return nextToken;
    }

    const token = {
      index: match.index,
      length: match[0].length,
      content: match[1] ?? '',
      type: pattern.type,
    };

    if (!nextToken || token.index < nextToken.index) {
      return token;
    }

    if (token.index === nextToken.index && token.length > nextToken.length) {
      return token;
    }

    return nextToken;
  }, null);
}

function renderInlineToken(token: InlineToken, key: string) {
  switch (token.type) {
    case 'bold':
      return <strong key={key} className="font-bold text-white">{parseInlineMarkdown(token.content, key)}</strong>;
    case 'boldItalic':
      return <strong key={key} className="font-bold text-white"><em>{parseInlineMarkdown(token.content, key)}</em></strong>;
    case 'code':
      return (
        <code key={key} className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[0.85em] text-primary">
          {token.content}
        </code>
      );
    case 'italic':
      return <em key={key}>{parseInlineMarkdown(token.content, key)}</em>;
    default:
      return token.content;
  }
}

function parseInlineMarkdown(text: string, keyPrefix = 'inline'): ReactNode[] {
  const disclaimerMatch = /^\*\*\*([^*]+?):\*\*\s*([\s\S]+)\*$/.exec(text.trim());
  if (disclaimerMatch) {
    return [
      <em key={`${keyPrefix}-disclaimer`}>
        <strong className="font-bold text-white">{disclaimerMatch[1]}:</strong> {disclaimerMatch[2]}
      </em>,
    ];
  }

  const nodes: ReactNode[] = [];
  let remaining = text;
  let index = 0;

  while (remaining.length > 0) {
    const token = findNextInlineToken(remaining);

    if (!token) {
      nodes.push(remaining);
      break;
    }

    if (token.index > 0) {
      nodes.push(remaining.slice(0, token.index));
    }

    nodes.push(renderInlineToken(token, `${keyPrefix}-${index}`));
    remaining = remaining.slice(token.index + token.length);
    index += 1;
  }

  return nodes;
}

function renderParagraph(lines: string[], key: string) {
  return (
    <p key={key} className="whitespace-pre-wrap">
      {lines.map((line, index) => (
        <span key={`${key}-${index}`}>
          {index > 0 && '\n'}
          {parseInlineMarkdown(line, `${key}-${index}`)}
        </span>
      ))}
    </p>
  );
}

export function AssistantMessageContent({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const paragraphLines: string[] = [];
  let listItems: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return;
    }

    blocks.push(renderParagraph([...paragraphLines], `paragraph-${blocks.length}`));
    paragraphLines.length = 0;
  }

  function flushList() {
    if (listItems.length === 0) {
      return;
    }

    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-5">
        {listItems.map((item, index) => (
          <li key={`list-${blocks.length}-${index}`}>{parseInlineMarkdown(item, `list-${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  for (const line of content.split('\n')) {
    const trimmedLine = line.trim();
    const bulletMatch = /^\*\s+(.+)$/.exec(trimmedLine) ?? /^-\s+(.+)$/.exec(trimmedLine);

    if (!trimmedLine) {
      flushParagraph();
      flushList();
      continue;
    }

    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return <div className="space-y-3">{blocks.length > 0 ? blocks : null}</div>;
}
