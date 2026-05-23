// Tiny dependency-free markdown renderer.
// Handles fenced code blocks, inline `code`, **bold**, *italic*, paragraphs,
// unordered lists. Good enough for LLM chat output. Swap to react-markdown
// if we ever need tables / links / nested structure.

import { useMemo, type ReactNode } from 'react';

interface Block {
  kind: 'p' | 'ul' | 'code';
  lang?: string;
  text?: string;
  items?: string[];
}

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ kind: 'code', lang, text: body.join('\n') });
      continue;
    }

    // bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // paragraph (collect until blank line)
    if (line.trim() === '') {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !/^\s*[-*]\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ kind: 'p', text: para.join('\n') });
  }
  return blocks;
}

function inline(text: string): ReactNode[] {
  // Bold + italic + inline code, applied in that order.
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  const re = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/;
  while (rest) {
    const m = re.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    if (m[2] !== undefined) out.push(<code key={key++}>{m[2]}</code>);
    else if (m[4] !== undefined) out.push(<strong key={key++}>{m[4]}</strong>);
    else if (m[6] !== undefined) out.push(<em key={key++}>{m[6]}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export default function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parse(source), [source]);

  return (
    <div className="markdown">
      {blocks.map((b, i) => {
        if (b.kind === 'code') {
          return (
            <pre key={i} className="md-code">
              {b.lang && <span className="md-code-lang">{b.lang}</span>}
              <code>{b.text}</code>
            </pre>
          );
        }
        if (b.kind === 'ul') {
          return (
            <ul key={i} className="md-list">
              {b.items!.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(b.text!)}</p>;
      })}
    </div>
  );
}
