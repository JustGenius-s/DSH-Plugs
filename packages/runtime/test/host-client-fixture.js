import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

/** Load an installed host bundle without a browser, exposing only test subjects. */
export function loadHostClient(path, names, dependencies) {
  const source = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let factory
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'factory'
      && ts.isArrowFunction(node.initializer) && ts.isBlock(node.initializer.body)) {
      factory = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (factory === undefined) throw new Error(`No module factory in ${path}`)
  const exit = factory.body.statements.find(node => ts.isReturnStatement(node)
    && node.expression?.getText(ast) === 'module.exports')
  if (exit === undefined) throw new Error(`No module export boundary in ${path}`)
  const expose = names.map(name => `exports.${name} = ${name};`).join('\n')
  const instrumented = source.slice(0, exit.getStart(ast)) + expose + '\n' + source.slice(exit.getStart(ast))
  let exports
  runInNewContext(instrumented, {
    window: { __ModuleLoader__: { load: module => {
      exports = module.factory(name => {
        if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected host dependency: ${name}`)
        return dependencies[name]
      })
    } } },
    Map,
    Set,
    WeakMap,
    Promise,
    console,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    AbortController,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
  }, { filename: path })
  return exports
}
