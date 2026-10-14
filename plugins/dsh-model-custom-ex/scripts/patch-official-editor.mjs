/** Targeted, fail-closed patches against the installed official Models editor. */
function once(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error('Unsupported official editor: ' + label)
  return source.replace(before, after)
}
function region(source, start, end, update) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  if (from < 0 || to < 0) throw new Error('Official editor region missing: ' + start)
  return source.slice(0, from) + update(source.slice(from, to)) + source.slice(to)
}
export function patchOfficialEditor(upstream, extras, packageName) {
  let source = upstream.replaceAll('\r\n', '\n')
  source = once(source, 'id: "@deepseek-ai/dsh-client-ui-settings-models",', 'id: ' + JSON.stringify(packageName) + ',', 'module identity')
  const additions = '\t\tconst modelCustomEx = (() => { const module = { exports: {} }; const exports = module.exports;\n' + extras + '\nreturn module.exports; })();\n' +
    '\t\tconst { CapacityField, ReasoningFields } = modelCustomEx.createControls(_deepseek_ai_dsh_client_ui_primitives, ModelsSection_module_css_default);\n'
  source = once(source, '\t\tfunction ModelRow(props) {', additions + '\t\tfunction ModelRow(props) {', 'model row binding')
  source = region(source, '\t\tfunction ModelRow(props) {', '\t\t//#region lib/types/client/DeepSeekModelsEditor.js', row => {
    const start = '\t\t\t\t\tchildren: [["contextWindow", "maxTokens"].map('
    const end = ', (0, react_jsx_runtime.jsx)(ModelInputTypes, {'
    const from = row.indexOf(start)
    const to = row.indexOf(end, from)
    if (from < 0 || to < 0) throw new Error('Official capacity fields changed')
    row = row.slice(0, from) + '\t\t\t\t\tchildren: [["contextWindow", "maxTokens"].map((field) => (0, react_jsx_runtime.jsx)(CapacityField, { ...props[field], field, label: t(field), position, disabled }, field))' + row.slice(to)
    return once(row, 'onChange: props.onChange\n\t\t\t\t\t})]', 'onChange: props.onChange\n\t\t\t\t\t}), props.reasoning?.enabled ? (0, react_jsx_runtime.jsx)(ReasoningFields, props) : null]', 'reasoning fields beside capabilities')
  })
  source = region(source, '\t\tfunction ModelListEditor(props) {', '\t\t//#region lib/types/client/', list => {
    list = once(list, 'const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());', 'const [expanded, setExpanded] = (0, react.useState)(() => new Set(models.map((_, index) => index)));', 'show existing row controls on edit')
    list = once(list, 'inputField: "input",', 'inputField: "input",\n\t\t\t\t\t\t\treasoning: props.reasoning,', 'reasoning row state')
    return once(list, 'onChange([...models, { id: "" }]);', 'onChange([...models, { id: "" }]);\n\t\t\t\t\t\tsetExpanded(current => new Set(current).add(models.length));', 'show new model controls')
  })
  source = region(source, '\t\tfunction ProviderEditor(props) {', '\t\t//#region lib/types/client/ModelsSection.js', editor => {
    editor = once(editor, 'className: ModelsSection_module_css_default["customized"],', 'className: ModelsSection_module_css_default["customized"],\n\t\t\t\t\topen: family === "pi-ai",', 'show model settings immediately on edit')
    editor = once(editor, 'const { namespace, schema, settingsPath, operations, t } = props;', 'const { namespace, schema, settingsPath, operations, t } = props;\n\t\t\tconst reasoning = modelCustomEx.useReasoningEditor(operations, props.provider, namespace.ns === "llm-pi-ai");', 'provider draft state')
    editor = once(editor, 'const applyOnce = async () => {', 'const applyOnce = async () => {\n\t\t\t\tlet modelCustomProfileWritten = false;', 'partial commit tracking')
    editor = once(editor, 'setDraft(next);', 'setDraft(next);\n\t\t\t\t\tmodelCustomProfileWritten = true;', 'profile write acknowledgement')
    editor = once(editor, 'setKeyDraft("");', 'setKeyDraft("");\n\t\t\t\tconst defaultFailure = await reasoning.saveDefaults(modelCustomProfileWritten);\n\t\t\t\tif (defaultFailure !== undefined) return defaultFailure;', 'single Save transaction')
    editor = once(editor, 'const catalogProps = {\n\t\t\t\t\tmodels,', 'const catalogProps = {\n\t\t\t\t\treasoning: { ...reasoning, overrides: schema.getPath(draft, ["modelOverrides"]) ?? schema.getPath(fallback, ["modelOverrides"]), onOverride: (id, value) => setDraft(current => schema.setPath(current, ["modelOverrides", id, "reasoningEfforts"], value)) },\n\t\t\t\t\tmodels,', 'preserve existing model overrides')
    return once(editor, 'failure !== void 0 ? (0, react_jsx_runtime.jsx)("p", {', 'reasoning.error ? (0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["error"], children: reasoning.error }) : null,\n\t\t\t\t\tfailure !== void 0 ? (0, react_jsx_runtime.jsx)("p", {', 'load refusal feedback')
  })
  source = once(source, 'function createModelsOperations(ctx) {\n\t\t\treturn {', 'function createModelsOperations(ctx) {\n\t\t\treturn {\n\t\t\t\t...modelCustomEx.createOperations(ctx.remote),', 'bound remote operations')
  return source.replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n')
}
