import type { ReactNode } from "react";

type InlineMarkdownProps = {
  text: string;
};

/**
 * Renderiza el subconjunto de Markdown que aparece en el banco de preguntas.
 * Al devolver nodos React en vez de HTML, el contenido se mantiene seguro aun
 * cuando el texto provenga de un archivo de preguntas editado localmente.
 */
export default function InlineMarkdown({ text }: InlineMarkdownProps) {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`+[^`]+`+|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|(?<!\w)_[^_]+_(?!\w))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  const appendPlainText = (value: string) => {
    value.split("\n").forEach((line, lineIndex) => {
      if (lineIndex > 0) nodes.push(<br key={`break-${key++}`} />);
      if (line) nodes.push(line);
    });
  };

  while ((match = tokenPattern.exec(text)) !== null) {
    appendPlainText(text.slice(lastIndex, match.index));
    const token = match[0];

    if (token.startsWith("`")) {
      nodes.push(
        <code className="inline-code" key={`code-${key++}`}>
          {token.replace(/^`+|`+$/g, "")}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={`strong-${key++}`}>{token.slice(2, -2)}</strong>,
      );
    } else if (token.startsWith("~~")) {
      nodes.push(<del key={`del-${key++}`}>{token.slice(2, -2)}</del>);
    } else {
      nodes.push(<em key={`em-${key++}`}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  appendPlainText(text.slice(lastIndex));
  return <>{nodes}</>;
}
