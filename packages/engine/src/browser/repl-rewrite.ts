import type { Pattern, Program } from 'acorn';
import { parse } from 'acorn';

/**
 * Rewrites model-authored REPL code so top-level bindings survive across `execute` calls
 * (the Node REPL top-level-await strategy, `internal/repl/await.js`): the code still runs
 * inside an async IIFE so `await` works, but top-level `const`/`let`/`var`/`function`/`class`
 * declarations are converted to assignments against hoisted `var`s declared OUTSIDE the
 * wrapper — script-level `var` in a vm context lands on the context global, so the next
 * `execute` call sees the binding.
 *
 * Code acorn cannot parse is returned wrapped but untouched, so the vm surfaces the real
 * syntax error to the model instead of a transform error.
 */
export function rewriteForPersistentRepl(code: string): string {
  let program: Program;
  try {
    program = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch {
    return wrap(code);
  }

  const hoisted: string[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];

  for (const node of program.body) {
    switch (node.type) {
      case 'VariableDeclaration': {
        if (node.kind === 'using' || node.kind === 'await using') break;
        const assignments = node.declarations.map((d) => {
          collectPatternNames(d.id, hoisted);
          const target = code.slice(d.id.start, d.id.end);
          return d.init
            ? `(${target} = ${code.slice(d.init.start, d.init.end)})`
            : `(${target} = undefined)`;
        });
        edits.push({ start: node.start, end: node.end, text: `void (${assignments.join(', ')});` });
        break;
      }
      case 'FunctionDeclaration':
      case 'ClassDeclaration': {
        hoisted.push(node.id.name);
        edits.push({
          start: node.start,
          end: node.end,
          text: `${node.id.name} = (${code.slice(node.start, node.end)});`,
        });
        break;
      }
      default:
        break;
    }
  }

  let rewritten = code;
  for (const edit of edits.reverse()) {
    rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  }
  const prelude = hoisted.length > 0 ? `var ${hoisted.join(', ')};\n` : '';
  return prelude + wrap(rewritten);
}

function wrap(body: string): string {
  return `(async () => {\n${body}\n})()`;
}

function collectPatternNames(pattern: Pattern, names: string[]): void {
  switch (pattern.type) {
    case 'Identifier':
      names.push(pattern.name);
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        collectPatternNames(property.type === 'RestElement' ? property : property.value, names);
      }
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element) collectPatternNames(element, names);
      }
      break;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, names);
      break;
    case 'RestElement':
      collectPatternNames(pattern.argument, names);
      break;
    default:
      // MemberExpression targets have no binding to hoist.
      break;
  }
}
