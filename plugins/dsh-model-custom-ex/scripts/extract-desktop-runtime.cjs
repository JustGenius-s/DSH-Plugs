// Electron Node mode can read the application's ASAR without modifying it.
const fs = require('node:fs')
const path = require('node:path')
try {
  const base = path.join(path.dirname(process.execPath), 'resources/app.asar/dsh/node_modules/@deepseek-ai')
  const output = process.argv[2]
  if (!output) throw new Error('Missing desktop runtime output directory')
  function copy(source, destination) {
    if (fs.statSync(source).isDirectory()) {
      fs.mkdirSync(destination, { recursive: true })
      for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(destination, name))
    } else fs.writeFileSync(destination, fs.readFileSync(source))
  }
  for (const name of ['schemastery', 'cosmokit', 'dsh-client-ui-settings-models', 'dsh-client-ui-primitives']) copy(path.join(base, name), path.join(output, name))
  const schema = JSON.parse(fs.readFileSync(path.join(output, 'schemastery/package.json'), 'utf8'))
  if (!fs.readFileSync(path.join(output, 'schemastery', schema.module), 'utf8').includes('Schema.prototype.volatile')) throw new Error('Desktop runtime does not support volatile model settings')
  console.log('Desktop schema runtime: ' + schema.version)
} catch (error) { console.error(error.message); process.exitCode = 1 }
