// Loads Logic.js (a QML `.pragma library` file) into a Node VM context.
"use strict"
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

module.exports = function loadLogic() {
  const file = path.join(__dirname, "..", "Logic.js")
  const source = fs.readFileSync(file, "utf8").replace(/^\.pragma library\s*$/m, "")
  const context = {}
  vm.createContext(context)
  vm.runInContext(source, context, { filename: file })
  return context
}
