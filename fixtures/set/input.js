// Used as input
// { preserveReferences: true }
export default (() => {
  const var0 = new Set()
  var0.add(42)
  var0.add('not 42')
  return var0
})()

// -------------------------------------------------------------------------------------------------

// Default output
// { preserveReferences: false }
const withoutPreserveReferences = new Set([42, 'not 42'])
