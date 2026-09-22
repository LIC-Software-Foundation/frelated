export interface ExtractedLatexText {
  text: string;
  sourceOffsets: number[];
}

const SKIPPED_ARGUMENT_COMMANDS = new Set([
  'begin',
  'bibliography',
  'bibliographystyle',
  'cite',
  'citep',
  'citet',
  'documentclass',
  'end',
  'eqref',
  'href',
  'include',
  'includegraphics',
  'input',
  'label',
  'pageref',
  'path',
  'ref',
  'url',
  'usepackage',
]);

const SKIPPED_ENVIRONMENTS = new Set([
  'align',
  'align*',
  'displaymath',
  'equation',
  'equation*',
  'gather',
  'gather*',
  'lstlisting',
  'math',
  'multline',
  'multline*',
  'verbatim',
  'verbatim*',
]);

const escaped = (source: string, index: number) => {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === '\\';
    cursor -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
};

const skipBalanced = (source: string, start: number) => {
  const opener = source[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === opener && !escaped(source, index)) depth += 1;
    if (source[index] === closer && !escaped(source, index)) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
};

const commandAt = (source: string, index: number) => {
  const match = /^\\([A-Za-z@]+\*?|.)/u.exec(source.slice(index));
  return match ? { name: match[1], end: index + match[0].length } : null;
};

const environmentAt = (source: string, index: number) => {
  const match = /^\\begin\s*\{([^{}]+)\}/u.exec(source.slice(index));
  return match ? { name: match[1], end: index + match[0].length } : null;
};

/** Extract prose while retaining a UTF-16 offset map back to the source. */
export const extractLatexText = (source: string): ExtractedLatexText => {
  const output: string[] = [];
  const sourceOffsets: number[] = [];
  const append = (character: string, sourceOffset: number) => {
    output.push(character);
    sourceOffsets.push(sourceOffset);
  };
  const separator = (sourceOffset: number) => {
    if (output.length > 0 && !/\s/u.test(output[output.length - 1])) {
      append(' ', sourceOffset);
    }
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '%' && !escaped(source, index)) {
      separator(index);
      const lineEnd = source.indexOf('\n', index);
      index = lineEnd < 0 ? source.length : lineEnd;
      continue;
    }
    if (character === '$' && !escaped(source, index)) {
      separator(index);
      const delimiter = source[index + 1] === '$' ? '$$' : '$';
      index += delimiter.length;
      while (index < source.length) {
        if (source.startsWith(delimiter, index) && !escaped(source, index)) {
          index += delimiter.length;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (source.startsWith('\\[', index) || source.startsWith('\\(', index)) {
      separator(index);
      const closer = source[index + 1] === '[' ? '\\]' : '\\)';
      const closeIndex = source.indexOf(closer, index + 2);
      index = closeIndex < 0 ? source.length : closeIndex + 2;
      continue;
    }
    if (character === '\\') {
      const environment = environmentAt(source, index);
      if (environment && SKIPPED_ENVIRONMENTS.has(environment.name)) {
        separator(index);
        const endToken = `\\end{${environment.name}}`;
        const endIndex = source.indexOf(endToken, environment.end);
        index = endIndex < 0 ? source.length : endIndex + endToken.length;
        continue;
      }
      const command = commandAt(source, index);
      if (!command) {
        index += 1;
        continue;
      }
      separator(index);
      index = command.end;
      if (SKIPPED_ARGUMENT_COMMANDS.has(command.name.replace(/\*$/u, ''))) {
        while (index < source.length) {
          while (/\s/u.test(source[index] ?? '')) index += 1;
          if (source[index] !== '[' && source[index] !== '{') break;
          index = skipBalanced(source, index);
        }
      } else {
        while (/\s/u.test(source[index] ?? '')) index += 1;
        if (source[index] === '[') index = skipBalanced(source, index);
      }
      continue;
    }
    if (character === '{' || character === '}' || character === '~') {
      separator(index);
      index += 1;
      continue;
    }
    append(character, index);
    index += 1;
  }
  return { text: output.join(''), sourceOffsets };
};

export const mapProofreadingRange = (
  extraction: ExtractedLatexText,
  offset: number,
  length: number,
) => {
  if (offset < 0 || length <= 0 || offset >= extraction.sourceOffsets.length) {
    return null;
  }
  const lastIndex = Math.min(
    extraction.sourceOffsets.length - 1,
    offset + length - 1,
  );
  return {
    from: extraction.sourceOffsets[offset],
    to: extraction.sourceOffsets[lastIndex] + 1,
  };
};
